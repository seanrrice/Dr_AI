# Transcription Server Setup

This directory contains the transcription functionality that can be integrated into the web application.

## Quick Start

### 1. Activate the virtual environment

```bash
cd DrAITranscription
.\venv\Scripts\Activate.ps1  # Windows PowerShell
# or
source venv/bin/activate      # Mac/Linux
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the transcription server

```bash
python app.py
```

The server will start on `http://localhost:5000`

## API Endpoints

- **POST** `/api/transcription/start` - Start a new transcription session
  ```json
  {
    "session_id": "optional_session_id"
  }
  ```

- **POST** `/api/transcription/stop` - Stop an active transcription session
  ```json
  {
    "session_id": "session_id"
  }
  ```

- **GET** `/api/transcription/status?session_id=xxx` - Get status of a session

## WebSocket Events

The server uses Socket.IO for real-time updates:

- **`transcription_update`** - Emitted when new transcription text is available
  ```json
  {
    "session_id": "session_id",
    "text": "new transcribed text",
    "full_text": "complete transcript so far"
  }
  ```

- **`transcription_complete`** - Emitted when transcription is stopped
  ```json
  {
    "session_id": "session_id",
    "full_text": "complete final transcript"
  }
  ```

## Configuration

Edit `transcription_module.py` to adjust:
- `SAMPLE_RATE` - Audio sample rate (default: 16000)
- `SILENCE_THRESHOLD` - Sensitivity for detecting silence
- `MIN_SPEECH` - Minimum speech duration before pause detection
- `SILENCE_DURATION` - Duration of silence that triggers transcription

## Troubleshooting

1. **"Failed to load WhisperModel"**
   - The model will download automatically on first use
   - Ensure you have internet connection for the first run
   - Model size: ~500MB

2. **"PortAudioError" or audio device issues**
   - Check that your microphone is connected and working
   - Try changing `DEVICE_INDEX` in `transcription_module.py`
   - On Windows, ensure PortAudio drivers are installed

3. **Server won't start**
   - Check that port 5000 is not in use
   - Ensure all dependencies are installed: `pip install -r requirements.txt`

4. **WebSocket connection fails**
   - Ensure CORS is properly configured (already set in `app.py`)
   - Check firewall settings
   - Verify the server URL in the React app matches the server address

## Running Both Servers

To run both the React app and transcription server:

**Terminal 1 - React App:**
```bash
npm run dev
```

**Terminal 2 - Transcription Server:**
```bash
cd DrAITranscription
.\venv\Scripts\Activate.ps1
python app.py
```

## Environment Variables

The React app can be configured with:
- `VITE_TRANSCRIPTION_API_URL` - URL of the transcription server (default: `http://localhost:5000`)

Add to your `.env` file:
```
VITE_TRANSCRIPTION_API_URL=http://localhost:5000
```

