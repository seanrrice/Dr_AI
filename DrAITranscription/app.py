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
import subprocess
import sys

import json
import shutil
from pathlib import Path
from datetime import datetime


#Ensure repo root is in sys.path for imports
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# For facial analysis subprocess management
from threading import Event, Lock
import cv2
from emotion_pipeline.webcam_emotion_mediapipe import run_face_analysis
from flask import Response

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
# Max segments to queue for transcription; excess dropped to avoid long backlog
MAX_SEGMENT_QUEUE = 2
RMS_DISPLAY_INTERVAL = 0.05  # seconds between RMS console updates

# Optional colors for console
NEON_GREEN = "\033[92m"
RESET_COLOR = "\033[0m"

# ==========================================

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active transcription, face analysis sessions
active_sessions = {}

active_face_sessions = {}
latest_face_frames = {}
face_frames_lock = Lock()

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
    def __init__(self, device_index=None, channels=2):
        self.is_running = False
        self.transcripts = []
        self.callback = None
        self.stream = None
        self.device_index = device_index
        self.channels_requested = channels if channels in (1, 2) else 2
        self.active_channels = self.channels_requested
        self._audio_queue = queue.Queue()
        self._segment_queue = queue.Queue(maxsize=MAX_SEGMENT_QUEUE)
        self._transcript_lock = threading.Lock()
        self._rms_lock = threading.Lock()
        self._rms_ch1 = 0.0
        self._rms_ch2 = 0.0

        # Load Whisper model if available.
        self.model = None
        if WhisperModel:
            model_size = os.environ.get("WHISPER_MODEL_SIZE", "small.en")
            requested_device = os.environ.get("WHISPER_DEVICE", "cpu").strip().lower()
            if requested_device not in ("cpu", "cuda"):
                requested_device = "cuda"

            try:
                if requested_device == "cuda":
                    # GPU-first path with automatic CPU fallback if CUDA/cuDNN is unavailable.
                    self.model = WhisperModel(model_size, device="cuda", compute_type="int8")
                    print(f"[Session] Whisper loaded on CUDA ({model_size})")
                else:
                    self.model = WhisperModel(model_size, device="cpu", compute_type="int8")
                    print(f"[Session] Whisper loaded on CPU ({model_size})")
            except Exception as e:
                if requested_device == "cuda":
                    print(f"[Session] CUDA Whisper init failed: {e}. Falling back to CPU.")
                    try:
                        self.model = WhisperModel(model_size, device="cpu", compute_type="int8")
                        print(f"[Session] Whisper loaded on CPU fallback ({model_size})")
                    except Exception as cpu_e:
                        print(f"[Session] Failed to load Whisper model on CPU fallback: {cpu_e}")
                        self.model = None
                else:
                    print(f"[Session] Failed to load Whisper model: {e}")
                    self.model = None

    def _process_segment(self, audio_chunk, speech_start_time, speech_end_time, session_start, queue_wait=0.0):
        if np.mean(np.abs(audio_chunk)) < 1e-4:
            return
        if audio_chunk.ndim == 1 or audio_chunk.shape[1] == 1:
            if np.sqrt(np.mean(audio_chunk**2)) > RMS_THRESHOLD:
                text = self.transcribe_audio(audio_chunk, "",
                                             speech_start_time, speech_end_time, queue_wait=queue_wait)
                if text:
                    with self._transcript_lock:
                        self.transcripts.append(text)
                    if self.callback:
                        self.callback(text)
        else:
            ch1, ch2 = audio_chunk[:, 0], audio_chunk[:, 1]
            if np.sqrt(np.mean(ch1**2)) > RMS_THRESHOLD:
                text_mic1 = self.transcribe_audio(ch1, "Mic 1",
                                                  speech_start_time, speech_end_time, queue_wait=queue_wait)
                if text_mic1:
                    with self._transcript_lock:
                        self.transcripts.append(text_mic1)
                    if self.callback:
                        self.callback(text_mic1)
            if np.sqrt(np.mean(ch2**2)) > RMS_THRESHOLD:
                text_mic2 = self.transcribe_audio(ch2, "Mic 2",
                                                   speech_start_time, speech_end_time, queue_wait=queue_wait)
                if text_mic2:
                    with self._transcript_lock:
                        self.transcripts.append(text_mic2)
                    if self.callback:
                        self.callback(text_mic2)

    def _capture_callback(self, indata, frames, time_info, status):
        if status:
            print(f"[Session] Stream status: {status}")
        if self.is_running and indata is not None and len(indata) > 0:
            self._audio_queue.put(indata.copy())
            if indata.ndim == 1 or indata.shape[1] == 1:
                r1 = float(np.sqrt(np.mean(indata**2)))
                r2 = 0.0
            else:
                r1 = float(np.sqrt(np.mean(indata[:, 0]**2)))
                r2 = float(np.sqrt(np.mean(indata[:, 1]**2)))
            with self._rms_lock:
                self._rms_ch1, self._rms_ch2 = r1, r2

    def _rms_display_loop(self):
        while self.is_running:
            with self._rms_lock:
                r1, r2 = self._rms_ch1, self._rms_ch2
            print(f"\rRMS -> Mic 1: {r1:.3f}, Mic 2: {r2:.3f}", end="", flush=True)
            time.sleep(RMS_DISPLAY_INTERVAL)

    def _run_transcription_worker(self, session_start):
        while self.is_running:
            try:
                item = self._segment_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            (audio_chunk, speech_start_time, speech_end_time, _sess_start, t_ready) = item
            queue_wait = time.time() - t_ready
            self._process_segment(audio_chunk, speech_start_time, speech_end_time, session_start, queue_wait=queue_wait)
        while True:
            try:
                item = self._segment_queue.get_nowait()
            except queue.Empty:
                break
            (audio_chunk, speech_start_time, speech_end_time, _sess_start, t_ready) = item
            queue_wait = time.time() - t_ready
            self._process_segment(audio_chunk, speech_start_time, speech_end_time, session_start, queue_wait=queue_wait)

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
                t_ready = time.time()
                try:
                    self._segment_queue.put_nowait((audio_chunk, speech_start_time, speech_end_time, session_start, t_ready))
                except queue.Full:
                    try:
                        self._segment_queue.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        self._segment_queue.put_nowait((audio_chunk, speech_start_time, speech_end_time, session_start, t_ready))
                    except queue.Full:
                        pass
                frames = []
                silent_chunks = 0
                speaking_chunks = 0
                speech_start_time = None

    def start(self):
        self.is_running = True
        session_start = time.time()
        requested_channels = self.channels_requested
        selected_device = self.device_index
        device = selected_device if selected_device is not None else DEVICE_INDEX
        use_callback = USE_CALLBACK_CAPTURE

        # Try callback-based stream (required for device 24 on some Windows drivers)
        if use_callback:
            devices_to_try = [device]
            if selected_device is None and DEVICE_INDEX_FALLBACK not in devices_to_try:
                devices_to_try.append(DEVICE_INDEX_FALLBACK)

            for try_device in devices_to_try:
                try:
                    try:
                        self.stream = sd.InputStream(
                            device=try_device,
                            samplerate=SAMPLE_RATE_CAPTURE,
                            channels=requested_channels,
                            dtype='float32',
                            blocksize=CHUNK,
                            callback=self._capture_callback,
                        )
                        self.stream.start()
                        self.active_channels = requested_channels
                    except sd.PortAudioError:
                        if requested_channels == 2:
                            self.stream = sd.InputStream(
                                device=try_device,
                                samplerate=SAMPLE_RATE_CAPTURE,
                                channels=1,
                                dtype='float32',
                                blocksize=CHUNK,
                                callback=self._capture_callback,
                            )
                            self.stream.start()
                            self.active_channels = 1
                            print(f"[Session] Device {try_device} does not support stereo, using mono.")
                        else:
                            raise

                    device = try_device
                    print(f"[Transcription] Started (device {try_device}, channels={self.active_channels}, callback mode)")
                    break
                except sd.PortAudioError as e:
                    if try_device != devices_to_try[-1]:
                        print(f"[Session] Device {try_device} failed: {e}, trying fallback {devices_to_try[-1]}")
                    else:
                        print(f"[Session] Audio input error: {e}")
                        self.is_running = False
                        return
        else:
            try:
                try:
                    self.stream = sd.InputStream(
                        device=device,
                        samplerate=SAMPLE_RATE_CAPTURE,
                        channels=requested_channels,
                        dtype='float32',
                    )
                    self.stream.start()
                    self.active_channels = requested_channels
                except sd.PortAudioError:
                    if requested_channels == 2:
                        self.stream = sd.InputStream(
                            device=device,
                            samplerate=SAMPLE_RATE_CAPTURE,
                            channels=1,
                            dtype='float32',
                        )
                        self.stream.start()
                        self.active_channels = 1
                        print(f"[Session] Device {device} does not support stereo, using mono.")
                    else:
                        raise
                print(f"[Transcription] Started (device {device}, channels={self.active_channels})")
            except sd.PortAudioError as e:
                print(f"[Session] Audio input error: {e}")
                self.is_running = False
                return

        try:
            if use_callback:
                transcribe_thread = threading.Thread(target=self._run_transcription_worker, args=(session_start,), daemon=True)
                transcribe_thread.start()
                rms_thread = threading.Thread(target=self._rms_display_loop, daemon=True)
                rms_thread.start()
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
        with self._transcript_lock:
            return "\n".join(self.transcripts)

    def transcribe_audio(self, audio, speaker_label, start_time, end_time, queue_wait=0.0):
        t0 = time.perf_counter()
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
                elapsed = time.perf_counter() - t0
                total = SILENCE_DURATION + queue_wait + elapsed
                line = f"[{start_stamp} -> {end_stamp}] {speaker_label}: {text}" if speaker_label else f"[{start_stamp} -> {end_stamp}] {text}"
                print(f"{NEON_GREEN}({elapsed:.1f} s transcribe, {total:.1f} s total): \"{text}\"{RESET_COLOR}\n")
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

