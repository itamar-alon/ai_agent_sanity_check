import os
import subprocess
import requests
import re
import time
import glob
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

# --- Configuration ---
api_key = os.getenv("GOOGLE_API_KEY")
grafana_url = os.getenv("GRAFANA_URL")
grafana_user = os.getenv("GRAFANA_USER")
grafana_token = os.getenv("GRAFANA_TOKEN")

if not api_key:
    print("❌ Error: GOOGLE_API_KEY is missing!")
    exit()

client = genai.Client(api_key=api_key)

# Global variables
CURRENT_ENV_NAME = "unknown"
CURRENT_BASE_URL = ""
SUCCESSFUL_MODEL_NAME = "" 

# יצירת תיקיית ההתחברות אם היא לא קיימת
os.makedirs('playwright/.auth', exist_ok=True)

# --- Tools ---

def execute_sanity_and_report_to_grafana() -> str:
    """
    מריץ את כל הטסטים בסביבה במכה אחת (מהיר פי 5), מנתח ומדווח מיד.
    מונע מצב שהסוכן מדלג על שלב הדיווח.
    """
    print(f"\n🚀 [PLAYWRIGHT] Executing FULL SUITE on {CURRENT_ENV_NAME.upper()}...")
    
    custom_env = os.environ.copy()
    if CURRENT_BASE_URL:
        custom_env["BASE_URL"] = CURRENT_BASE_URL
        
    result = subprocess.run(
        'npx playwright test --reporter=json',
        capture_output=True, text=True, shell=True,
        encoding='utf-8', errors='replace', env=custom_env, timeout=400 
    )
    
    print(f"📊 [PROCESS] Suite finished. Analyzing results...")

    json_start = result.stdout.find('{')
    if json_start == -1:
        return "Error: Playwright did not produce a valid JSON report."
    
    try:
        data = json.loads(result.stdout[json_start:])
    except Exception as e:
        return f"Error parsing JSON: {e}"

    report_log = []
    
    for suite in data.get('suites', []):
        for spec in suite.get('specs', []):
            test_name = spec['title'].replace('.spec.ts', '').replace('tests/', '')
            
            if not spec.get('tests'): continue
            last_run = spec['tests'][0]['results'][-1]
            status = last_run['status']
            
            if status in ["expected", "passed"]:
                update_grafana(test_name, f"Success: {test_name} passed.")
                report_log.append(f"{test_name}: OK")
            else:
                error_msg = last_run.get('error', {}).get('message', 'Failure detected')
                update_grafana(test_name, f"Failure: {test_name} failed. FULL_LOG_START\n{error_msg}\nFULL_LOG_END")
                report_log.append(f"{test_name}: FAIL")
                
    return "Execution and reporting complete. Summary: " + ", ".join(report_log)

def update_grafana(test_name: str, result_message: str) -> str:
    global SUCCESSFUL_MODEL_NAME
    status_value = 1 if "Success" in result_message else 0
    ai_analysis = "N/A"
    evidence_path = "None"
    
    if status_value == 0:
        full_log = result_message.split("FULL_LOG_START")[-1].split("FULL_LOG_END")[0] if "FULL_LOG_START" in result_message else result_message
        
        # מציאת וידאו אגרסיבית
        base_dir = os.path.join(os.getcwd(), "test-results")
        all_videos = glob.glob(os.path.join(base_dir, "**", "*.webm"), recursive=True)
        
        clean_name = test_name.replace(" ", "").lower()
        relevant = [f for f in all_videos if clean_name in f.lower()]
        
        if relevant:
            latest_video = max(relevant, key=os.path.getctime)
            evidence_path = os.path.abspath(latest_video).replace("\\", "/")

        # ניתוח AI
        prompt = f"Technical root cause for {test_name} failure in 5-8 words. LOG: {full_log[:1000]}"
        try:
            time.sleep(1)
            ai_res = client.models.generate_content(model=SUCCESSFUL_MODEL_NAME, contents=prompt)
            ai_analysis = ai_res.text.strip().replace(" ", "_")[:100]
        except:
            ai_analysis = "Analysis_Unavailable"
            
    push_url = grafana_url.replace('prometheus', 'influx').replace('api/prom/push', 'api/v1/push/influx/write')
    payload = f'itamar_sanity_detailed,test_name={test_name.replace(" ", "_")},env={CURRENT_ENV_NAME},ai_rca={ai_analysis},evidence={evidence_path},job=ai_agent value={status_value}'
    
    try:
        requests.post(push_url, data=payload, auth=(grafana_user, grafana_token), timeout=10)
        return "Success"
    except:
        return "Failed"

# --- Orchestration ---

if __name__ == "__main__":
    print("--- AI Agent: Robust SSO Orchestrator ---")
    
    print("🔍 [DIAGNOSTIC] Locating working Gemini model...")
    fallback_models = ["gemini-1.5-flash", "gemini-1.5-flash-002", "gemini-2.0-flash-exp"]
    
    for m_name in fallback_models:
        try:
            client.models.generate_content(model=m_name, contents="ping")
            SUCCESSFUL_MODEL_NAME = m_name
            print(f"✅ Model locked: {SUCCESSFUL_MODEL_NAME}")
            break
        except:
            continue

    if not SUCCESSFUL_MODEL_NAME:
        try:
            for m in client.models.list():
                if "gemini" in m.name.lower():
                    m_short = m.name.replace("models/", "")
                    try:
                        client.models.generate_content(model=m_short, contents="ping")
                        SUCCESSFUL_MODEL_NAME = m_short
                        print(f"✅ Found working model from list: {SUCCESSFUL_MODEL_NAME}")
                        break
                    except: continue
        except: pass

    if not SUCCESSFUL_MODEL_NAME:
        print("❌ CRITICAL: No Gemini models found. Check API Key.")
        exit()

    environments = {"test": os.getenv("URL_TEST"), "pre-prod": os.getenv("URL_PREPROD"), "prod": os.getenv("URL_PROD")}

    for env_name, env_url in environments.items():
        if not env_url: continue
        CURRENT_ENV_NAME, CURRENT_BASE_URL = env_name, env_url
        print(f"\n🌍 ENVIRONMENT: {env_name.upper()}")

        active_chat = client.chats.create(
            model=SUCCESSFUL_MODEL_NAME,
            config=types.GenerateContentConfig(
                tools=[execute_sanity_and_report_to_grafana],
                system_instruction=f"Run sanity for {env_name.upper()} by calling 'execute_sanity_and_report_to_grafana' and then wait for completion."
            )
        )
        
        try:
            response = active_chat.send_message("Go.")
            while response and response.function_calls:
                for tool_call in response.function_calls:
                    time.sleep(2)
                    res = execute_sanity_and_report_to_grafana()
                    response = active_chat.send_message(types.Part.from_function_response(name=tool_call.name, response={"result": res}))
        except Exception as e:
            print(f"❌ Crash on {env_name}: {e}")

    print("\n🎉 Done!")