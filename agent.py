import os
import subprocess
import requests
import json
import time
import glob
import re
from collections import defaultdict
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai import errors

load_dotenv()

# --- Configuration ---
api_key       = os.getenv("GOOGLE_API_KEY")
grafana_url   = os.getenv("GRAFANA_URL")
grafana_user  = os.getenv("GRAFANA_USER")
grafana_token = os.getenv("GRAFANA_TOKEN")

if not api_key:
    print("❌ Error: GOOGLE_API_KEY is missing!")
    exit()

client = genai.Client(api_key=api_key)
os.makedirs("playwright/.auth", exist_ok=True)


# ─────────────────────────────────────────────
# State
# ─────────────────────────────────────────────

class RunContext:
    def __init__(self, env_name: str, base_url: str, model: str):
        self.env_name = env_name
        self.base_url = base_url
        self.model    = model

CTX: RunContext = None


# ─────────────────────────────────────────────
# Playwright helpers
# ─────────────────────────────────────────────

def _run_playwright(grep_pattern: str = None, timeout: int = 400) -> dict:
    env = os.environ.copy()
    env["BASE_URL"] = CTX.base_url

    cmd = "npx playwright test --reporter=json"
    if grep_pattern:
        cmd += f' --grep "{grep_pattern}"'

    result = subprocess.run(
        cmd, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace", env=env, timeout=timeout
    )

    json_start = result.stdout.find("{")
    if json_start == -1:
        return {}
    try:
        return json.loads(result.stdout[json_start:])
    except Exception:
        return {}


def _parse_results(data: dict) -> list[dict]:
    results = []
    for suite in data.get("suites", []):
        for spec in suite.get("specs", []):
            test_name = spec.get("title", "unknown")
            if not spec.get("tests"):
                continue
            last   = spec["tests"][0]["results"][-1]
            status = last.get("status", "unknown")
            passed = status in ("expected", "passed")
            results.append({
                "test_name":   test_name,
                "status":      "passed" if passed else "failed",
                "duration_ms": last.get("duration", 0),
                "error_log":   last.get("error", {}).get("message", "")[:800] if not passed else "",
            })
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
    """
    מחלץ JSON מתוך תגובת טקסט של הסוכן בצורה עמידה במיוחד.
    """
    if not text:
        return {}
    try:
        # הסרת סימוני Markdown
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
    """
    מריץ את כל הטסטים בסביבה הנוכחית בריצה אחת ומחזיר את כל התוצאות.
    קרא לכלי זה פעם אחת בלבד בתחילת כל סביבה.
    כל איבר: test_name, status ("passed"/"failed"), duration_ms, error_log.
    """
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
    """
    מריץ טסט בודד שנכשל פעם נוספת.
    קרא לכלי זה רק כשאתה חושד ב-flaky (timeout / network / element-not-found).
    מחזיר dict אחד: test_name, status, duration_ms, error_log.
    """
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
    """
    שולח את כל תוצאות הסביבה ל-Grafana בקריאה אחת.
    קרא לכלי זה פעם אחת לאחר שסיימת לנתח את כל הטסטים.

    analyses הוא רשימה של dicts, כל אחד עם:
      test_name (str)  – שם הטסט
      status    (str)  – "passed" או "failed"
      rca       (str)  – 5-8 מילים עם underscores. "N/A" אם עבר.
      severity  (int)  – 0=passed, 1=flaky, 3=failure, 4=critical, 5=infra
      scope     (str)  – "passed" | "flaky" | "env_only" | "all_envs"
    """
    push_url = (
        grafana_url
        .replace("prometheus", "influx")
        .replace("api/prom/push", "api/v1/push/influx/write")
    )

    lines = []
    for a in analyses:
        name     = a.get("test_name", "unknown").replace(" ", "_")
        status   = a.get("status", "failed")
        rca      = a.get("rca", "N/A").replace(" ", "_")[:80]
        severity = int(a.get("severity", 0))
        scope    = a.get("scope", "env_only").replace(" ", "_")
        val      = 1 if status == "passed" else 0
        evidence = _find_video(a.get("test_name", "")) if status != "passed" else "None"

        lines.append(
            f"itamar_sanity_v2,"
            f"test_name={name},"
            f"env={CTX.env_name},"
            f"ai_rca={rca},"
            f"scope={scope},"
            f"evidence={evidence},"
            f"job=ai_agent "
            f"value={val},severity={severity}"
        )

    try:
        r = requests.post(push_url, data="\n".join(lines),
                          auth=(grafana_user, grafana_token), timeout=15)
        print(f"   📤 Grafana: {r.status_code} ({len(analyses)} metrics)")
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
    """
    שולח סיכום גלובלי לאחר שכל הסביבות רצו.
    (פונקציית פייתון בלבד - לא כלי של ה-Agent)
    """
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
    # הרשימה מעודכנת בדיוק לפי המודלים שפתוחים לך, 
    # עם תעדוף למודלי Lite כדי לחסוך במכסה החינמית
    candidates = [
        "gemini-2.5-flash-lite",      # עדיפות ראשונה: חדש, מהיר וחסכוני
        "gemini-2.0-flash-lite",      # עדיפות שנייה: יציב וחסכוני
        "gemini-flash-lite-latest",   # fallback ל-lite זמין
        "gemini-2.5-flash",           # המודלים "הכבדים" יותר בסוף
        "gemini-2.0-flash"
    ]
    
    for name in candidates:
        try:
            # בדיקה שהמודל זמין בחשבון ותומך בכלים (Tools)
            client.models.generate_content(
                model=name, 
                contents="ping",
                config=types.GenerateContentConfig(tools=TOOLS)
            )
            return name
        except errors.APIError as e:
            # אם קיבלנו שגיאת מכסה כבר בפינג, נדפיס ונעבור הלאה
            print(f"   ⚠ Model '{name}' skipped (Rate limit / Quota issue)")
            continue
        except Exception as e:
            print(f"   ⚠ Model '{name}' rejected: {e}")
            continue
            
    print("\n❌ Error: All available models are currently rate-limited or unavailable. Please wait a few minutes for the quota to reset.")
    exit()