#=========face analysis helpers=====================

def get_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent

def get_face_script_path() -> Path:
    return get_repo_root() / "emotion_pipeline" / "webcam_emotion_mediapipe.py"

def get_face_python_executable() -> str:
    # Optional override if the face pipeline needs a different venv
    return os.environ.get("FACE_PYTHON_EXE", sys.executable)

def cleanup_dead_face_sessions():
    dead = []
    for visit_id, session in active_face_sessions.items():
        thread = session.get("thread")
        if thread and not thread.is_alive():
            dead.append(visit_id)
    for visit_id in dead:
        active_face_sessions.pop(visit_id, None)

def encode_frame_to_jpeg_bytes(frame):
    ok, buffer = cv2.imencode(".jpg", frame)
    if not ok:
        return None
    return buffer.tobytes()

def set_latest_face_frame(visit_id, frame):
    jpeg = encode_frame_to_jpeg_bytes(frame)
    if jpeg is None:
        return
    with face_frames_lock:
        latest_face_frames[visit_id] = jpeg

def clear_latest_face_frame(visit_id):
    with face_frames_lock:
        latest_face_frames.pop(visit_id, None)

def get_latest_face_frame(visit_id):
    with face_frames_lock:
        return latest_face_frames.get(visit_id)
    
# ====== Flask API ======
@app.route('/api/transcription/start', methods=['POST'])
def start_transcription():
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')
    device_index_raw = (data or {}).get('device_index', None)
    channels_raw = (data or {}).get('channels', 2)

    try:
        device_index = None if device_index_raw in (None, "", "default") else int(device_index_raw)
    except (TypeError, ValueError):
        return jsonify({'error': 'device_index must be an integer or null'}), 400

    try:
        channels = int(channels_raw)
    except (TypeError, ValueError):
        return jsonify({'error': 'channels must be 1 or 2'}), 400
    if channels not in (1, 2):
        return jsonify({'error': 'channels must be 1 or 2'}), 400

    if session_id in active_sessions:
        return jsonify({'error': 'Session already active'}), 400

    session = TranscriptionSession(device_index=device_index, channels=channels)
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
        'message': 'Transcription started',
        'channels': channels,
        'device_index': device_index
    })

