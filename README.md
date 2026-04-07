# AI QA Agent – Smart Sanity Orchestrator

An intelligent QA automation agent that runs, analyzes, and reports Playwright sanity tests across multiple environments using Google's Gemini AI.

## Features

- **Intelligent Execution**: Automatically discovers and runs Playwright tests using `npx playwright test`.
- **AI-Powered Root Cause Analysis (RCA)**: Uses Gemini to analyze Playwright JSON reports and error logs, providing concise root causes.
- **Flaky Test Handling**: Detects potentially flaky tests (timeouts, network issues, elements not found) and automatically retries them before marking them as failed.
- **Grafana/InfluxDB Integration**: Pushes test metrics, AI RCA, severity levels, scope, and video evidence paths directly to a Grafana dashboard.
- **Multi-Environment Support**: Seamlessly tests across `test`, `pre-prod`, and `prod` environments.
- **Cross-Environment Summary**: Evaluates the health of the entire pipeline and flags suspected overarching infrastructure or authentication issues.

## Prerequisites

- Python 3.9+
- Node.js & npm (with Playwright configured)
- Google Gemini API Key
- Grafana / InfluxDB Instance

## Setup

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Install Node dependencies:**
   Ensure you have Playwright set up in your project directory.
   ```bash
   npm install
   npx playwright install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory with your API keys, Grafana credentials, and target URLs:
   ```env
   # Google Gemini API
   GOOGLE_API_KEY=your_gemini_api_key
   
   # Grafana / InfluxDB Configuration
   GRAFANA_URL=https://your-grafana-instance.com/api/prom/push
   GRAFANA_USER=your_grafana_user
   GRAFANA_TOKEN=your_grafana_token
   
   # Target Environment Base URLs
   URL_TEST=https://test.example.com
   URL_PREPROD=https://preprod.example.com
   URL_PROD=https://prod.example.com
   ```

## Usage

Run the AI Agent Orchestrator:

```bash
python agent.py
```

### How It Works
1. The agent dynamically finds the most capable and available Gemini Flash model.
2. It iterates through the configured environments (`test`, `pre-prod`, `prod`).
3. It retrieves the list of tests from Playwright and runs them one by one.
4. For each test, the agent analyzes the JSON output. If a test fails due to flaky conditions, it triggers a retry.
5. Results are immediately pushed to Grafana with an AI-generated RCA, severity score, and failure scope.
6. After all environments are tested, a cross-environment summary is generated and pushed.