# ─────────────────────────────────────────────
# Playwright helpers - UPDATED
# ─────────────────────────────────────────────

def _run_playwright(grep_pattern: str = None, timeout: int = 400) -> dict:
    env = os.environ.copy()
    env["BASE_URL"] = CTX.base_url

    cmd = "npx playwright test --reporter=json"
    if grep_pattern:
        # שימוש ב-Regex מדויק (^ ו-$) כדי להריץ טסט אחד בלבד
        # ועטיפה בגרשיים כפולים עבור Windows
        exact_pattern = f"^{grep_pattern}$"
        cmd += f' --grep "{exact_pattern}"'

    result = subprocess.run(
        cmd, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace", env=env, timeout=timeout
    )

    json_start = result.stdout.find("{")
    if json_start == -1:
        return {}
    try:
        return json.loads(result.stdout[json_start:])
    except Exception:
        return {}

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

# שימו לב: push_cross_env_summary הוסר מכאן, הוא מטופל ב-Python בלבד
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

def send_with_backoff(chat, message, max_retries: int = 6):
    for attempt in range(max_retries):
        try:
            return chat.send_message(message)
        except errors.APIError as e:
            err = str(e)
            # זיהוי שגיאות עומס דרך המבנה החדש של השגיאה מה-SDK
            if e.code in (429, 503) or any(phrase in err for phrase in ("RESOURCE_EXHAUSTED", "UNAVAILABLE", "quota")):
                wait = min(30 * (2 ** attempt), 300)   # 30→60→120→240→300
                print(f"⏳ Rate-limited. Waiting {wait}s (attempt {attempt+1}/{max_retries})...")
                time.sleep(wait)
            else:
                # שגיאות כמו 404 (מודל לא נמצא) או 400 יעופו מיד החוצה ולא יבזבזו זמן
                raise
        except Exception as e:
            err = str(e)
            if any(code in err for code in ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE")):
                wait = min(30 * (2 ** attempt), 300)
                print(f"⏳ Rate-limited. Waiting {wait}s (attempt {attempt+1}/{max_retries})...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Gemini API unavailable after {max_retries} retries.")


# ─────────────────────────────────────────────
# Agent loop – one environment
# ─────────────────────────────────────────────

def run_agent_for_env(ctx: RunContext) -> dict:
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

    response  = send_with_backoff(chat, "Begin.")
    max_turns = 20
    turn      = 0

    while response and response.function_calls and turn < max_turns:
        turn += 1
        parts = []

        for call in response.function_calls:
            args   = dict(call.args) if call.args else {}
            result = dispatch_tool(call.name, args)
            label  = str(result)[:100] + ("..." if len(str(result)) > 100 else "")
            print(f"  🔧 [{turn}] {call.name} → {label}")

            parts.append(types.Part.from_function_response(
                name=call.name,
                response={"result": result}
            ))

        time.sleep(3)
        response = send_with_backoff(chat, parts)

    if turn >= max_turns:
        print(f"⚠️  Safety cap ({max_turns} turns) for {ctx.env_name}.")

    # ── חילוץ JSON עמיד מהתגובה הסופית ──────────────────────────────────
    summary = {}
    if response and response.text:
        print(f"\n📋 Raw agent response:\n{response.text}")
        summary = _extract_json(response.text)
        if summary:
            print(f"   ✔ Parsed summary: {summary}")
        else:
            # fallback: בנה סיכום בסיסי כדי לא לקרוס
            print("   ⚠ Could not parse JSON summary – using fallback.")
            summary = {
                "env":              ctx.env_name,
                "total":            0,
                "passed":           0,
                "failed":           0,
                "flaky":            0,
                "critical_tests":   [],
                "infra_suspected":  False,
            }

    return summary


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("─── AI QA Agent – Smart Sanity Orchestrator ───")

    model = find_working_model()
    if not model:
        print("❌ No working Gemini model found.")
        exit()
    print(f"✅ Model: {model}\n")

    environments = {
        "test":     os.getenv("URL_TEST"),
        "pre-prod": os.getenv("URL_PREPROD"),
        "prod":     os.getenv("URL_PROD"),
    }

    env_summaries: list[dict] = []

    for env_name, env_url in environments.items():
        if not env_url:
            print(f"⏭  Skipping {env_name} (URL not set)")
            continue

        ctx = RunContext(env_name=env_name, base_url=env_url, model=model)
        # אין try/except כאן כדי לא לבלוע שגיאות לוגיות –
        # רק שגיאות API מטופלות ב-send_with_backoff
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