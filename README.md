#SMART EXAM ROOM

An AI-powered smart patient examination room built with modern web technologies to enhance clinical interactions and data capture.

---

## HOW TO RUN LOCALLY

### STEP 1: OPEN TERMINAL
Open **Terminal (Mac/Linux)** or **Command Prompt/PowerShell (Windows)** and navigate to the project folder:

```bash
cd path/to/smart-exam-room
```

---

### STEP 2: SET UP PYTHON VIRTUAL ENVIRONMENT
The transcription server requires a Python virtual environment. Set it up first:

```bash
# Navigate to the transcription folder
cd DrAITranscription

# Create virtual environment
python -m venv venv
# or on Windows if python doesn't work: py -m venv venv

# Activate the virtual environment
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# Windows (Command Prompt):
venv\Scripts\activate.bat
# Mac/Linux:
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Return to project root
cd ..
```

---

### STEP 3: INSTALL NODE.JS DEPENDENCIES
Install all required Node.js packages:

```bash
npm install
```

---

### STEP 4: CREATE `.env` FILE
Copy the example environment file:

```bash
cp .env.example .env
```

Then edit your `.env` file and add your API keys:

```
VITE_OPENAI_API_KEY=sk-your-actual-key-here
```

---

### STEP 5: RUN THE APP
Start both the frontend and transcription server with one command:

```bash
npm run dev
```

This will automatically start:
- **Frontend (Vite)**: [http://localhost:5173](http://localhost:5173)
- **Transcription Server**: [http://localhost:5000](http://localhost:5000)

The app should automatically open in your browser at `http://localhost:5173`

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

3. **Audio Transcription Server**
   The app includes real-time audio transcription functionality. With `npm run dev`, both the frontend and transcription server start automatically.
   
   **Note:** The transcription server requires:
   - Python 3.8+ installed
   - Virtual environment created in `DrAITranscription/venv`
   - Python dependencies installed (see Step 2 above)
   - On NVIDIA GPUs, it will automatically use CUDA for faster transcription
   
   **Alternative: Run servers separately** (if needed):
   
   **Terminal 1 - Start React App:**
   ```bash
   npm run dev:frontend
   ```
   
   **Terminal 2 - Start Transcription Server:**
   ```bash
   cd DrAITranscription
   venv\Scripts\activate  # Windows (or Activate.ps1 for PowerShell)
   # or source venv/bin/activate  # Mac/Linux
   python app.py
   ```
   
   See `DrAITranscription/SETUP.md` for detailed transcription setup instructions.

---

## TERMINAL COMMANDS SUMMARY

```bash
# Navigate to project
cd smart-exam-room

# Set up Python virtual environment
cd DrAITranscription
python -m venv venv
venv\Scripts\activate  # Windows (or source venv/bin/activate on Mac/Linux)
pip install -r requirements.txt
cd ..

# Install Node.js dependencies
npm install

# Set up environment file
cp .env.example .env
# (Edit .env with your API keys)

# Start both servers
npm run dev
```

---

## Project Overview
This project enables a **smart examination room** experience using AI for real-time data analysis, patient interaction enhancement, and multimodal input integration.
