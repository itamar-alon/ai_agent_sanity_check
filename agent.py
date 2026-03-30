import os
import subprocess
import requests
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

# Initialize Client
client = genai.Client(api_key=api_key)

# --- Tools ---

def run_playwright_test(test_name: str) -> str:
    """Runs a Playwright test and returns result."""
    print(f"\n⏳ [PLAYWRIGHT] Executing: '{test_name}'...")
    try:
        result = subprocess.run(
            f'npx playwright test tests/{test_name}.spec.ts',
            capture_output=True, text=True, shell=True,
            encoding='utf-8', errors='replace'
        )
        if result.returncode == 0:
            print(f"✅ [PLAYWRIGHT] '{test_name}' Passed.")
            return f"Success: {test_name} passed."
        return f"Failure: {test_name} failed."
    except Exception as e:
        return f"Error: {str(e)}"

def update_grafana(summary_message: str) -> str:
    """Pushes metrics to Grafana Cloud using InfluxDB format."""
    print(f"\n📊 [GRAFANA] Pushing metrics...")
    
    status_value = 1 if "Success" in summary_message else 0
    
    if not all([grafana_url, grafana_user, grafana_token]):
        return "⚠️ Simulation: Missing Grafana details in .env."

    # טריק ההמרה: הופכים את נתיב הפרומטאוס לנתיב אינפלוקס שתומך בטקסט חופשי
    influx_url = grafana_url.replace('prometheus', 'influx').replace('api/prom/push', 'api/v1/push/influx/write')

    # פורמט InfluxDB Line Protocol - מתאים לטקסט רגיל
    payload = f'municipality_api_status,job=ai_agent value={status_value}'

    try:
        response = requests.post(
            influx_url,
            data=payload,
            auth=(grafana_user, grafana_token),
            headers={'Content-Type': 'text/plain'},
            timeout=10
        )
        if response.status_code in [200, 204]:
            print(f"✅ [GRAFANA] Pushed Value: {status_value} to Dashboard!")
            return "Dashboard updated."
        else:
            print(f"❌ [GRAFANA] Error {response.status_code}: {response.text}")
            return f"Grafana Error: {response.status_code}"
    except Exception as e:
        return f"Connection Failed: {str(e)}"

# --- Execution ---

callable_tools = {"run_playwright_test": run_playwright_test, "update_grafana": update_grafana}

if __name__ == "__main__":
    print("--- AI Agent Orchestrator: Resilience Edition ---")
    
    system_instruction = """
    You are a QA automation agent for Rishon LeZion municipality.
    Your task:
    1. Run the test for 'arnona'.
    2. Run the test for 'login'.
    3. Once finished, call update_grafana with a summary in Hebrew.
    """

    print("\n🔍 [DIAGNOSTIC] Asking Google which models your API key is allowed to use...")
    allowed_models = []
    try:
        for m in client.models.list():
            if 'gemini' in m.name:
                allowed_models.append(m.name)
        
        print(f"📋 Your key has access to {len(allowed_models)} models.")
    except Exception as e:
        print(f"❌ [CRITICAL] Cannot read models. Error: {str(e)}")
        exit()

    if not allowed_models:
        print("❌ [CRITICAL] Your API key has 0 models available. Go to Google AI Studio and create a NEW API Key.")
        exit()

    # מסדרים את המודלים לפי עדיפות
    best_models = [m for m in allowed_models if '1.5' in m and 'flash' in m]
    if not best_models:
        best_models = [m for m in allowed_models if 'flash' in m]
    if not best_models:
        best_models = allowed_models 
        
    active_chat = None
    response = None
    
    # הלולאה החדשה: מנסה מודל אחרי מודל עד שאחד עונה בלי שגיאת עומס
    for model_obj in best_models:
        target_model = model_obj.replace('models/', '')
        print(f"\n🧠 [AGENT] Trying model: {target_model}...")
        try:
            active_chat = client.chats.create(
                model=target_model,
                config=types.GenerateContentConfig(
                    temperature=0,
                    tools=[run_playwright_test, update_grafana],
                    system_instruction=system_instruction
                )
            )
            response = active_chat.send_message("Start the tests.")
            print(f"✅ BINGO! Successfully connected and verified with {target_model}!\n")
            break # הצלחנו! יוצאים מהלולאה
        except Exception as e:
            print(f"⚠️ Model {target_model} failed (Overloaded/Unavailable). Moving to next...")
            active_chat = None

    if not active_chat:
        print("\n❌ [ERROR] All selected models are currently overloaded. Please take a 5-minute break and try again.")
        exit()

    try:
        print("🤖 [AGENT] Resuming task execution...")
        while response.function_calls:
            for tool_call in response.function_calls:
                tool_name = tool_call.name
                tool_args = tool_call.args
                arg_val = list(tool_args.values())[0] if tool_args else ""
                
                result = callable_tools[tool_name](arg_val)
                response = active_chat.send_message(
                    types.Part.from_function_response(name=tool_name, response={"result": result})
                )
        
        print("\n🏁 [DONE]\n" + response.text)
        
    except Exception as e:
        print(f"\n❌ [ERROR] Execution crashed: {str(e)}")