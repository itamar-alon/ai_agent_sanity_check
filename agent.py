import os
import subprocess
import requests
import json
import time
import glob
from collections import defaultdict
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

# --- Configuration ---
api_key      = os.getenv("GOOGLE_API_KEY")
grafana_url  = os.getenv("GRAFANA_URL")
grafana_user = os.getenv("GRAFANA_USER")
grafana_token = os.getenv("GRAFANA_TOKEN")

if not api_key:
    print("❌ Error: GOOGLE_API_KEY is missing!")
    exit()

client = genai.Client(api_key=api_key)
os.makedirs("playwright/.auth", exist_ok=True)

# ─────────────────────────────────────────────
# State (passed explicitly to tools, not global)
# ─────────────────────────────────────────────

class RunContext:
    def __init__(self, env_name: str, base_url: str, model: str):
        self.env_name = env_name
        self.base_url = base_url
        self.model    = model
        self.results: list[dict] = []   # accumulates per-test results

CTX: RunContext = None   # set before each env loop; tools read it


# ─────────────────────────────────────────────
# Tool 1 – run a single named test
# ─────────────────────────────────────────────

def run_single_test(test_name: str) -> dict:
    """
    מריץ טסט בודד לפי שמו המלא (כפי שמופיע ב-Playwright).
    מחזיר dict עם status, duration_ms ו-error_log.
    הסוכן מפעיל כלי זה עבור כל טסט בנפרד.
    """
    print(f"\n▶  [TEST] {test_name} ({CTX.env_name})")

    env = os.environ.copy()
    env["BASE_URL"] = CTX.base_url

    result = subprocess.run(
        f'npx playwright test --grep "{test_name}" --reporter=json',
        capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace", env=env, timeout=120
    )

    json_start = result.stdout.find("{")
    if json_start == -1:
        return {"test_name": test_name, "status": "error",
                "error_log": "No JSON output from Playwright", "duration_ms": 0}

    try:
        data = json.loads(result.stdout[json_start:])
    except Exception as e:
        return {"test_name": test_name, "status": "error",
                "error_log": str(e), "duration_ms": 0}

    # פרסור תוצאה
    for suite in data.get("suites", []):
        for spec in suite.get("specs", []):
            if spec.get("title", "") != test_name:
                continue
            if not spec.get("tests"):
                break
            last = spec["tests"][0]["results"][-1]
            status     = last.get("status", "unknown")
            duration   = last.get("duration", 0)
            error_log  = last.get("error", {}).get("message", "") if status not in ("expected", "passed") else ""

            return {
                "test_name":   test_name,
                "status":      "passed" if status in ("expected", "passed") else "failed",
                "duration_ms": duration,
                "error_log":   error_log,
            }

    return {"test_name": test_name, "status": "unknown",
            "error_log": "Test not found in output", "duration_ms": 0}


# ─────────────────────────────────────────────
# Tool 2 – retry a failed test (once)
# ─────────────────────────────────────────────

def retry_test(test_name: str) -> dict:
    """
    מריץ את הטסט שוב פעם אחת.
    הסוכן קורא לכלי זה רק כשהוא מחליט שהכישלון נראה flaky
    (שגיאת timeout / network / element-not-found).
    מחזיר dict זהה ל-run_single_test.
    """
    print(f"\n🔁 [RETRY] {test_name} ({CTX.env_name})")
    return run_single_test(test_name)


# ─────────────────────────────────────────────
# Tool 3 – list all test names in the suite
# ─────────────────────────────────────────────

def list_available_tests() -> list[str]:
    """
    מחזיר את רשימת שמות הטסטים שקיימים בסוויטה.
    הסוכן קורא לכלי זה בתחילת כל סביבה כדי לדעת מה להריץ.
    """
    result = subprocess.run(
        "npx playwright test --list --reporter=json",
        capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace", timeout=30
    )
    json_start = result.stdout.find("{")
    if json_start == -1:
        return []
    try:
        data  = json.loads(result.stdout[json_start:])
        names = []
        for suite in data.get("suites", []):
            for spec in suite.get("specs", []):
                names.append(spec["title"])
        return names
    except Exception:
        return []


# ─────────────────────────────────────────────
# Tool 4 – report results to Grafana
# ─────────────────────────────────────────────

