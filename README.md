#SMART EXAM ROOM

An AI-powered smart patient examination room built with modern web technologies to enhance clinical interactions and data capture.

---

## HOW TO RUN LOCALLY

### STEP 1: OPEN TERMINAL
Open **Terminal (Mac/Linux)** or **Command Prompt (Windows)** and navigate to the project folder:

```bash
cd path/to/smart-exam-room
```

---

### STEP 2: INSTALL DEPENDENCIES
Install all required packages using:

```bash
npm install
```

---

### STEP 3: CREATE `.env` FILE
Copy the example environment file:

```bash
cp .env.example .env
```

Then edit your `.env` file and add your API keys:

```
VITE_OPENAI_API_KEY=sk-your-actual-key-here
```

---

### STEP 4: RUN THE APP
Start the development server:

```bash
npm run dev
```

Once started, the app should automatically open in your browser at:  
[http://localhost:5173](http://localhost:5173)

---

## IMPORTANT NOTES

1. **Get API Keys**
   - [OpenAI API Key](https://platform.openai.com/api-keys)

2. **Optional: Use Ollama (Free Local LLM)**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull llama2
   ollama serve
   ```

---

## TERMINAL COMMANDS SUMMARY

```bash
cd smart-exam-room
npm install
cp .env.example .env
# (Edit .env with your API keys)
npm run dev
```

---

## Project Overview
This project enables a **smart examination room** experience using AI for real-time data analysis, patient interaction enhancement, and multimodal input integration.
