import os
import subprocess
import requests
import re
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
    print("❌ Error: GOOGLE_API_KEY is missing! Check your .env file.")
    exit()

# Initialize Gemini Client
client = genai.Client(api_key=api_key)

# --- Tools ---

def run_playwright_test(test_name: str) -> str:
    """
    Runs a Playwright test and returns a detailed result.
    Includes a timeout to prevent the agent from hanging.
    """
    print(f"\n⏳ [PLAYWRIGHT] Executing: '{test_name}'...")
    try:
        # הפעלה עם timeout של 3 דקות כדי למנוע קיפאון של הסוכן
        result = subprocess.run(
            f'npx playwright test tests/{test_name}.spec.ts',
            capture_output=True, 
            text=True, 
            shell=True,
            encoding='utf-8', 
            errors='replace',
            timeout=180 
        )
        
        if result.returncode == 0:
            print(f"✅ [PLAYWRIGHT] '{test_name}' Passed.")
            return f"Success: {test_name} passed."
        
        # --- התיקון: הסרת קודי צבע (ANSI) של פליירייט מהטרמינל ---
        full_output = result.stdout + result.stderr
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        clean_output = ansi_escape.sub('', full_output)
        
        # חיפוש חכם של השגיאה בטקסט הנקי
        error_context = "Unknown failure reason"
        for line in clean_output.split('\n'):
            if "Error:" in line or "TimeoutError:" in line or "expect(" in line:
                error_context = line.strip()
                break # מצאנו את השגיאה, אפשר לעצור
                
        if error_context == "Unknown failure reason" and "failed" in clean_output.lower():
             error_context = "Playwright test failed. Check local HTML report."

        print(f"❌ [PLAYWRIGHT] '{test_name}' Failed. Reason: {error_context}")
        return f"Failure: {test_name} failed. Error Context: {error_context}"

    except subprocess.TimeoutExpired:
        print(f"⚠️ [PLAYWRIGHT] '{test_name}' Timed out!")
        return f"Failure: {test_name} timed out after 180 seconds."
    except Exception as e:
        print(f"❌ [PLAYWRIGHT] Critical Error: {str(e)}")
        return f"Error: {str(e)}"

def update_grafana(test_name: str, result_message: str) -> str:
    """
    Pushes detailed metrics for a specific test to Grafana Cloud.
    Now sends error_msg as a TAG for better visibility in Grafana Tables.
    """
    print(f"📊 [GRAFANA] Reporting result for: {test_name}...")
    
    # הגדרת סטטוס: 1 להצלחה, 0 לכישלון
    status_value = 1 if "Success" in result_message else 0
    
    # חילוץ הודעת השגיאה
    error_log = "None"
    if status_value == 0:
        if "Error Context:" in result_message:
            error_log = result_message.split("Error Context:")[-1]
        else:
            error_log = result_message
            
    # ניקוי תווים מיוחדים לפורמט InfluxDB - עכשיו בצורה חכמה יותר למנוע "רכבות" של קווים תחתונים
    clean_error = re.sub(r'[ ,=]+', '_', error_log).replace('"', '').replace('\n', '_')
    clean_error = re.sub(r'_+', '_', clean_error).strip('_')[:120]
    clean_test_name = test_name.replace(" ", "_")

    if not all([grafana_url, grafana_user, grafana_token]):
        return "⚠️ Simulation: Missing Grafana credentials in .env."

    # בניית ה-URL עם התיקון ל-Hostname והנתיב של InfluxDB
    push_url = grafana_url.replace('prometheus', 'influx').replace('api/prom/push', 'api/v1/push/influx/write')
    
    # Payload
    payload = f'itamar_sanity_detailed,test_name={clean_test_name},error_msg={clean_error},job=ai_agent value={status_value}'

    try:
        response = requests.post(
            push_url,
            data=payload,
            auth=(grafana_user, grafana_token),
            headers={'Content-Type': 'text/plain'},
            timeout=10
        )
        if response.status_code in [200, 204]:
            print(f"✅ [GRAFANA] Metrics updated for {test_name} (Status: {status_value})")
            return f"Grafana successfully updated for {test_name}."
        else:
            print(f"❌ [GRAFANA] Error {response.status_code}: {response.text}")
            return f"Grafana push failed with status {response.status_code}."
    except Exception as e:
        return f"Grafana Connection Failed: {str(e)}"

# --- Orchestration ---

callable_tools = {
    "run_playwright_test": run_playwright_test, 
    "update_grafana": update_grafana
}

if __name__ == "__main__":
    print("--- AI Agent Orchestrator: Ultimate Observability Edition ---")
    
    system_instruction = """
    You are a QA automation agent.
    Your MISSION: Orchestrate a full sanity check suite and ensure Grafana is updated for EVERY individual test.
    
    FOR EACH TEST in the list below, follow these exact steps:
    1. Call 'run_playwright_test' for the test.
    2. Wait for the result.
    3. IMMEDIATELY call 'update_grafana' using the test name and the result message you received.
    
    List of tests to run:
    - 'arnona'
    - 'login'
    - 'parking'
    - 'education'
    - 'street'
    - 'meeting'
    - 'myInquiries'
    - 'newInquire'
    
    CRITICAL RULES:
    - You MUST report EVERY test to Grafana, even if it failed.
    - All logs and summaries must be in ENGLISH.
    - Do not skip any tests.
    """

    # אבחון מודלים זמינים
    print("\n🔍 [DIAGNOSTIC] Checking available Gemini models...")
    allowed_models = []
    try:
        for m in client.models.list():
            if 'gemini' in m.name:
                allowed_models.append(m.name)
        print(f"📋 Access granted to {len(allowed_models)} models.")
    except Exception as e:
        print(f"❌ [CRITICAL] Failed to list models: {str(e)}")
        exit()

    best_models = [m for m in allowed_models if '1.5' in m and 'flash' in m]
    if not best_models:
        best_models = [m for m in allowed_models if 'flash' in m]
    if not best_models:
        best_models = allowed_models 
        
    active_chat = None
    response = None
    
    for model_obj in best_models:
        target_model = model_obj.replace('models/', '')
        print(f"\n🧠 [AGENT] Initializing with model: {target_model}...")
        try:
            active_chat = client.chats.create(
                model=target_model,
                config=types.GenerateContentConfig(
                    temperature=0,
                    tools=[run_playwright_test, update_grafana],
                    system_instruction=system_instruction
                )
            )
            response = active_chat.send_message("Please start the sanity check suite now.")
            print(f"✅ Connection established with {target_model}.\n")
            break 
        except Exception as e:
            print(f"⚠️ Model {target_model} failed. Trying next model...")
            active_chat = None

    if not active_chat:
        print("\n❌ [ERROR] Could not initialize any Gemini model.")
        exit()

    try:
        while response and response.function_calls:
            for tool_call in response.function_calls:
                tool_name = tool_call.name
                tool_args = tool_call.args
                
                if tool_name == "run_playwright_test":
                    result = run_playwright_test(tool_args["test_name"])
                elif tool_name == "update_grafana":
                    result = update_grafana(tool_args["test_name"], tool_args["result_message"])
                else:
                    result = "Unknown tool called."
                
                response = active_chat.send_message(
                    types.Part.from_function_response(name=tool_name, response={"result": result})
                )
        
        print("\n🤖 [AGENT] All tasks completed.")
        final_summary = response.text if response and response.text else "Sanity run finished."
        print("\n🏁 [FINAL SUMMARY]\n" + final_summary)
        
    except Exception as e:
        print(f"\n❌ [ERROR] Orchestrator crashed during execution: {str(e)}")