def report_to_grafana(
    test_name:  str,
    status:     str,   # "passed" | "failed"
    rca:        str,   # ניתוח הסוכן: root cause בפורמט קצר
    severity:   int,   # 0-5 (0 = passed)
    scope:      str,   # "env_only" | "all_envs" | "flaky"
) -> str:
    """
    שולח מטריקה ל-Grafana עבור טסט בודד.
    הסוכן ממלא את rca, severity ו-scope לפי ניתוחו.
    """
    # מציאת וידאו אחרון
    evidence_path = "None"
    if status == "failed":
        base_dir   = os.path.join(os.getcwd(), "test-results")
        all_videos = glob.glob(os.path.join(base_dir, "**", "*.webm"), recursive=True)
        clean_name = test_name.replace(" ", "").lower()
        relevant   = [f for f in all_videos if clean_name in f.lower()]
        if relevant:
            evidence_path = os.path.abspath(max(relevant, key=os.path.getctime)).replace("\\", "/")

    status_value = 1 if status == "passed" else 0
    push_url = (
        grafana_url
        .replace("prometheus", "influx")
        .replace("api/prom/push", "api/v1/push/influx/write")
    )
    safe_rca   = rca.replace(" ", "_")[:80]
    safe_scope = scope.replace(" ", "_")
    payload = (
        f"itamar_sanity_v2,"
        f"test_name={test_name.replace(' ', '_')},"
        f"env={CTX.env_name},"
        f"ai_rca={safe_rca},"
        f"scope={safe_scope},"
        f"evidence={evidence_path},"
        f"job=ai_agent "
        f"value={status_value},severity={severity}"
    )
    try:
        r = requests.post(push_url, data=payload,
                          auth=(grafana_user, grafana_token), timeout=10)
        return f"OK ({r.status_code})"
    except Exception as e:
        return f"Failed: {e}"


# ─────────────────────────────────────────────
# Tool 5 – cross-env summary (called after all envs)
# ─────────────────────────────────────────────

def push_cross_env_summary(
    summary_text: str,
    critical_tests: list[str],
    infra_suspected: bool,
) -> str:
    """
    שולח מטריקת סיכום אחת לאחר שכל הסביבות רצו.
    הסוכן קורא לכלי זה רק פעם אחת בסוף.
    summary_text   – משפט אחד בעברית/אנגלית שמסכם את המצב
    critical_tests – רשימת טסטים שנכשלו בכל הסביבות
    infra_suspected – האם הסוכן חושד בבעיית infra/auth כוללת
    """
    push_url = (
        grafana_url
        .replace("prometheus", "influx")
        .replace("api/prom/push", "api/v1/push/influx/write")
    )
    infra_flag = 1 if infra_suspected else 0
    tests_tag  = "|".join(t.replace(" ", "_") for t in critical_tests[:5])
    payload = (
        f"itamar_sanity_summary,"
        f"job=ai_agent,"
        f"infra_suspected={infra_flag} "
        f"critical_count={len(critical_tests)},infra_flag={infra_flag}\n"
        # annotation metric (text field via separate line)
        f"itamar_sanity_annotation,"
        f"job=ai_agent "
        f"summary=\"{summary_text[:200]}\",critical_tests=\"{tests_tag}\""
    )
    try:
        r = requests.post(push_url, data=payload,
                          auth=(grafana_user, grafana_token), timeout=10)
        return f"Summary pushed ({r.status_code})"
    except Exception as e:
        return f"Failed: {e}"


# ─────────────────────────────────────────────
# Model discovery
# ─────────────────────────────────────────────

def find_working_model() -> str:
    # רשימת המודלים הכי יציבים שקיימים כרגע (כולל מה שעבד לך בריצה הקודמת)
    candidates = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-latest"]
    
    for name in candidates:
        try:
            client.models.generate_content(model=name, contents="ping")
            return name
        except Exception:
            continue
            
    # חיפוש דינמי במקרה שכל הרשימה נכשלת
    try:
        for m in client.models.list():
            if "flash" in m.name.lower():
                short = m.name.replace("models/", "")
                try:
                    client.models.generate_content(model=short, contents="ping")
                    return short
                except Exception:
                    continue
    except Exception:
        pass
        
    return "gemini-flash-latest"


