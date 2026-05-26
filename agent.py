import os
import subprocess
import requests
import json
import time
import glob
import re
import logging
import sys
import shutil
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv
import threading

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

thread_local = threading.local()

from google import genai
from google.genai import types
from google.genai import errors

load_dotenv()
ENV_COOLDOWN_SECONDS = 90 

api_key = os.getenv("GOOGLE_API_KEY")
grafana_url = os.getenv("GRAFANA_URL")
grafana_user = os.getenv("GRAFANA_USER")
grafana_token = os.getenv("GRAFANA_TOKEN")

if not api_key:
    sys.exit(1)

client = genai.Client(api_key=api_key)
os.makedirs("playwright/.auth", exist_ok=True)

LOG_BASE_DIR = "logs"
TODAY_STR = datetime.now().strftime("%Y-%m-%d")
CURRENT_LOG_DIR = os.path.join(LOG_BASE_DIR, TODAY_STR)
os.makedirs(CURRENT_LOG_DIR, exist_ok=True)

def cleanup_logs():
    if not os.path.exists(LOG_BASE_DIR): return
    cutoff = datetime.now() - timedelta(days=7)
    for folder in os.listdir(LOG_BASE_DIR):
        path = os.path.join(LOG_BASE_DIR, folder)
        try:
            if os.path.isdir(path) and datetime.strptime(folder, "%Y-%m-%d") < cutoff:
                shutil.rmtree(path)
                print(f"♻️ Cleaned up old logs: {folder}")
        except Exception as e:
            print(f"⚠️ Cleanup failed for {folder}: {e}")

