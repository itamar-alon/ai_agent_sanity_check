import os
import subprocess
import requests
import json
import time
import glob
import re
import logging
import sys
from collections import defaultdict
from dotenv import load_dotenv
import threading
thread_local = threading.local()

from google import genai
from google.genai import types
from google.genai import errors

load_dotenv()

api_key       = os.getenv("GOOGLE_API_KEY")
grafana_url   = os.getenv("GRAFANA_URL")
grafana_user  = os.getenv("GRAFANA_USER")
grafana_token = os.getenv("GRAFANA_TOKEN")

if not api_key:
    print("❌ Error: GOOGLE_API_KEY is missing!")
    exit()

client = genai.Client(api_key=api_key)
os.makedirs("playwright/.auth", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("agent_debug.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# State
# ─────────────────────────────────────────────

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
            new_model = self.models[self.current_model_idx]
            return new_model
        return None

    def reset_models(self):
        self.current_model_idx = 0

CTX: RunContext = None

def get_ctx() -> RunContext:
    return getattr(thread_local, 'ctx', None)
# ─────────────────────────────────────────────
# Playwright helpers
# ─────────────────────────────────────────────


def _run_playwright(grep_pattern: str = None, timeout: int = 400) -> dict:
    env = os.environ.copy()
    env["BASE_URL"] = CTX.base_url
    
    # שימוש ב-exact match כדי לא להריץ טסטים דומים בטעות
    cmd = "npx playwright test --reporter=json"
    if grep_pattern:
        cmd += f' --grep "^{re.escape(grep_pattern)}$"'

    try:
        logger.info(f"🎭 Running Playwright: {grep_pattern if grep_pattern else 'Full Suite'}")
        result = subprocess.run(
            cmd, capture_output=True, text=True, shell=True,
            encoding="utf-8", errors="replace", env=env, timeout=timeout
        )
        
        json_start = result.stdout.find("{")
        if json_start == -1:
            logger.error("❌ Playwright output is not a valid JSON")
            return {}
            
        return json.loads(result.stdout[json_start:])
    except subprocess.TimeoutExpired:
        logger.error(f"⏱️ Playwright timed out after {timeout}s")
        return {}
    except Exception as e:
        logger.error(f"💥 Unexpected error in Playwright: {e}")
        return {}


def _parse_results(data: dict) -> list[dict]:
    results = []
    error_cache = {} 
    
    for suite in data.get("suites", []):
        for spec in suite.get("specs", []):
            test_name = spec.get("title", "unknown")
            if not spec.get("tests"):
                continue
            
            last = spec["tests"][0]["results"][-1]
            status = last.get("status", "unknown")
            passed = status in ("expected", "passed")
            
            error_msg = last.get("error", {}).get("message", "")[:1000] if not passed else ""
            
            res = {
                "test_name":   test_name,
                "status":      "passed" if passed else "failed",
                "duration_ms": last.get("duration", 0),
                "error_log":   error_msg,
                "rca":         "N/A",
                "severity":    0
            }

            if not passed:
                res["severity"] = 1
                
                if error_msg in error_cache:
                    logger.info(f"♻️ Using cached RCA for: {test_name}")
                    res["rca"] = error_cache[error_msg]
                else:
                    logger.info(f"🔍 Analyzing new failure type for: {test_name}...")
                    try:
                        prompt = f"Identify the root cause of this failure in 10 words or less: {error_msg}"
                        response = client.models.generate_content(
                            model="gemini-1.5-flash",
                            contents=prompt
                        )
                        
                        if response and hasattr(response, 'text') and response.text:
                            rca_result = response.text.strip()
                            error_cache[error_msg] = rca_result # שומרים ב-Cache
                            res["rca"] = rca_result
                        else:
                            res["rca"] = "AI returned empty response"
                            
                    except Exception as e:
                        logger.error(f"❌ AI Error: {e}")
                        res["rca"] = "AI Analysis failed"

            results.append(res)
            
    return results


def _find_video(test_name: str) -> str:
    base_dir   = os.path.join(os.getcwd(), "test-results")
    all_videos = glob.glob(os.path.join(base_dir, "**", "*.webm"), recursive=True)
    
    words = [w.lower() for w in re.split(r'\W+', test_name) if w]
    
    relevant = []
    for f in all_videos:
        f_lower = f.lower()
        if all(word in f_lower for word in words):
            relevant.append(f)
            
    if relevant:
        return os.path.abspath(max(relevant, key=os.path.getctime)).replace("\\", "/")
    
    return "None"


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    try:
        clean_text = text.replace("```json", "").replace("```", "").strip()
        start = clean_text.find("{")
        end = clean_text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(clean_text[start:end+1])
    except json.JSONDecodeError:
        pass
    return {}


# ─────────────────────────────────────────────
# Tool 1 – run the full suite once
# ─────────────────────────────────────────────

def run_full_suite() -> list[dict]:
    print(f"\n🚀 [SUITE] Running all tests on {CTX.env_name.upper()}...")
    data    = _run_playwright(timeout=400)
    results = _parse_results(data)
    passed  = sum(1 for r in results if r["status"] == "passed")
    failed  = len(results) - passed
    print(f"   ✅ {passed} passed  ❌ {failed} failed")
    return results


# ─────────────────────────────────────────────
# Tool 2 – retry a single flaky test
# ─────────────────────────────────────────────

def retry_test(test_name: str) -> dict:
    print(f"\n🔁 [RETRY] {test_name} ({CTX.env_name})")
    data    = _run_playwright(grep_pattern=test_name, timeout=120)
    results = _parse_results(data)
    if results:
        return results[0]
    return {"test_name": test_name, "status": "error",
            "error_log": "No output", "duration_ms": 0}


# ─────────────────────────────────────────────
# Tool 3 – report all results in one batch
# ─────────────────────────────────────────────

def report_batch_to_grafana(analyses: list[dict]) -> str:
    push_url = grafana_url 
    streams = []
    for a in analyses:
        name     = a.get("test_name", "unknown").replace(" ", "_")
        status   = a.get("status", "failed")
        rca      = a.get("rca", "N/A")
        severity = str(a.get("severity", 0)) 
        scope    = a.get("scope", "env_only").replace(" ", "_")
        evidence = _find_video(a.get("test_name", "")) if status != "passed" else "None"

        stream = {
            "stream": {
                "job": "ai_sanity_v2",
                "env": CTX.env_name,
                "test_name": name,
                "status": status,
                "severity": severity,
                "scope": scope
            },
            "values": [
                [str(int(time.time() * 1e9)), f"AI RCA: {rca} | Evidence: {evidence}"]
            ]
        }
        streams.append(stream)

    payload = {"streams": streams}

    try:
        auth_tuple = (grafana_user, grafana_token) if grafana_user and grafana_token else None
        
        r = requests.post(push_url, json=payload, auth=auth_tuple, timeout=15)
        print(f"   📤 Grafana (Loki): {r.status_code} ({len(analyses)} metrics)")
        
        if r.status_code >= 400:
            print(f"   ❌ Grafana Error Details: {r.text}")
            
        return f"OK ({r.status_code}) – {len(analyses)} metrics pushed"
    except Exception as e:
        return f"Failed: {e}"


# ─────────────────────────────────────────────
# Python Native Helper – cross-env summary
# ─────────────────────────────────────────────

def push_cross_env_summary(
    summary_text:    str,
    critical_tests:  list[str],
    infra_suspected: bool,
) -> str:

    push_url = (
        grafana_url
        .replace("prometheus", "influx")
        .replace("api/prom/push", "api/v1/push/influx/write")
    )
    infra_flag = 1 if infra_suspected else 0
    tests_tag  = "|".join(t.replace(" ", "_") for t in critical_tests[:5])
    payload = (
        f"itamar_sanity_summary,job=ai_agent "
        f"critical_count={len(critical_tests)},infra_flag={infra_flag}\n"
        f'itamar_sanity_annotation,job=ai_agent '
        f'summary="{summary_text[:200]}",critical_tests="{tests_tag}"'
    )
    try:
        r = requests.post(push_url, data=payload,
                          auth=(grafana_user, grafana_token), timeout=10)
        print(f"\n📊 Cross-env summary pushed ({r.status_code})")
        return f"Summary pushed ({r.status_code})"
    except Exception as e:
        return f"Failed: {e}"


# ─────────────────────────────────────────────
# Model discovery
# ─────────────────────────────────────────────

def find_working_model() -> str:

    candidates = [
        "gemini-2.5-flash-lite",     
        "gemini-2.0-flash-lite",     
        "gemini-flash-lite-latest",   
        "gemini-2.5-flash",          
        "gemini-2.0-flash"
    ]
    
    for name in candidates:
        try:
            client.models.generate_content(
                model=name, 
                contents="ping",
                config=types.GenerateContentConfig(tools=TOOLS)
            )
            return name
        except errors.APIError as e:
            print(f"   ⚠ Model '{name}' skipped (Rate limit / Quota issue)")
            continue
        except Exception as e:
            print(f"   ⚠ Model '{name}' rejected: {e}")
            continue
            
    print("\n❌ Error: All available models are currently rate-limited or unavailable. Please wait a few minutes for the quota to reset.")
    exit()

# ─────────────────────────────────────────────
# System prompt - UPDATED FOR MEMORY
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """
You are a senior QA automation agent analyzing test results for: {env_name}.

## Workflow – DO NOT REPEAT STEPS
1. If you don't have results yet, call `run_full_suite`. 
2. If you already have results, DO NOT call `run_full_suite` again.
3. Analyze failed tests (timeout/network -> RETRY, assertion -> FAILURE).
4. For flaky tests, call `retry_test(test_name)` ONE BY ONE.
5. Report everything in ONE batch via `report_batch_to_grafana`.
6. Output ONLY the JSON summary object at the very end.
## Required Final Output Format
You MUST return a JSON object exactly matching this structure (fill in the actual numbers and arrays based on your analysis):
```json
{{
    "env": "{env_name}",
    "total": 0,
    "passed": 0,
    "failed": 0,
    "flaky": 0,
    "critical_tests": ["test_name_1", "test_name_2"],
    "infra_suspected": false
}}

## Hard Rules
- NEVER restart the workflow from Step 1 if an API error occurs.
- If a tool call fails or retries, continue from exactly where you left off.
""".strip()

# ─────────────────────────────────────────────
# Tool registry
# ─────────────────────────────────────────────

TOOLS    = [run_full_suite, retry_test, report_batch_to_grafana]
TOOL_MAP = {fn.__name__: fn for fn in TOOLS}


def dispatch_tool(name: str, args: dict):
    fn = TOOL_MAP.get(name)
    if fn is None:
        return f"Unknown tool: {name}"
    try:
        return fn(**args)
    except Exception as e:
        return f"Tool error ({name}): {e}"


# ─────────────────────────────────────────────
# API call with exponential backoff
# ─────────────────────────────────────────────
def get_history_safe(chat_session):
    if hasattr(chat_session, 'get_history'):
        return chat_session.get_history()
    return getattr(chat_session, 'history', [])

def send_with_fallback(chat_session, message, ctx: RunContext):
    current_chat = chat_session
    max_attempts = len(ctx.models) 

    for attempt in range(max_attempts):
        try:
            return current_chat.send_message(message), current_chat
            
        except Exception as e:
            err_msg = str(e)
            
            if any(code in err_msg for code in ["429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE"]):
                if attempt < max_attempts - 1:
                    next_model_name = ctx.get_next_model()
                    if next_model_name:
                        print(f"   🔄 Model busy. Switching {ctx.env_name} to {next_model_name}...")
                        
                        current_chat = client.chats.create(
                            model=next_model_name,
                            config=types.GenerateContentConfig(
                                tools=TOOLS,
                                system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name)
                            ),
                            history=get_history_safe(current_chat)
                        )
                        continue 
                
                print(f"   ⚠️ All {max_attempts} models failed for {ctx.env_name}.")
                break
            else:
                raise e

    wait_time = 60
    print(f"   ⏳ Sleeping {wait_time}s for {ctx.env_name} to release quotas...")
    time.sleep(wait_time)
    
    ctx.reset_models()
    print(f"   🔄 Restarting {ctx.env_name} with {ctx.current_model}...")
    
    final_chat = client.chats.create(
        model=ctx.current_model,
        config=types.GenerateContentConfig(
            tools=TOOLS,
            system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name)
        ),
        history=get_history_safe(current_chat)
    )
    
    try:
        return final_chat.send_message(message), final_chat
    except Exception as e:
        print(f"❌ CRITICAL: Final attempt failed for {ctx.env_name}. Skipping turn.")
        return None, final_chat