@app.route('/api/transcription/devices', methods=['GET'])
def list_transcription_devices():
    try:
        devices = sd.query_devices()
        input_devices = []
        for idx, dev in enumerate(devices):
            max_input_channels = int(dev.get('max_input_channels', 0) or 0)
            if max_input_channels > 0:
                input_devices.append({
                    'index': idx,
                    'name': dev.get('name', f'Input {idx}'),
                    'max_input_channels': max_input_channels,
                    'default_samplerate': dev.get('default_samplerate')
                })
        return jsonify({'devices': input_devices})
    except Exception as e:
        return jsonify({'error': f'Failed to enumerate devices: {e}'}), 500

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
        with session._transcript_lock:
            count = len(session.transcripts)
        return jsonify({
            'active': session.is_running,
            'session_id': session_id,
            'transcript_count': count
        })
    return jsonify({'active': False, 'session_id': session_id})

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

#=======Face Analysis Endpoints =========

@app.route('/api/face/start', methods=['POST'])
def start_face_analysis():
    cleanup_dead_face_sessions()

    data = request.get_json(silent=True) or {}
    visit_id = data.get("visit_id")
    patient_id = data.get("patient_id")
    camera_index = int(data.get("camera_index", 0))

    if not visit_id or not patient_id:
        return jsonify({"error": "visit_id and patient_id are required"}), 400

    if visit_id in active_face_sessions:
        session = active_face_sessions[visit_id]
        thread = session.get("thread")
        if thread and thread.is_alive():
            return jsonify({"error": f"Face analysis already running for visit {visit_id}"}), 400
        active_face_sessions.pop(visit_id, None)

    visit_dir = _resolve_visit_dir(visit_id, patient_id=patient_id, create=True)
    visit_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_id": patient_id,
            "created_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "expected_subsystems": ["audio", "face", "gait"],
            "status": {"audio": "pending", "face": "pending", "gait": "pending"},
        }
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    stop_event = Event()
    face_log_path = visit_dir / "face_subprocess.log"

    def worker():
        try:
            with open(face_log_path, "a", encoding="utf-8") as log_f:
                old_stdout = sys.stdout
                old_stderr = sys.stderr
                sys.stdout = log_f
                sys.stderr = log_f
                try:
                    run_face_analysis(
                        visit_id=visit_id,
                        patient_id=patient_id,
                        visit_label=None,
                        runs_dir=str(visit_dir.parent),
                        camera_index=camera_index,
                        frame_callback=lambda frame: set_latest_face_frame(visit_id, frame),
                        stop_checker=lambda: stop_event.is_set(),
                        show_window=False,
                    )
                finally:
                    sys.stdout = old_stdout
                    sys.stderr = old_stderr
        except Exception as e:
            print(f"[Face] Worker crashed for visit {visit_id}: {e}")
        finally:
            clear_latest_face_frame(visit_id)

    thread = threading.Thread(target=worker, daemon=True)
    active_face_sessions[visit_id] = {
        "thread": thread,
        "stop_event": stop_event,
        "camera_index": camera_index,
    }
    thread.start()

    return jsonify({
        "status": "ok",
        "visit_id": visit_id,
        "message": "Face analysis started"
    })


@app.route('/api/face/stop', methods=['POST'])
def stop_face_analysis():
    cleanup_dead_face_sessions()

    data = request.get_json(silent=True) or {}
    visit_id = data.get("visit_id")

    if not visit_id:
        return jsonify({"error": "visit_id is required"}), 400

    session = active_face_sessions.get(visit_id)
    if not session:
        return jsonify({"error": f"No active face analysis for visit {visit_id}"}), 404

    try:
        session["stop_event"].set()
        thread = session.get("thread")
        if thread and thread.is_alive():
            thread.join(timeout=8)

        active_face_sessions.pop(visit_id, None)
        clear_latest_face_frame(visit_id)

        return jsonify({
            "status": "ok",
            "visit_id": visit_id,
            "message": "Face analysis stopped"
        })
    except Exception as e:
        return jsonify({"error": f"Failed to stop face analysis: {e}"}), 500
    

@app.route('/api/face/status', methods=['GET'])
def get_face_analysis_status():
    cleanup_dead_face_sessions()

    visit_id = request.args.get("visit_id")
    if not visit_id:
        return jsonify({"error": "visit_id is required"}), 400

    session = active_face_sessions.get(visit_id)
    running = False
    if session:
        thread = session.get("thread")
        running = thread is not None and thread.is_alive()

    return jsonify({
        "visit_id": visit_id,
        "running": running,
    })