cleanup_logs()

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    handlers=[
        logging.FileHandler(os.path.join(CURRENT_LOG_DIR, "agent_debug.log"), encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

logging.getLogger("google.genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google.genai._api_client").setLevel(logging.WARNING)

GLOBAL_ERROR_CACHE = {}

# -------------------- STATE & CONTEXT --------------------
class RunContext:
    def __init__(self, env_name: str, base_url: str, available_models: list[str]):
        self.env_name = env_name
        self.base_url = base_url
        self.models = available_models
        self.current_model_idx = 0

    @property
    def current_model(self) -> str:
        return self.models[self.current_model_idx]

    def get_next_model(self) -> str:
        if self.current_model_idx < len(self.models) - 1:
            self.current_model_idx += 1
            return self.models[self.current_model_idx]
        return None

    def reset_models(self):
        self.current_model_idx = 0

CTX: RunContext = None

# -------------------- HELPERS & HEURISTICS --------------------
def is_infra_error(error_msg: str) -> bool:
    infra_patterns = [
        r"timeout.*exceeded",
        r"net::ERR_CONNECTION_REFUSED",
        r"Target page, context or browser has been closed",
        r"Page closed",
        r"failed: Navigation failed",
        r"loading-backdrop.*intercepts pointer events"
    ]
    for pattern in infra_patterns:
        if re.search(pattern, error_msg, re.IGNORECASE):
            return True
    return False

def _run_playwright(grep_pattern: str = None, timeout: int = 450) -> dict:
    env = os.environ.copy()
    env["BASE_URL"] = CTX.base_url
    env["TEST_ID"] = os.getenv("USER_ID", "")
    env["TEST_PASSWORD"] = os.getenv("USER_PASSWORD", "")
    
    os.makedirs(CURRENT_LOG_DIR, exist_ok=True)
    report_file = os.path.join(CURRENT_LOG_DIR, f"report_{CTX.env_name}.json")
    
    env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = report_file
    cmd = 'npx playwright test --reporter=json'
    
    if grep_pattern:
        cmd += f' --grep "^{re.escape(grep_pattern)}$"'
        
    try:
        subprocess.run(cmd, capture_output=False, shell=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        logger.error(f"⏱️ Playwright timed out after {timeout}s")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

    if os.path.exists(report_file):
        try:
            with open(report_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data
        except:
            return {}
    return {}

def _parse_results(data: dict) -> list[dict]:
    results = []
    def extract_specs(node):
        specs = node.get("specs", [])
        for suite in node.get("suites", []):
            specs.extend(extract_specs(suite))
        return specs
        
    all_specs = extract_specs(data)
    for spec in all_specs:
        test_name = spec.get("title", "unknown")
        if not spec.get("tests"): continue
            
        last = spec["tests"][0]["results"][-1]
        status = last.get("status", "unknown")
        passed = status in ("expected", "passed")
        error_msg = last.get("error", {}).get("message", "")[:1000] if not passed else ""
        clean_error = re.sub(r'\d+ms|\d+s', 'TIME', error_msg)
        
        res = {
            "test_name": test_name,
            "status": "passed" if passed else "failed",
            "duration_ms": last.get("duration", 0),
            "error_log": error_msg, 
            "rca": "N/A",
            "severity": 0
        }
        
        if not passed:
            res["severity"] = 1
            if is_infra_error(error_msg):
                res["rca"] = "Infrastructure/UI Blocking - AI analysis skipped."
            elif clean_error in GLOBAL_ERROR_CACHE:
                res["rca"] = GLOBAL_ERROR_CACHE[clean_error]
            else:
                try:
                    prompt = f"Identify the root cause of this failure in 10 words or less: {error_msg}"
                    response, used_model = send_with_fallback_simple(prompt)
                    
                    if response:
                        GLOBAL_ERROR_CACHE[clean_error] = response
                        res["rca"] = response
                    else:
                        res["rca"] = "AI empty response"
                except Exception as e:
                    logger.warning(f"⚠️ AI Analysis failed (Quota limit?). Continuing. Error: {e}")
                    res["rca"] = "AI RCA unavailable (Quota Limit)"
        
        results.append(res)
    return results

def send_with_fallback_simple(prompt: str):
    for attempt in range(len(CTX.models)):
        try:
            logger.info(f"🤖 [AI-RCA] Querying {CTX.current_model}...")
            resp = client.models.generate_content(model=CTX.current_model, contents=prompt)
            return resp.text.strip() if resp.text else None, CTX.current_model
        except Exception as e:
            if any(code in str(e) for code in ["429", "RESOURCE_EXHAUSTED", "503"]):
                logger.warning(f"⚠️ Quota hit on {CTX.current_model}. Switching model for RCA...")
                time.sleep(10)
                if not CTX.get_next_model(): break
                continue
            break
    return None, None

def _find_video(test_name: str) -> str:
    base_dir = os.path.join(os.getcwd(), "test-results")
    all_videos = glob.glob(os.path.join(base_dir, "**", "*.webm"), recursive=True)
    words = [w.lower() for w in re.split(r'\W+', test_name) if w]
    relevant = [f for f in all_videos if all(word in f.lower() for word in words)]
    return os.path.abspath(max(relevant, key=os.path.getctime)).replace("\\", "/") if relevant else "None"

def _extract_json(text: str) -> dict:
    if not text: return {}
    try:
        clean_text = text.replace("```json", "").replace("```", "").strip()
        start, end = clean_text.find("{"), clean_text.rfind("}")
        if start != -1 and end != -1: return json.loads(clean_text[start:end+1])
    except: pass
    return {}

# -------------------- TOOLS REGISTRY --------------------
def run_full_suite() -> list[dict]:
    logger.info(f"\n🚀 [SUITE] Running all tests on {CTX.env_name.upper()}...")
    data = _run_playwright(timeout=450)
    results = _parse_results(data)
    passed = sum(1 for r in results if r["status"] == "passed")
    logger.info(f"   ✅ {passed} passed  ❌ {len(results) - passed} failed")
    return results

def retry_test(test_name: str) -> dict:
    logger.info(f"\n🔁 [RETRY] {test_name} ({CTX.env_name})")
    data = _run_playwright(grep_pattern=test_name, timeout=150)
    results = _parse_results(data)
    return results[0] if results else {"test_name": test_name, "status": "error", "error_log": "No output"}

def report_results(analyses: list[dict]) -> str:
    if not analyses: 
        logger.warning("⚠️ No analyses to report.")
        return "Skipped - no data"
    
    streams = []
    for a in analyses:
            name = a.get("test_name", "unknown").replace(" ", "_")
            status = a.get("status", "failed")
            evidence_local_path = _find_video(a.get("test_name", "")) if status != "passed" else "None"
            
            if evidence_local_path != "None":

                evidence_url = evidence_local_path.replace("C:/Rizone/Projects", "http://10.77.72.45:8080")
                
                evidence_url = evidence_url.replace("\\", "/") 
            else:
                evidence_url = "None"

            log_payload = {
                "rca": a.get("rca", "N/A"),
                "evidence": evidence_url
            }

            streams.append({
                "stream": {
                    "job": "ai_sanity_v2", "env": CTX.env_name, "test_name": name,
                    "status": status, "severity": str(a.get("severity", 0)), "scope": "env_only"
                },
                "values": [[str(int(time.time() * 1e9)), json.dumps(log_payload, ensure_ascii=False)]]
            })
            try:
                r = requests.post(grafana_url, json={"streams": streams}, auth=(grafana_user, grafana_token), timeout=15)
                logger.info(f"   📤 Grafana (Loki): {r.status_code} ({len(analyses)} metrics)")
                return f"OK ({r.status_code})"
            except Exception as e:
                logger.error(f"   ❌ Grafana Error: {e}")
                return "Failed"
    

# -------------------- AI ORCHESTRATION --------------------
SYSTEM_PROMPT = """
You are the 'Smart Sanity Orchestrator' for {env_name}.
MANDATORY CHAIN OF COMMAND:
1. Start with `run_full_suite`.
2. If tests failed with 'timeout', use `retry_test`.
3. 🛑 MANDATORY: You MUST call `report_results` with all final results before finishing.
4. Conclude with a JSON summary.
""".strip()

TOOLS = [run_full_suite, retry_test, report_results]
TOOL_MAP = {fn.__name__: fn for fn in TOOLS}

def send_with_fallback(chat_session, message, ctx: RunContext):
    """ניהול הדיאלוג עם ה-AI תוך מעבר בין מודלים במקרה של עומס"""
    current_chat = chat_session
    for attempt in range(len(ctx.models)):
        try:
            if attempt > 0:
                logger.info(f"🔄 [AI-RETRY] Attempting orchestration with {ctx.current_model}...")
            return current_chat.send_message(message), current_chat
        except Exception as e:
            if any(code in str(e) for code in ["429", "RESOURCE_EXHAUSTED", "503"]):
                logger.warning(f"⚠️ Orchestrator hit quota limit on {ctx.current_model}.")
                time.sleep(20) 
                next_model = ctx.get_next_model()
                if next_model:
                    logger.info(f"⏭️ [SWITCH] Moving orchestration to: {next_model}")
                    current_chat = client.chats.create(
                        model=next_model, 
                        config=types.GenerateContentConfig(
                            tools=TOOLS, 
                            system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name)
                        ),
                        history=getattr(current_chat, 'history', [])
                    )
                    continue
            raise e
    return None, current_chat

def run_agent_for_env(env_name, env_url, models) -> dict:
    global CTX
    ctx = RunContext(env_name, env_url, models)
    CTX = ctx
    
    final_analyses = []
    
    chat = client.chats.create(
        model=ctx.current_model, 
        config=types.GenerateContentConfig(
            tools=TOOLS, 
            system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name)
        )
    )
    
    try:
        logger.info(f"🧠 [AGENT] Starting session for {env_name} using {ctx.current_model}...")
        response, chat = send_with_fallback(chat, "Begin analysis.", ctx)
        
        turn = 0
        while response and response.function_calls and turn < 15:
            turn += 1
            parts = []
            for c in response.function_calls:
                result = TOOL_MAP[c.name](**dict(c.args))
                if c.name == "run_full_suite" or c.name == "retry_test":
                    if isinstance(result, list): final_analyses = result
                    else: final_analyses = [result]
                
                parts.append(types.Part.from_function_response(name=c.name, response={"result": result}))
            
            response, chat = send_with_fallback(chat, parts, ctx)
        
        return _extract_json(response.text) if response and hasattr(response, 'text') else {}

    except Exception as e:
        logger.error(f"❌ AI Orchestration failed for {env_name}: {e}")
        return {"env": env_name, "status": "ai_failed"}
    
    finally:
        if final_analyses:
            logger.info(f"📊 [SAFETY-NET] Ensuring results are reported for {env_name}...")
            report_results(final_analyses)

# -------------------- MAIN EXECUTION --------------------
if __name__ == "__main__":
    try:
        logger.info("─── AI QA Agent – Smart Sanity Orchestrator ───")
        
        candidates = [
            "gemini-flash-latest",          
            "gemini-2.0-flash",              
            "gemini-2.5-flash",              
            "gemini-3-flash-preview",        
            "gemini-3.1-flash-lite-preview", 
            "gemini-flash-lite-latest"     
        ]
        
        envs = {
            "test": os.getenv("URL_TEST"), 
            "pre-prod": os.getenv("URL_PREPROD"), 
            "prod": os.getenv("URL_PROD")
        }
        
        for env_name, env_url in envs.items():
            if not env_url: continue
            
            run_agent_for_env(env_name, env_url, candidates)
            
            logger.info(f"⏳ Cooling down for {ENV_COOLDOWN_SECONDS}s...")
            time.sleep(ENV_COOLDOWN_SECONDS)
            
        logger.info("\n🎉 All done. Closing session.")

    except Exception as e:
        if 'logger' in locals():
            logger.error(f"⚠️ Global Execution Error: {e}")
            
    finally:
        logging.shutdown()
        time.sleep(2) 
        os._exit(0)