# ─────────────────────────────────────────────
# Agent loop – one environment
# ─────────────────────────────────────────────

def run_agent_for_env(ctx: RunContext) -> dict:
    global CTX          
    CTX = ctx
    thread_local.ctx = ctx
    
    logger.info(f"🌐 Starting analysis for environment: {ctx.env_name}")
    
    chat = client.chats.create(
        model=ctx.current_model, 
        config=types.GenerateContentConfig(
            tools=TOOLS, 
            system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name)
        )
    )
    
    response, chat = send_with_fallback(chat, "Begin.", ctx)
    
    turn = 0
    while response and response.function_calls and turn < 15:
        turn += 1
        parts = []
        for call in response.function_calls:
            logger.info(f"🛠️ AI requested tool: {call.name}")
            result = TOOL_MAP[call.name](**dict(call.args))
            parts.append(types.Part.from_function_response(name=call.name, response={"result": result}))
        
        response, chat = send_with_fallback(chat, parts, ctx)
    
    if response and hasattr(response, 'text') and response.text:
        extracted = _extract_json(response.text)
        if extracted:
            logger.info(f"✅ Successfully extracted summary for {ctx.env_name}")
            return extracted
    
    logger.warning(f"⚠️ Failed to get a valid AI response for {ctx.env_name}. Falling back to empty summary.")
    return {
        "env": ctx.env_name,
        "status": "AI_FAILURE",
        "critical_tests": [],
        "infra_suspected": False
    }


