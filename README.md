# 🤖 AI QA Agent – Smart Sanity Orchestrator

[![Python 3.9+](https://img.shields.io/badge/Python-3.9+-blue.svg)](https://www.python.org/)
[![Playwright](https://img.shields.io/badge/Framework-Playwright-critical.svg)](https://playwright.dev/)
[![Gemini AI](https://img.shields.io/badge/AI-Google_Gemini-blueviolet.svg)](https://ai.google.dev/)
[![Grafana](https://img.shields.io/badge/Monitoring-Grafana-orange.svg)](https://grafana.com/)

An intelligent QA automation agent that runs, analyzes, and reports Playwright sanity tests across multiple environments using Google's Gemini AI.

## ✨ Key Features

- **Intelligent Execution**: Automatically discovers and runs Playwright tests using `npx playwright test`.
- **AI-Powered Root Cause Analysis (RCA)**: Uses Gemini to analyze Playwright JSON reports and error logs, providing concise root causes.
- **Flaky Test Handling**: Detects potentially flaky tests (timeouts, network issues, elements not found) and automatically retries them before marking them as failed.
- **Grafana/InfluxDB Integration**: Pushes test metrics, AI RCA, severity levels, scope, and video evidence paths directly to a Grafana dashboard.
- **Multi-Environment Support**: Seamlessly tests across `test`, `pre-prod`, and `prod` environments.
- **Cross-Environment Summary**: Evaluates the health of the entire pipeline and flags suspected overarching infrastructure or authentication issues.

## 🛠️ Prerequisites

- **Python 3.9+**
- **Node.js & npm** (with Playwright configured)
- **Google Gemini API Key**
- **Grafana / InfluxDB Instance**

---

## 📂 Project Structure

```text
├── tests/                # Playwright test suites (TS/JS)
├── agent.py              # Main AI Orchestration logic
├── model.py              # Gemini AI integration & prompt engineering
├── .env                  # Private credentials (Git Ignored)
├── package.json          # Node.js dependencies & Playwright config
├── playwright.config.ts  # Playwright environment setup
├── requirements.txt      # Python dependencies
└── README.md
🚀 Setup & Installation
Clone the repository:

Bash
git clone [https://github.com/itamar-alon/ai_agent_sanity_check.git](https://github.com/itamar-alon/ai_agent_sanity_check.git)
cd ai_agent_sanity_check
Install Python dependencies:

Bash
pip install -r requirements.txt
Install Node dependencies:
Ensure you have Playwright set up in your project directory.

Bash
npm install
npx playwright install
Configure Environment Variables:
Create a .env file in the root directory with your API keys, Grafana credentials, and target URLs:

# Google Gemini API
GOOGLE_API_KEY=your_gemini_api_key

# Grafana / InfluxDB Configuration
GRAFANA_URL=[https://your-grafana-instance.com/api/prom/push](https://your-grafana-instance.com/api/prom/push)
GRAFANA_USER=your_grafana_user
GRAFANA_TOKEN=your_grafana_token

# Target Environment Base URLs
URL_TEST=[https://test.example.com](https://test.example.com)
URL_PREPROD=[https://preprod.example.com](https://preprod.example.com)
URL_PROD=[https://prod.example.com](https://prod.example.com)
🏃‍♂️ Usage
Run the AI Agent Orchestrator:

Bash
python agent.py
🧠 How It Works
The agent dynamically finds the most capable and available Gemini Flash model.

It iterates through the configured environments (test, pre-prod, prod).

It retrieves the list of tests from Playwright and runs them one by one.

For each test, the agent analyzes the JSON output. If a test fails due to flaky conditions, it triggers a retry.

Results are immediately pushed to Grafana with an AI-generated RCA, severity score, and failure scope.

After all environments are tested, a cross-environment summary is generated and pushed.
