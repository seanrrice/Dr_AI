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

active_face_processes = {}

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

def cleanup_dead_face_processes():
    dead = []
    for visit_id, proc in active_face_processes.items():
        if proc.poll() is not None:
            dead.append(visit_id)
    for visit_id in dead:
        active_face_processes.pop(visit_id, None)

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
    cleanup_dead_face_processes()

    data = request.get_json(silent=True) or {}
    visit_id = data.get("visit_id")
    patient_id = data.get("patient_id")
    camera_index = int(data.get("camera_index", 0))  # default to 0 for most laptops/webcams

    if not visit_id or not patient_id:
        return jsonify({"error": "visit_id and patient_id are required"}), 400

    if visit_id in active_face_processes:
        proc = active_face_processes[visit_id]
        if proc.poll() is None:
            return jsonify({"error": f"Face analysis already running for visit {visit_id}"}), 400
        active_face_processes.pop(visit_id, None)

    visit_dir = RUNS_DIR / f"visit_{visit_id}"
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

    face_script = get_face_script_path()
    if not face_script.exists():
        return jsonify({"error": f"Face script not found: {face_script}"}), 500

    python_exe = get_face_python_executable()

    cmd = [
        python_exe,
        str(face_script),
        "--visit_id", str(visit_id),
        "--patient_id", str(patient_id),
        "--runs_dir", str(RUNS_DIR.resolve()),
        "--camera_index", str(camera_index),
    ]

    try:
        visit_dir = RUNS_DIR / f"visit_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)

        face_log_path = visit_dir / "face_subprocess.log"
        log_f = open(face_log_path, "a", encoding="utf-8")
        proc = subprocess.Popen(
            cmd,
            cwd=str(get_repo_root()),
            stdout=log_f,
            stderr=subprocess.STDOUT,
        )

        active_face_processes[visit_id] = proc
        print(f"[Face] Logging to {face_log_path}")
        print(f"[Face] Started face analysis for visit {visit_id}: {' '.join(cmd)}")
        return jsonify({
            "status": "ok",
            "visit_id": visit_id,
            "pid": proc.pid,
            "message": "Face analysis started"
        })
    except Exception as e:
        return jsonify({"error": f"Failed to start face analysis: {e}"}), 500


@app.route('/api/face/stop', methods=['POST'])
def stop_face_analysis():
    cleanup_dead_face_processes()

    data = request.get_json(silent=True) or {}
    visit_id = data.get("visit_id")

    if not visit_id:
        return jsonify({"error": "visit_id is required"}), 400

    proc = active_face_processes.get(visit_id)
    if not proc:
        return jsonify({"error": f"No active face analysis for visit {visit_id}"}), 404

    try:
        visit_dir = RUNS_DIR / f"visit_{visit_id}"
        stop_file = visit_dir / "stop_face.txt"

        # Ask the face script to exit gracefully
        stop_file.write_text("stop", encoding="utf-8")
        print(f"[Face] Stop signal written for visit {visit_id}")

        # Give the process a few seconds to exit cleanly
        if proc.poll() is None:
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                print(f"[Face] Graceful stop timed out for visit {visit_id}; killing process")
                proc.kill()
                proc.wait(timeout=5)

        active_face_processes.pop(visit_id, None)
        print(f"[Face] Stopped face analysis for visit {visit_id}")
        return jsonify({"status": "ok", "visit_id": visit_id, "message": "Face analysis stopped"})
    except Exception as e:
        return jsonify({"error": f"Failed to stop face analysis: {e}"}), 500


@app.route('/api/face/status', methods=['GET'])
def get_face_analysis_status():
    cleanup_dead_face_processes()

    visit_id = request.args.get("visit_id")
    if not visit_id:
        return jsonify({"error": "visit_id is required"}), 400

    proc = active_face_processes.get(visit_id)
    is_running = proc is not None and proc.poll() is None

    return jsonify({
        "visit_id": visit_id,
        "running": is_running,
        "pid": proc.pid if is_running else None,
    })

# ====== Visit Management Endpoints ======

RUNS_DIR = Path("runs")

@app.route('/api/visits/<visit_id>/create', methods=['POST'])
def create_visit(visit_id):
    data = request.get_json(silent=True) or {}
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)

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
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)
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

    print(f"[Visit] Audio JSONL saved → {audio_path} ({len(records)} records)")
    return jsonify({"status": "ok", "records": len(records)})


@app.route('/api/visits/rename', methods=['POST'])
def rename_visit_folder():
    data = request.get_json(silent=True) or {}
    old_id = data.get("from")
    new_id = data.get("to")
    if not old_id or not new_id:
        return jsonify({"error": "missing from/to"}), 400
    old_dir = RUNS_DIR / f"visit_{old_id}"
    new_dir = RUNS_DIR / f"visit_{new_id}"
    if old_dir.exists():
        new_dir.mkdir(parents=True, exist_ok=True)
        for file in old_dir.iterdir():
            shutil.copy2(str(file), str(new_dir / file.name))
        print(f"[Visit] Copied folder: {old_dir} → {new_dir}")
    return jsonify({"status": "ok"})


@app.route('/api/visits/<visit_id>/report', methods=['GET'])
def get_report(visit_id):
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
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
            summary = next((r for r in records if r.get("type") == "summary"), records[0] if records else None)
            result["sections"]["gait"] = summary
            result["availability"]["gait"] = "available"
        except Exception as e:
            print(f"[Report] Error reading gait.jsonl: {e}")
    return jsonify(result)


@app.route('/api/visits/<visit_id>/status', methods=['GET'])
def get_visit_status(visit_id):
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
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
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
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
        summary = get_summary(gait_records)
        sections["gait"] = summary or {}
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
if __name__ == '__main__':
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    print("Starting transcription server on http://localhost:5000")
    print(f"Visit artifacts will be saved to: {RUNS_DIR.resolve()}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)