@app.route('/api/face/live/<visit_id>')
def face_live_stream(visit_id):
    def generate():
        while True:
            frame = get_latest_face_frame(visit_id)
            if frame is None:
                time.sleep(0.05)
                continue

            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
            )
            time.sleep(0.03)

    return Response(
        generate(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )

# ====== Visit Management Endpoints ======

#RUNS_DIR = Path("runs")
RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"


def _safe_folder_name(value):
    raw = str(value or "").strip()
    if not raw:
        return "unknown"
    return "".join(ch if (ch.isalnum() or ch in ("-", "_", ".")) else "_" for ch in raw)


def _read_manifest_from_dir(visit_dir: Path):
    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _patient_mrn(patient_id):
    patients = _read_patients()
    p = next((row for row in patients if str(row.get("id")) == str(patient_id)), None)
    if not p:
        return None
    return p.get("medical_record_number") or None


def _patient_runs_dir(patient_id):
    mrn = _patient_mrn(patient_id)
    if not mrn:
        return None
    return RUNS_DIR / _safe_folder_name(mrn)


def _legacy_visit_dir(visit_id):
    return RUNS_DIR / f"visit_{visit_id}"


def _nested_visit_dir(visit_id, patient_id):
    patient_dir = _patient_runs_dir(patient_id)
    if not patient_dir:
        return None
    return patient_dir / f"visit_{visit_id}"


def _iter_nested_visit_dirs(visit_id):
    if not RUNS_DIR.exists():
        return
    for child in RUNS_DIR.iterdir():
        if not child.is_dir():
            continue
        candidate = child / f"visit_{visit_id}"
        if candidate.exists() and candidate.is_dir():
            yield candidate


def _find_existing_visit_dir(visit_id):
    for d in _iter_nested_visit_dirs(visit_id):
        return d
    legacy = _legacy_visit_dir(visit_id)
    if legacy.exists() and legacy.is_dir():
        return legacy
    return None


def _resolve_visit_dir(visit_id, patient_id=None, create=False):
    existing = _find_existing_visit_dir(visit_id)
    if existing:
        return existing

    if patient_id:
        nested = _nested_visit_dir(visit_id, patient_id)
        if nested is not None:
            if create:
                nested.mkdir(parents=True, exist_ok=True)
            return nested

    legacy = _legacy_visit_dir(visit_id)
    if create:
        legacy.mkdir(parents=True, exist_ok=True)
    return legacy


def _migrate_runs_to_mrn_structure():
    if not RUNS_DIR.exists():
        return []
    moves = []
    for visit_dir in RUNS_DIR.iterdir():
        if not visit_dir.is_dir() or not visit_dir.name.startswith("visit_"):
            continue
        visit_id = visit_dir.name[len("visit_"):]
        meta = _read_json_file(visit_dir / "visit_metadata.json") or {}
        manifest = _read_manifest_from_dir(visit_dir) or {}
        patient_id = meta.get("patient_id") or manifest.get("patient_id")
        if not patient_id:
            continue
        target_dir = _nested_visit_dir(visit_id, patient_id)
        if target_dir is None:
            continue
        if target_dir == visit_dir:
            continue
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        if target_dir.exists():
            for f in visit_dir.iterdir():
                dest = target_dir / f.name
                if not dest.exists():
                    shutil.move(str(f), str(dest))
            shutil.rmtree(visit_dir, ignore_errors=True)
        else:
            shutil.move(str(visit_dir), str(target_dir))
        moves.append((str(visit_dir), str(target_dir)))
    return moves

@app.route('/api/visits/<visit_id>/create', methods=['POST'])
def create_visit_folder(visit_id):
    data = request.get_json(silent=True) or {}
    patient_id = data.get("patient_id", "")
    visit_dir = _resolve_visit_dir(visit_id, patient_id=patient_id, create=True)

    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_id": data.get("patient_id", ""),
            "created_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "expected_subsystems": ["audio", "face", "gait"],
            "status": {"audio": "pending", "face": "pending", "gait": "pending"}
        }
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
            
    print(f"[Visit] Created visit folder: {visit_dir}")
    return jsonify({"status": "ok", "visit_id": visit_id})


