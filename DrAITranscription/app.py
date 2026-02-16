# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import queue
import threading
import numpy as np
import sounddevice as sd
import time
import os
import wave
import tempfile

# Optional: use faster_whisper if installed
try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None

# ================= CONFIG =================
# Try device 24 first (may give true stereo on some drivers); fallback to 15
DEVICE_INDEX = 24     # PreSonus AudioBox USB 96 (callback-only on some Windows setups)
DEVICE_INDEX_FALLBACK = 15   # Fallback if 24 fails
SAMPLE_RATE_CAPTURE = 48000
SAMPLE_RATE_WHISPER = 16000
CHANNELS = 2
CHUNK = 1024
RMS_THRESHOLD = 0.01
MIN_SPEECH = 0.5       # seconds
SILENCE_DURATION = 0.8 # seconds
# Callback-based capture (required for device 24 on Windows when blocking fails)
USE_CALLBACK_CAPTURE = True

# Optional colors for console
NEON_GREEN = "\033[92m"
RESET_COLOR = "\033[0m"

# ==========================================

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active transcription sessions
active_sessions = {}

# ====== Audio Helpers ======
def save_wav_file(audio_data, samplerate, channels):
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    name = temp_file.name
    temp_file.close()
    audio_int16 = (audio_data * 32767).astype(np.int16)
    with wave.open(name, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(samplerate)
        wf.writeframes(audio_int16.tobytes())
    return name

def normalize_audio(audio):
    audio = audio.astype(np.float32)
    max_val = np.max(np.abs(audio))
    if max_val > 0:
        audio /= max_val
    return audio

def resample_audio(audio, from_sr, to_sr):
    """Resample 1D float32 audio from from_sr to to_sr. Returns mono float32."""
    if from_sr == to_sr:
        return audio
    n = int(round(len(audio) * to_sr / from_sr))
    try:
        from scipy import signal
        return signal.resample(audio, n).astype(np.float32)
    except ImportError:
        # Fallback: linear interpolation
        x_old = np.linspace(0, 1, len(audio))
        x_new = np.linspace(0, 1, n)
        return np.interp(x_new, x_old, audio).astype(np.float32)

def format_timestamp(seconds):
    td = int(seconds)
    mm, ss = divmod(td, 60)
    return f"{mm:02}:{ss:02}"

# ====== Transcription Session Class ======
class TranscriptionSession:
    def __init__(self):
        self.is_running = False
        self.transcripts = []
        self.callback = None
        self.stream = None
        self._audio_queue = queue.Queue()

        # Load Whisper model if available
        self.model = None
        if WhisperModel:
            try:
                self.model = WhisperModel("small.en", device="cuda", compute_type="int8")
            except Exception as e:
                print(f"[Session] Failed to load Whisper model: {e}")
                self.model = None

    def _process_segment(self, audio_chunk, speech_start_time, speech_end_time, session_start):
        if np.mean(np.abs(audio_chunk)) < 1e-4:
            return
        if audio_chunk.ndim == 1 or audio_chunk.shape[1] == 1:
            if np.sqrt(np.mean(audio_chunk**2)) > RMS_THRESHOLD:
                text = self.transcribe_audio(audio_chunk, "Mic 1",
                                             speech_start_time, speech_end_time)
                if text:
                    self.transcripts.append(text)
                    if self.callback:
                        self.callback(text)
        else:
            ch1, ch2 = audio_chunk[:, 0], audio_chunk[:, 1]
            if np.sqrt(np.mean(ch1**2)) > RMS_THRESHOLD:
                text_mic1 = self.transcribe_audio(ch1, "Mic 1",
                                                  speech_start_time, speech_end_time)
                if text_mic1:
                    self.transcripts.append(text_mic1)
                    if self.callback:
                        self.callback(text_mic1)
            if np.sqrt(np.mean(ch2**2)) > RMS_THRESHOLD:
                text_mic2 = self.transcribe_audio(ch2, "Mic 2",
                                                   speech_start_time, speech_end_time)
                if text_mic2:
                    self.transcripts.append(text_mic2)
                    if self.callback:
                        self.callback(text_mic2)

    def _capture_callback(self, indata, frames, time_info, status):
        if status:
            print(f"[Session] Stream status: {status}")
        if self.is_running and indata is not None and len(indata) > 0:
            self._audio_queue.put(indata.copy())

    def _run_worker(self, session_start):
        chunks_per_second = SAMPLE_RATE_CAPTURE / CHUNK
        min_chunks = int(MIN_SPEECH * chunks_per_second)
        silence_limit = int(SILENCE_DURATION * chunks_per_second)
        frames = []
        silent_chunks = 0
        speaking_chunks = 0
        speech_start_time = None
        while self.is_running:
            try:
                data = self._audio_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if data.ndim == 1 or data.shape[1] == 1:
                ch1_rms = np.sqrt(np.mean(data**2))
                ch2_rms = 0.0
            else:
                ch1_rms = np.sqrt(np.mean(data[:, 0]**2))
                ch2_rms = np.sqrt(np.mean(data[:, 1]**2))
            print(f"\rRMS -> Mic 1: {ch1_rms:.3f}, Mic 2: {ch2_rms:.3f}", end="")
            silent = max(ch1_rms, ch2_rms) < RMS_THRESHOLD
            if not silent and speech_start_time is None:
                speech_start_time = time.time() - session_start
            frames.append(data)
            if silent:
                silent_chunks += 1
            else:
                silent_chunks = 0
                speaking_chunks += 1
            if speaking_chunks > min_chunks and silent_chunks > silence_limit:
                audio_chunk = np.concatenate(frames, axis=0)
                speech_end_time = time.time() - session_start
                self._process_segment(audio_chunk, speech_start_time, speech_end_time, session_start)
                frames = []
                silent_chunks = 0
                speaking_chunks = 0
                speech_start_time = None

    def start(self):
        self.is_running = True
        session_start = time.time()
        device = DEVICE_INDEX
        use_callback = USE_CALLBACK_CAPTURE

        # Try callback-based stream (required for device 24 on some Windows drivers)
        if use_callback:
            for try_device in (DEVICE_INDEX, DEVICE_INDEX_FALLBACK):
                try:
                    self.stream = sd.InputStream(
                        device=try_device,
                        samplerate=SAMPLE_RATE_CAPTURE,
                        channels=CHANNELS,
                        dtype='float32',
                        blocksize=CHUNK,
                        callback=self._capture_callback,
                    )
                    self.stream.start()
                    device = try_device
                    print(f"[Transcription] Started (PreSonus stereo, device {try_device}, callback mode)")
                    break
                except sd.PortAudioError as e:
                    if try_device == DEVICE_INDEX:
                        print(f"[Session] Device {try_device} failed: {e}, trying fallback {DEVICE_INDEX_FALLBACK}")
                    else:
                        print(f"[Session] Audio input error: {e}")
                        self.is_running = False
                        return
        else:
            try:
                self.stream = sd.InputStream(
                    device=device,
                    samplerate=SAMPLE_RATE_CAPTURE,
                    channels=CHANNELS,
                    dtype='float32',
                )
                self.stream.start()
                print(f"[Transcription] Started (Mic 1 = Ch1, Mic 2 = Ch2, device {device})")
            except sd.PortAudioError as e:
                print(f"[Session] Audio input error: {e}")
                self.is_running = False
                return

        try:
            if use_callback:
                self._run_worker(session_start)
            else:
                # Blocking read path
                chunks_per_second = SAMPLE_RATE_CAPTURE / CHUNK
                min_chunks = int(MIN_SPEECH * chunks_per_second)
                silence_limit = int(SILENCE_DURATION * chunks_per_second)
                while self.is_running:
                    frames = []
                    silent_chunks = 0
                    speaking_chunks = 0
                    speech_start_time = None
                    while True:
                        data, _ = self.stream.read(CHUNK)
                        if data is None or len(data) == 0:
                            continue
                        if data.ndim == 1 or data.shape[1] == 1:
                            ch1_rms = np.sqrt(np.mean(data**2))
                            ch2_rms = 0.0
                        else:
                            ch1_rms = np.sqrt(np.mean(data[:, 0]**2))
                            ch2_rms = np.sqrt(np.mean(data[:, 1]**2))
                        print(f"\rRMS -> Mic 1: {ch1_rms:.3f}, Mic 2: {ch2_rms:.3f}", end="")
                        silent = max(ch1_rms, ch2_rms) < RMS_THRESHOLD
                        if not silent and speech_start_time is None:
                            speech_start_time = time.time() - session_start
                        frames.append(data)
                        if silent:
                            silent_chunks += 1
                        else:
                            silent_chunks = 0
                            speaking_chunks += 1
                        if speaking_chunks > min_chunks and silent_chunks > silence_limit:
                            break
                    audio_chunk = np.concatenate(frames, axis=0)
                    speech_end_time = time.time() - session_start
                    self._process_segment(audio_chunk, speech_start_time, speech_end_time, session_start)
        except Exception as e:
            print(f"[Session] Exception in audio loop: {e}")
        finally:
            self.stop()

    def stop(self):
        self.is_running = False
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def get_full_transcript(self):
        return "\n".join(self.transcripts)

    def transcribe_audio(self, audio, speaker_label, start_time, end_time):
        audio = normalize_audio(audio)
        # Resample to 16 kHz for Whisper if we captured at a different rate
        audio = resample_audio(audio, SAMPLE_RATE_CAPTURE, SAMPLE_RATE_WHISPER)
        wav_path = save_wav_file(audio, SAMPLE_RATE_WHISPER, 1)
        start_stamp = format_timestamp(start_time)
        end_stamp = format_timestamp(end_time)
        try:
            if self.model:
                segments, _ = self.model.transcribe(wav_path)
                text = " ".join([seg.text for seg in segments]).strip()
            else:
                text = "Simulated transcription"
            if text:
                line = f"[{start_stamp} -> {end_stamp}] {speaker_label}: {text}"
                print(f"{NEON_GREEN}{line}{RESET_COLOR}\n")
                return line
            return ""
        except Exception as e:
            print(f"Transcription error ({speaker_label}): {e}")
            return ""
        finally:
            try:
                os.remove(wav_path)
            except Exception:
                pass

# ====== Flask API ======
@app.route('/api/transcription/start', methods=['POST'])
def start_transcription():
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')

    if session_id in active_sessions:
        return jsonify({'error': 'Session already active'}), 400

    session = TranscriptionSession()
    active_sessions[session_id] = session

    def on_transcription(text):
        if session_id in active_sessions:
            socketio.emit('transcription_update', {
                'session_id': session_id,
                'text': text,
                'full_text': active_sessions[session_id].get_full_transcript()
            })

    session.callback = on_transcription
    thread = threading.Thread(target=session.start, daemon=True)
    thread.start()

    return jsonify({
        'success': True,
        'session_id': session_id,
        'message': 'Transcription started'
    })

@app.route('/api/transcription/stop', methods=['POST'])
def stop_transcription():
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')

    if session_id not in active_sessions:
        return jsonify({'error': 'Session not found'}), 404

    session = active_sessions[session_id]
    session.stop()
    full_transcript = session.get_full_transcript()
    del active_sessions[session_id]

    socketio.emit('transcription_complete', {
        'session_id': session_id,
        'full_text': full_transcript
    })

    return jsonify({
        'success': True,
        'session_id': session_id,
        'full_text': full_transcript
    })

@app.route('/api/transcription/status', methods=['GET'])
def get_status():
    session_id = request.args.get('session_id', 'default')
    if session_id in active_sessions:
        session = active_sessions[session_id]
        return jsonify({
            'active': session.is_running,
            'session_id': session_id,
            'transcript_count': len(session.transcripts)
        })
    return jsonify({'active': False, 'session_id': session_id})

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

# ====== Main ======
if __name__ == '__main__':
    print("Starting transcription server on http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
