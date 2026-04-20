🤖 AI QA Agent – Smart Sanity Orchestrator
An intelligent QA automation agent that runs, analyzes, and reports Playwright sanity tests across multiple environments. By leveraging Google Gemini AI, the agent performs automated Root Cause Analysis (RCA), transforming complex failure logs into actionable insights.

🚀 Key Features
Intelligent Execution: Automatically orchestrates Playwright test suites across test, pre-prod, and prod environments.

AI-Powered RCA: Uses LLM analysis to parse JSON reports and tracebacks, providing concise explanations for failures.

Smart Flaky Test Handling: Detects environmental flakiness (timeouts, network issues) and triggers automated retries before marking a test as failed.

Full Observability: Real-time integration with Grafana/InfluxDB, pushing metrics, AI insights, and video evidence paths to a centralized dashboard.

Cross-Environment Summary: Evaluates global pipeline health to identify if issues are isolated or indicate infrastructure-wide failures.

Secure Secret Management: Utilizes .env files and environment-aware configuration to keep sensitive API keys and credentials secure.

🛠️ Tech Stack
Language: Python 3.9+

Automation: Playwright (Node.js engine)

AI Engine: Google Gemini Flash

Database: InfluxDB (Metrics storage)

Visualization: Grafana Dashboards

📂 Project Structure
Plaintext
├── tests/                # Playwright test suites (TS/JS)
├── agent.py              # Main AI Orchestration logic
├── model.py              # Gemini AI integration & prompt engineering
├── .env                  # Private credentials (Git Ignored)
├── .env_example          # Template for environment variables
├── package.json          # Node.js dependencies & Playwright config
├── playwright.config.ts  # Playwright environment setup
├── requirements.txt      # Python dependencies
└── README.md
⚙️ Installation & Setup
1. Clone the Repository
Bash
git clone https://github.com/itamar-alon/ai_agent_sanity_check.git
cd ai_agent_sanity_check
2. Install Dependencies
Python side:

Bash
pip install -r requirements.txt
Node.js side:

Bash
npm install
npx playwright install
3. Configuration (.env)
Create a .env file in the root directory. Use .env_example as a template:

קטע קוד
# AI Configuration
GOOGLE_API_KEY=your_gemini_key_here

# Monitoring
GRAFANA_URL=your_endpoint_here
GRAFANA_TOKEN=your_token_here

# Target Environments
URL_TEST=https://test.example.com
URL_PROD=https://prod.example.com
🏃‍♂️ How to Run
Execute the AI Agent Orchestrator:

Bash
python agent.py
🧠 Workflow
Model Selection: Agent identifies the optimal Gemini model for analysis.

Execution: Tests run sequentially across defined environments.

Analysis: Failed tests are sent to the AI for RCA and severity scoring.

Reporting: All data is streamed to Grafana for real-time monitoring.

📄 License
Personal project for advanced QA automation research.