# ─────────────────────────────────────────────
# System prompt for the agent
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """
You are a senior QA automation agent. Your job is to run, analyze, and report sanity tests
for the environment: {env_name}.

## Workflow (follow this order strictly)

1. Call `list_available_tests` to get the full list of test names.
2. For each test, call `run_single_test(test_name)`.
3. Analyze the result immediately:
   - If status="passed" → call `report_to_grafana` with severity=0, scope="env_only", rca="N/A".
   - If status="failed" and the error contains timeout/network/element not found →
     suspect FLAKY. Call `retry_test(test_name)`.
       - If retry passes → report as scope="flaky", severity=1.
       - If retry also fails → report as scope="env_only", severity=3, with real rca.
   - If status="failed" and error is clear (assertion/data) → report immediately,
     severity=3, scope="env_only".
4. After ALL tests are done, call `report_to_grafana` for any remaining un-reported tests.
   Then call `push_cross_env_summary` with:
   - summary_text: one sentence describing what happened overall.
   - critical_tests: list of test names that failed even after retry.
   - infra_suspected: true if >50% of tests failed with similar auth/network errors.

## RCA format
Write rca as 5-8 words describing root cause. Examples:
  "SSO_token_expired_on_login_page"
  "Product_grid_selector_changed"
  "API_timeout_on_checkout_endpoint"

## Severity scale
  0 = passed
  1 = flaky (passed on retry)
  2 = warning (intermittent)
  3 = real failure (this env only)
  4 = critical (multiple envs)
  5 = infra/auth collapse

Do not stop early. Do not skip reporting. Do not call the same tool twice for the same test
unless it is a retry.
""".strip()


# ─────────────────────────────────────────────
# Tool registry for Gemini function calling
# ─────────────────────────────────────────────

TOOLS = [
    list_available_tests,
    run_single_test,
    retry_test,
    report_to_grafana,
    push_cross_env_summary,
]

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
# API Retry Helper
# ─────────────────────────────────────────────
def send_message_with_retry(chat, message, max_retries=5):
    """
    עוטף את שליחת ההודעה ל-Gemini במנגנון השהיה. 
    אם יש עומס (429) או שרת לא זמין (503), ממתין ומנסה שוב במקום לקרוס.
    """
    for attempt in range(max_retries):
        try:
            return chat.send_message(message)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "503" in err_str or "RESOURCE_EXHAUSTED" in err_str or "UNAVAILABLE" in err_str:
                # המתנה הולכת וגדלה כדי להתמודד עם מגבלות ה-API
                wait_time = 15 * (attempt + 1) 
                print(f"⏳ API Overloaded (429/503). Waiting {wait_time}s before retry {attempt+1}/{max_retries}...")
                time.sleep(wait_time)
            else:
                raise e # שגיאה אחרת - נקריס כרגיל
    raise Exception("❌ Gemini API failed after multiple retries due to strict rate limits.")


# ─────────────────────────────────────────────
# Agent loop for a single environment
# ─────────────────────────────────────────────

def run_agent_for_env(ctx: RunContext):
    global CTX
    CTX = ctx

    chat = client.chats.create(
        model=ctx.model,
        config=types.GenerateContentConfig(
            tools=TOOLS,
            system_instruction=SYSTEM_PROMPT.format(env_name=ctx.env_name),
        )
    )

    print(f"\n{'='*55}")
    print(f"  🌍  ENVIRONMENT: {ctx.env_name.upper()}")
    print(f"{'='*55}")

    response = send_message_with_retry(chat, "Begin.")

    max_turns = 60   # safety cap – prevents infinite loops
    turn = 0

    while response and response.function_calls and turn < max_turns:
        turn += 1
        parts = []

        for call in response.function_calls:
            args   = dict(call.args) if call.args else {}
            result = dispatch_tool(call.name, args)
            print(f"  🔧 {call.name}({list(args.values())}) → {str(result)[:120]}")

            parts.append(
                types.Part.from_function_response(
                    name=call.name,
                    response={"result": result}
                )
            )
            
            # האטה אסטרטגית כדי לא להקפיץ את שגיאות העומס (Rate Limit) של המסלול החינמי
            time.sleep(8.0) 

        response = send_message_with_retry(chat, parts)

    if turn >= max_turns:
        print(f"⚠️  Safety cap reached for {ctx.env_name} after {max_turns} turns.")

    # Final agent text
    if response and response.text:
        print(f"\n📋 Agent summary for {ctx.env_name}:\n{response.text}")

# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("─── AI QA Agent – Smart Sanity Orchestrator ───")

    model = find_working_model()
    if not model:
        print("❌ No working Gemini model found. Check API key.")
        exit()
    print(f"✅ Model: {model}\n")

    environments = {
        "test":     os.getenv("URL_TEST"),
        "pre-prod": os.getenv("URL_PREPROD"),
        "prod":     os.getenv("URL_PROD"),
    }

    all_results: dict[str, list[dict]] = defaultdict(list)

    for env_name, env_url in environments.items():
        if not env_url:
            print(f"⏭  Skipping {env_name} (no URL)")
            continue

        ctx = RunContext(env_name=env_name, base_url=env_url, model=model)
        try:
            run_agent_for_env(ctx)
            all_results[env_name] = ctx.results
        except Exception as e:
            print(f"❌ Crash on {env_name}: {e}")

    print("\n🎉 All environments done.")