@app.route('/api/visits/<visit_id>/logs/audio', methods=['POST'])
def save_audio_log(visit_id):
    data = request.get_json(silent=True) or {}
    visit_dir = _resolve_visit_dir(visit_id, patient_id=data.get("patient_id"), create=True)
    audio_path = visit_dir / "audio.jsonl"

    # Accept both JSONL (x-ndjson) and JSON array formats
    content_type = request.content_type or ""
    raw = request.get_data(as_text=True)

    records = []
    if "ndjson" in content_type or "jsonl" in content_type or "\n" in raw:
        for line in raw.splitlines():
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
    else:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                records = parsed
            elif isinstance(parsed, dict):
                records = [parsed]
        except Exception:
            pass

    with open(audio_path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")

    manifest_path = visit_dir / "manifest.json"
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            manifest["status"]["audio"] = "done"
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
        except Exception:
            pass

    print(f"[Visit] Audio JSONL saved -> {audio_path} ({len(records)} records)")
    return jsonify({"status": "ok", "records": len(records)})


@app.route('/api/visits/<visit_id>/logs/gait', methods=['POST'])
def save_gait_log(visit_id):
    data = request.get_json(silent=True) or {}
    visit_dir = _resolve_visit_dir(visit_id, patient_id=data.get("patient_id"), create=True)
    gait_path = visit_dir / "gait.jsonl"

    content_type = request.content_type or ""
    raw = request.get_data(as_text=True)

    records = []
    if "ndjson" in content_type or "jsonl" in content_type or "\n" in raw:
        for line in raw.splitlines():
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
    else:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                records = parsed
            elif isinstance(parsed, dict):
                if "records" in parsed and isinstance(parsed["records"], list):
                    records = parsed["records"]
                else:
                    records = [parsed]
        except Exception:
            pass

    with open(gait_path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")

    manifest_path = visit_dir / "manifest.json"
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            manifest["status"]["gait"] = "done"
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
        except Exception:
            pass

    print(f"[Visit] Gait JSONL saved -> {gait_path} ({len(records)} records)")
    return jsonify({"status": "ok", "records": len(records)})


@app.route('/api/visits/rename', methods=['POST'])
def rename_visit_folder():
    data = request.get_json(silent=True) or {}
    old_id = data.get("from")
    new_id = data.get("to")
    patient_id = data.get("patient_id")
    if not patient_id:
        old_meta = _read_visit_metadata(old_id) or {}
        old_manifest = _read_manifest_from_dir(_resolve_visit_dir(old_id, create=False)) or {}
        patient_id = old_meta.get("patient_id") or old_manifest.get("patient_id")
    if not old_id or not new_id:
        return jsonify({"error": "missing from/to"}), 400
    old_dir = _resolve_visit_dir(old_id, patient_id=patient_id, create=False)
    new_dir = _resolve_visit_dir(new_id, patient_id=patient_id, create=True)
    if old_dir.exists():
        new_dir.mkdir(parents=True, exist_ok=True)
        for file in old_dir.iterdir():
            shutil.copy2(str(file), str(new_dir / file.name))
        print(f"[Visit] Copied folder: {old_dir} -> {new_dir}")
    return jsonify({"status": "ok"})


def _canonical_gait_section_from_records(records):
    """
    Normalize gait.jsonl into the shape ReportSummary expects (summary + optional window rows).

    Supports:
    - Doctor AI spec lines with top-level "type": "summary" | "window" | "event"
    - Event-stream logs: visit_start, gait_frame, gait_summary, visit_end (see gait_visit_20s.jsonl)
    """
    if not records:
        return None

    def _f(x, default=None):
        try:
            return float(x) if x is not None else default
        except (TypeError, ValueError):
            return default

    has_event_stream = any(
        isinstance(r, dict)
        and r.get("event")
        in (
            "gait_frame",
            "gait_summary",
            "visit_start",
            "visit_end",
            "gait_session_start",
            "gait_session_end",
        )
        for r in records
    )
    has_spec = any(isinstance(r, dict) and r.get("type") in ("summary", "window", "event") for r in records)

    if has_spec and not has_event_stream:
        summary = next((r for r in records if r.get("type") == "summary"), None)
        windows = [r for r in records if r.get("type") == "window"]
        events = [r for r in records if r.get("type") == "event"]
        if not summary and not windows:
            return None
        if summary and not windows and not events:
            return summary
        out = {"record_count": len(records)}
        if summary:
            out["summary"] = summary
        if windows:
            out["windows"] = windows
        if events:
            out["events"] = events
        return out

    if has_event_stream:
        visit_start = next(
            (
                r
                for r in records
                if r.get("event") in ("visit_start", "gait_session_start")
            ),
            None,
        )
        gs = next((r for r in records if r.get("event") == "gait_summary"), None)
        frames = [r for r in records if r.get("event") == "gait_frame"]
        visit_id = (visit_start or {}).get("visit_id") or (gs or {}).get("visit_id")

        def _metric(summary_row, *keys):
            if not isinstance(summary_row, dict):
                return None
            metrics = summary_row.get("metrics")
            for k in keys:
                if summary_row.get(k) is not None:
                    return summary_row.get(k)
                if isinstance(metrics, dict) and metrics.get(k) is not None:
                    return metrics.get(k)
            return None

        mean_speed = _f(_metric(gs, "mean_speed_mps"))
        norms = [_f(r.get("speed_norm"), 0.0) for r in frames]
        mean_norm = sum(norms) / max(len(norms), 1) if norms else 1.0
        if mean_norm <= 1e-9:
            mean_norm = 1.0
        scale = (mean_speed / mean_norm) if mean_speed is not None else 1.0

        windows = []
        for i, row in enumerate(frames):
            t = _f(row.get("t_s"), 0.0) or 0.0
            t_next = _f(frames[i + 1].get("t_s"), t + 0.03) if i + 1 < len(frames) else t + 0.03
            lk = row.get("left_knee_deg")
            rk = row.get("right_knee_deg")
            knee_sym = None
            if lk is not None and rk is not None:
                knee_sym = max(0.0, 1.0 - min(1.0, abs(_f(lk) - _f(rk)) / 40.0))
            sway = _f(row.get("trunk_sway"), 0.0) or 0.0
            stability = max(0.0, 1.0 - min(1.0, abs(sway) / 0.04))
            speed_mps = (_f(row.get("speed_norm"), 0.0) or 0.0) * scale
            windows.append(
                {
                    "schema_version": "v0.1",
                    "type": "window",
                    "subsystem": "gait",
                    "visit_id": visit_id,
                    "t_start": t,
                    "t_end": t_next,
                    "valid": True,
                    "confidence": 0.85,
                    "features": {
                        "speed_mps": speed_mps,
                        "symmetry": knee_sym,
                        "stability": stability,
                    },
                }
            )

        summary = None
        if gs:
            sym_idx = _f(_metric(gs, "symmetry_index", "knee_symmetry_index_percent"))
            avg_sym = max(0.0, 1.0 - min(1.0, sym_idx / 100.0)) if sym_idx is not None else None
            sway_rms = _f(_metric(gs, "trunk_sway_rms", "trunk_sway_rms_m"))
            avg_stab = max(0.0, 1.0 - min(1.0, sway_rms / 0.08)) if sway_rms is not None else None
            t_end = max(
                max((_f(r.get("t_s"), 0.0) or 0.0 for r in frames), default=0.0),
                _f(_metric(gs, "duration_s"), 0.0) or 0.0,
            )
            mean_speed_gs = _f(_metric(gs, "mean_speed_mps"))
            summary = {
                "schema_version": "v0.1",
                "type": "summary",
                "subsystem": "gait",
                "visit_id": visit_id,
                "t_start": 0.0,
                "t_end": float(t_end),
                "valid": True,
                "confidence": (
                    float(_metric(gs, "quality_ok_fraction"))
                    if _metric(gs, "quality_ok_fraction") is not None
                    else 0.85
                ),
                "features": {
                    "avg_speed_mps": mean_speed_gs,
                    "avg_symmetry": avg_sym,
                    "avg_stability": avg_stab,
                },
                "notes": "",
                "num_steps": _metric(gs, "num_steps", "num_steps_est"),
                "cadence_spm": _metric(gs, "cadence_spm"),
                "mean_speed_mps": _metric(gs, "mean_speed_mps"),
                "symmetry_index": _metric(gs, "symmetry_index", "knee_symmetry_index_percent"),
                "left_knee_mean": _metric(gs, "left_knee_mean", "left_knee_mean_deg"),
                "right_knee_mean": _metric(gs, "right_knee_mean", "right_knee_mean_deg"),
                "trunk_sway_rms": _metric(gs, "trunk_sway_rms", "trunk_sway_rms_m"),
                "trunk_sway_peak_to_peak": _metric(
                    gs, "trunk_sway_peak_to_peak", "trunk_sway_peak_to_peak_m"
                ),
                "sit_to_stand_detected": _metric(gs, "sit_to_stand_detected"),
                "quality_ok_fraction": _metric(gs, "quality_ok_fraction"),
            }
        elif frames:
            t_end = max((_f(r.get("t_s"), 0.0) or 0.0 for r in frames), default=0.0)
            summary = {
                "schema_version": "v0.1",
                "type": "summary",
                "subsystem": "gait",
                "visit_id": visit_id,
                "t_start": 0.0,
                "t_end": float(t_end),
                "valid": True,
                "confidence": 0.75,
                "features": {},
                "notes": "Gait frames without gait_summary row",
            }

        if summary is None and not windows:
            return None
        if summary and not windows:
            return summary
        return {"summary": summary, "windows": windows, "record_count": len(records)}

    summary = next((r for r in records if r.get("type") == "summary"), None)
    if summary:
        windows = [r for r in records if r.get("type") == "window"]
        if windows:
            return {"summary": summary, "windows": windows, "record_count": len(records)}
        return summary
    return records[-1] if records else None


@app.route('/api/visits/<visit_id>/report', methods=['GET'])
def get_report(visit_id):
    visit_dir = _resolve_visit_dir(visit_id, create=False)
    report_path = visit_dir / "report.json"
    if report_path.exists():
        with open(report_path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    result = {
        "visit_id": visit_id,
        "partial": True,
        "sections": {},
        "availability": {"audio": "pending", "face": "pending", "gait": "pending"}
    }
    audio_path = visit_dir / "audio.jsonl"
    if audio_path.exists():
        try:
            records = [json.loads(line) for line in audio_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            summary = next((r for r in records if r.get("type") == "summary"), None)
            windows = [r for r in records if r.get("type") == "window"]
            result["sections"]["audio"] = {"summary": summary, "windows": windows, "record_count": len(records)}
            result["availability"]["audio"] = "available"
        except Exception as e:
            print(f"[Report] Error reading audio.jsonl: {e}")
    face_path = visit_dir / "face.jsonl"
    if face_path.exists():
        try:
            records = [json.loads(line) for line in face_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            summary = next((r for r in records if r.get("type") == "summary"), records[0] if records else None)
            result["sections"]["face"] = summary
            result["availability"]["face"] = "available"
        except Exception as e:
            print(f"[Report] Error reading face.jsonl: {e}")
    gait_path = visit_dir / "gait.jsonl"
    if gait_path.exists():
        try:
            records = [json.loads(line) for line in gait_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            section = _canonical_gait_section_from_records(records)
            if section is not None:
                result["sections"]["gait"] = section
                result["availability"]["gait"] = "available"
        except Exception as e:
            print(f"[Report] Error reading gait.jsonl: {e}")
    return jsonify(result)


@app.route('/api/visits/<visit_id>/status', methods=['GET'])
def get_visit_status(visit_id):
    visit_dir = _resolve_visit_dir(visit_id, create=False)
    manifest_path = visit_dir / "manifest.json"
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    return jsonify({"error": "Visit not found"}), 404



@app.route('/api/visits/<visit_id>/integrate', methods=['POST'])
def integrate_visit(visit_id):
    """
    Run the integrator for a visit — merges audio.jsonl + face.jsonl + gait.jsonl
    into a unified report.json.  Called automatically after all subsystems complete,
    or manually triggered from VisitDetails.
    """
    import sys
    visit_dir = _resolve_visit_dir(visit_id, create=False)
    if not visit_dir.exists():
        return jsonify({"error": "Visit folder not found"}), 404

    availability = {"audio": "pending", "face": "pending", "gait": "pending"}
    sections = {}

    def load_jsonl(path):
        if not path.exists():
            return []
        records = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
        return records

    def get_summary(records):
        for r in records:
            if r.get("type") == "summary":
                return r
        return records[-1] if records else None

    # Audio
    audio_records = load_jsonl(visit_dir / "audio.jsonl")
    if audio_records:
        summary = get_summary(audio_records)
        windows = [r for r in audio_records if r.get("type") == "window"]
        features = summary.get("features", {}) if summary else {}

        distress_levels = []
        all_emotional_indicators = set()
        sentiment_per_window = []
        all_terms = {}

        for w in windows:
            wf = w.get("features", {})
            sentiment = wf.get("sentiment", {}) or wf.get("sentiment_analysis", {})
            dl = sentiment.get("distress_level")
            if dl:
                distress_levels.append(dl)
            for ind in (sentiment.get("emotional_indicators") or []):
                all_emotional_indicators.add(ind)
            polarity = sentiment.get("polarity") or sentiment.get("sentiment_score")
            if polarity is not None:
                sentiment_per_window.append(polarity)
            dt = wf.get("diagnostic_terms", {})
            if isinstance(dt, dict):
                for item in dt.get("matches", []):
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        all_terms[item[0]] = item[1]
            elif isinstance(dt, list):
                for item in dt:
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        all_terms[item[0]] = item[1]

        distress_priority = {"high": 3, "medium": 2, "low": 1}
        overall_distress = max(distress_levels, key=lambda d: distress_priority.get(d, 0)) if distress_levels else "low"

        trajectory = "stable"
        if len(sentiment_per_window) >= 3:
            half = len(sentiment_per_window) // 2
            first_half = sum(sentiment_per_window[:half]) / half
            second_half = sum(sentiment_per_window[half:]) / (len(sentiment_per_window) - half)
            diff = second_half - first_half
            if diff > 0.15:
                trajectory = "improving"
            elif diff < -0.15:
                trajectory = "worsening"

        sections["audio"] = {
            "type": "summary", "subsystem": "audio",
            "t_start": summary.get("t_start") if summary else None,
            "t_end": summary.get("t_end") if summary else None,
            "total_words": features.get("total_words", 0),
            "total_windows": features.get("total_windows", len(windows)),
            "avg_sentiment_polarity": features.get("avg_sentiment_polarity"),
            "distress_level": overall_distress,
            "distress_trajectory": trajectory,
            "emotional_indicators": sorted(all_emotional_indicators),
            "top_words": features.get("top_words", []),
            "top_topics": features.get("top_topics", []),
            "diagnostic_terms": list(all_terms.items()),
            "record_count": len(audio_records),
            "windows": windows,
            "summary": summary,
        }
        availability["audio"] = "available"
        print(f"[Integrator] Audio: distress={overall_distress}, indicators={sorted(all_emotional_indicators)}")

    # Face
    face_records = load_jsonl(visit_dir / "face.jsonl")
    if face_records:
        summary = get_summary(face_records)
        features = summary.get("features", {}) if summary else {}
        emotion_pct = features.get("emotion_pct", {})
        dominant = max(emotion_pct.items(), key=lambda kv: kv[1])[0] if emotion_pct else None
        sections["face"] = {
            "type": "summary", "subsystem": "face",
            "t_start": summary.get("t_start") if summary else None,
            "t_end": summary.get("t_end") if summary else None,
            "total_samples": features.get("total_samples", 0),
            "dominant_emotion": dominant,
            "emotion_pct": emotion_pct,
            "emotion_counts": features.get("emotion_counts", {}),
            "model_version": summary.get("model_version") if summary else None,
            "features": features,
        }
        availability["face"] = "available"

    # Gait
    gait_records = load_jsonl(visit_dir / "gait.jsonl")
    if gait_records:
        canonical = _canonical_gait_section_from_records(gait_records)
        if canonical is not None:
            sections["gait"] = canonical
        availability["gait"] = "available"

    # Extract IDs
    visit_id_clean = visit_id
    patient_id = None
    for rec in (audio_records + face_records + gait_records):
        if rec.get("patient_id"):
            patient_id = rec["patient_id"]
            break

    report = {
        "schema_version": "v0.1",
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "visit_id": visit_id_clean,
        "patient_id": patient_id,
        "partial": any(v == "pending" for v in availability.values()),
        "availability": availability,
        "sections": sections,
    }

    report_path = visit_dir / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"[Integrator] report.json written for visit_{visit_id}")
    print(f"[Integrator] Availability: {availability}")
    return jsonify({"status": "ok", "availability": availability})

# ====== Main ======
# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE LAYER  —  patients.json  +  visit_metadata.json
# Add this block to app.py right above the  if __name__ == '__main__':  line.
# ═══════════════════════════════════════════════════════════════════════════════

import uuid

# ── Paths ────────────────────────────────────────────────────────────────────
# REPO_ROOT is already defined above as Path(__file__).resolve().parent.parent
# RUNS_DIR  change:  was Path("runs")  →  now REPO_ROOT / "runs"
#
#   Replace the existing line:
#       RUNS_DIR = Path("runs")
#   with:
#       RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"
#
# Everything else in app.py (face, audio, integrate, etc.) works unchanged.

PATIENTS_FILE = REPO_ROOT / "patients.json"


# ── JSON file helpers ─────────────────────────────────────────────────────────

def _read_patients():
    if not PATIENTS_FILE.exists():
        return []
    try:
        return json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write_patients(data):
    PATIENTS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _read_visit_metadata(visit_id):
    path = _resolve_visit_dir(visit_id, create=False) / "visit_metadata.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_visit_metadata(visit_id, data):
    visit_dir = _resolve_visit_dir(visit_id, patient_id=data.get("patient_id"), create=True)
    path = visit_dir / "visit_metadata.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    _write_visit_transcription(visit_id, data.get("transcription"))


def _write_visit_transcription(visit_id, transcription):
    existing = _resolve_visit_dir(visit_id, create=False)
    visit_dir = existing if existing.exists() else _resolve_visit_dir(visit_id, create=True)
    tx_path = visit_dir / "transcription.txt"
    text = "" if transcription is None else str(transcription)
    tx_path.write_text(text, encoding="utf-8")


def _all_visits():
    """Return all visit_metadata.json records from every visit folder."""
    results = []
    if not RUNS_DIR.exists():
        return results
    for meta_path in RUNS_DIR.rglob("visit_metadata.json"):
        if meta_path.exists():
            try:
                results.append(json.loads(meta_path.read_text(encoding="utf-8")))
            except Exception:
                pass
    return results


def _read_json_file(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Demo seed ─────────────────────────────────────────────────────────────────

def seed_demo_data():
    """
    Seed two demo patients and their visits on first startup.
    Uses the same IDs as the old localStorage seed so existing
    demo report pages continue to work.
    """
    patients = _read_patients()
    existing_ids = {p["id"] for p in patients}

    demo_patients = [
        {
            "id": "patient-demo-1",
            "first_name": "Michael",
            "last_name": "Reyes",
            "date_of_birth": "1962-09-21",
            "gender": "male",
            "medical_record_number": "MRN-CC-2048",
            "primary_diagnosis": "Suspected Parkinson disease",
            "created_date": "2025-01-15T10:00:00Z",
            "updated_date": "2025-01-15T10:00:00Z",
        },
        {
            "id": "patient-demo-2",
            "first_name": "Sarah",
            "last_name": "Martinez",
            "date_of_birth": "1986-04-10",
            "gender": "female",
            "medical_record_number": "MRN-12345",
            "primary_diagnosis": "Fibromyalgia syndrome (working diagnosis)",
            "created_date": "2025-10-01T10:00:00Z",
            "updated_date": "2025-10-01T10:00:00Z",
        },
    ]

    changed = False
    for dp in demo_patients:
        if dp["id"] not in existing_ids:
            patients.append(dp)
            changed = True

    if changed:
        _write_patients(patients)
        print("[Seed] Demo patients written to patients.json")

    # Seed a demo visit for Sarah if not present
    demo_visit_id = "visit-demo-2"
    if _read_visit_metadata(demo_visit_id) is None:
        demo_visit = {
            "id": demo_visit_id,
            "patient_id": "patient-demo-2",
            "visit_number": 1,
            "visit_date": "2025-10-29",
            "chief_complaint": "Pain all over entire body",
            "transcription": (
                "I have pain all over my body - my joints ache, muscles are sore and stiff. "
                "Severe headache and nausea. I'm dizzy when standing. "
                "Extreme fatigue and weakness. Can't sleep at night. "
                "My stomach hurts and I feel bloated. Everything aches and hurts constantly."
            ),
            "physician_notes": "",
            "bp_systolic": 128,
            "bp_diastolic": 82,
            "heart_rate": 88,
            "respiratory_rate": 18,
            "temperature": 98.6,
            "temperature_unit": "fahrenheit",
            "spo2": 97,
            "created_date": "2025-10-29T15:00:00Z",
            "updated_date": "2025-10-29T15:00:00Z",
        }
        _write_visit_metadata(demo_visit_id, demo_visit)

        # Also create manifest for demo visit
        demo_visit_dir = _resolve_visit_dir(demo_visit_id, patient_id="patient-demo-2", create=True)
        demo_manifest_path = demo_visit_dir / "manifest.json"
        if not demo_manifest_path.exists():
            demo_manifest = {
                "schema_version": "v0.1",
                "visit_id": demo_visit_id,
                "patient_id": "patient-demo-2",
                "created_utc": "2025-10-29T15:00:00Z",
                "expected_subsystems": ["audio", "face", "gait"],
                "status": {"audio": "pending", "face": "pending", "gait": "pending"},
            }
            demo_manifest_path.parent.mkdir(parents=True, exist_ok=True)
            demo_manifest_path.write_text(json.dumps(demo_manifest, indent=2), encoding="utf-8")

        print("[Seed] Demo visit written for Sarah Martinez")


# ── Patient endpoints ─────────────────────────────────────────────────────────

@app.route('/api/patients', methods=['GET'])
def list_patients():
    return jsonify(_read_patients())


@app.route('/api/patients', methods=['POST'])
def create_patient():
    data = request.get_json(silent=True) or {}
    patients = _read_patients()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    new_patient = {
        **data,
        "id": data.get("id") or str(uuid.uuid4()),
        "created_date": data.get("created_date") or now,
        "updated_date": now,
    }
    patients.append(new_patient)
    _write_patients(patients)
    print(f"[Patient] Created: {new_patient['id']} — {new_patient.get('first_name')} {new_patient.get('last_name')}")
    return jsonify(new_patient), 201


@app.route('/api/patients/<patient_id>', methods=['GET'])
def get_patient(patient_id):
    patients = _read_patients()
    p = next((x for x in patients if x["id"] == patient_id), None)
    if not p:
        return jsonify({"error": "Patient not found"}), 404
    return jsonify(p)


@app.route('/api/patients/<patient_id>', methods=['PATCH'])
def update_patient(patient_id):
    data = request.get_json(silent=True) or {}
    patients = _read_patients()
    idx = next((i for i, p in enumerate(patients) if p["id"] == patient_id), None)
    if idx is None:
        return jsonify({"error": "Patient not found"}), 404
    patients[idx] = {
        **patients[idx],
        **data,
        "updated_date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _write_patients(patients)
    return jsonify(patients[idx])


@app.route('/api/patients/<patient_id>', methods=['DELETE'])
def delete_patient(patient_id):
    patients = _read_patients()
    new_list = [p for p in patients if p["id"] != patient_id]
    if len(new_list) == len(patients):
        return jsonify({"error": "Patient not found"}), 404

    deleted_visit_dirs = []
    if RUNS_DIR.exists():
        for visit_dir in RUNS_DIR.rglob("visit_*"):
            if not visit_dir.is_dir() or not visit_dir.name.startswith("visit_"):
                continue

            visit_matches_patient = False

            # Match canonical temp/pre-rename folder pattern: visit_<patient_id>
            if visit_dir.name == f"visit_{patient_id}":
                visit_matches_patient = True
            else:
                # Match persisted visits by metadata patient_id
                meta_path = visit_dir / "visit_metadata.json"
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text(encoding="utf-8"))
                        if str(meta.get("patient_id", "")) == str(patient_id):
                            visit_matches_patient = True
                    except Exception:
                        pass

                # Match manifest fallback if metadata is missing
                if not visit_matches_patient:
                    manifest_path = visit_dir / "manifest.json"
                    if manifest_path.exists():
                        try:
                            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                            if str(manifest.get("patient_id", "")) == str(patient_id):
                                visit_matches_patient = True
                        except Exception:
                            pass

            if visit_matches_patient:
                shutil.rmtree(visit_dir, ignore_errors=True)
                deleted_visit_dirs.append(visit_dir.name)

        for d in RUNS_DIR.iterdir():
            if d.is_dir():
                try:
                    next(d.iterdir())
                except StopIteration:
                    d.rmdir()

    _write_patients(new_list)
    print(f"[Patient] Deleted: {patient_id} (removed visit dirs: {deleted_visit_dirs})")
    return jsonify({"success": True, "deleted_visit_dirs": deleted_visit_dirs})


# ── Visit endpoints ───────────────────────────────────────────────────────────

@app.route('/api/visits', methods=['GET'])
def list_visits():
    return jsonify(_all_visits())


@app.route('/api/visits', methods=['POST'])
def create_visit():
    data = request.get_json(silent=True) or {}
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    visit_id = data.get("id") or str(uuid.uuid4())

    visit_metadata = {
        **data,
        "id": visit_id,
        "created_date": data.get("created_date") or now,
        "updated_date": now,
    }

    # Write visit_metadata.json
    _write_visit_metadata(visit_id, visit_metadata)

    # Create manifest.json for the subsystem pipeline
    visit_dir = _resolve_visit_dir(visit_id, patient_id=data.get("patient_id"), create=True)
    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_id": data.get("patient_id", ""),
            "created_utc": now,
            "expected_subsystems": ["audio", "face", "gait"],
            "status": {"audio": "pending", "face": "pending", "gait": "pending"},
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[Visit] Created: visit_{visit_id}")
    return jsonify(visit_metadata), 201


@app.route('/api/visits/<visit_id>', methods=['GET'])
def get_visit(visit_id):
    meta = _read_visit_metadata(visit_id)
    if not meta:
        return jsonify({"error": "Visit not found"}), 404
    return jsonify(meta)


@app.route('/api/visits/<visit_id>', methods=['PATCH'])
def update_visit(visit_id):
    data = request.get_json(silent=True) or {}
    meta = _read_visit_metadata(visit_id)
    if not meta:
        return jsonify({"error": "Visit not found"}), 404
    meta = {
        **meta,
        **data,
        "updated_date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _write_visit_metadata(visit_id, meta)
    return jsonify(meta)


@app.route('/api/visits/<visit_id>', methods=['DELETE'])
def delete_visit(visit_id):
    meta = _read_visit_metadata(visit_id)
    if not meta:
        return jsonify({"error": "Visit not found"}), 404
    visit_dir = _resolve_visit_dir(visit_id, patient_id=meta.get("patient_id"), create=False)
    shutil.rmtree(visit_dir, ignore_errors=True)
    print(f"[Visit] Deleted: visit_{visit_id}")
    return jsonify({"success": True})


# ── Dev utility ───────────────────────────────────────────────────────────────

@app.route('/api/dev/clear', methods=['POST'])
def dev_clear():
    """Dev-only: wipe patients.json and all visit_metadata.json files."""
    if PATIENTS_FILE.exists():
        PATIENTS_FILE.unlink()
    if RUNS_DIR.exists():
        for meta in RUNS_DIR.rglob("visit_metadata.json"):
            try:
                meta.unlink()
            except Exception:
                pass
    seed_demo_data()
    return jsonify({"status": "cleared and reseeded"})
if __name__ == '__main__':
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    seed_demo_data()
    moved = _migrate_runs_to_mrn_structure()
    if moved:
        print(f"[Migration] Moved {len(moved)} visit folder(s) to MRN structure")
    print("Starting transcription server on http://localhost:5000")
    print(f"Visit artifacts will be saved to: {RUNS_DIR.resolve()}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)