def get_working_models() -> list[str]:
    print("🔎 Checking priority models based on your availability...")
    priority_candidates = [
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.0-flash"
    ]
    
    working_models = []
    for clean_name in priority_candidates:
        try:
            client.models.generate_content(model=clean_name, contents="ping")
            working_models.append(clean_name)
            print(f"   ✅ Model '{clean_name}' is ready.")
            
            if len(working_models) >= 3:
                break
        except Exception as e:
            err_msg = str(e)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                print(f"   ⚠️ Model '{clean_name}' is exhausted (Quota hit). Skipping.")
            else:
                print(f"   ❌ Model '{clean_name}' failed: {err_msg[:50]}...")
                
    return working_models
# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("─── AI QA Agent – Smart Sanity Orchestrator ───")
    
    candidates = [
        "gemini-2.5-flash",
        "gemini-2.0-flash", 
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash-lite",
    ]

    envs = {
        "test":     os.getenv("URL_TEST"),
        "pre-prod": os.getenv("URL_PREPROD"),
        "prod":     os.getenv("URL_PROD"),
    }

    env_summaries = []
    for env_name, env_url in envs.items():
        if not env_url:
            continue
        ctx = RunContext(
            env_name=env_name,
            base_url=env_url,
            available_models=candidates  
        )
        summary = run_agent_for_env(ctx)
        if summary:
            env_summaries.append(summary)
    # ── Cross-env analysis ──────────────────────────────────────────────
    if len(env_summaries) > 1:
        print("\n─── Cross-environment analysis ───")

        failure_counts: dict[str, int] = defaultdict(int)
        for s in env_summaries:
            for t in s.get("critical_tests", []):
                failure_counts[t] += 1

        cross_failures = [t for t, c in failure_counts.items() if c > 1]
        infra_votes    = sum(1 for s in env_summaries if s.get("infra_suspected"))
        infra_global   = infra_votes >= len(env_summaries) / 2

        total  = sum(s.get("total",  0) for s in env_summaries)
        passed = sum(s.get("passed", 0) for s in env_summaries)

        if cross_failures:
            summary_text = (
                f"{len(cross_failures)} test(s) failed across all envs"
                + (" – infra/auth suspected" if infra_global else "")
                + f": {', '.join(cross_failures[:3])}"
            )
        else:
            summary_text = f"All envs done. {passed}/{total} tests passed globally."

        print(f"  {summary_text}")

        if CTX:
            push_cross_env_summary(
                summary_text    = summary_text,
                critical_tests  = cross_failures,
                infra_suspected = infra_global,
            )

    print("\n🎉 All done.")