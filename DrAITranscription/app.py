# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import asyncio
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import socket
from pathlib import Path
from datetime import datetime
from urllib.parse import quote, urlparse

import numpy as np
import sounddevice as sd
import websockets

#Ensure repo root is in sys.path for imports
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# For facial analysis subprocess management
from threading import Event, Lock
import cv2
from emotion_pipeline.webcam_emotion_mediapipe import run_face_analysis
from flask import Response

# WhisperLiveKit: native WebSocket /asr (PCM) — VAC/VAD/chunking handled server-side
# Default to 8001 so it does not collide with the gait dev server on 8000.
WHISPERLIVEKIT_BASE_URL = os.environ.get("WHISPERLIVEKIT_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
WHISPERLIVEKIT_WS_PATH = os.environ.get("WHISPERLIVEKIT_WS_PATH", "/asr")
WHISPERLIVEKIT_WS_PATH_CANDIDATES = os.environ.get(
    "WHISPERLIVEKIT_WS_PATH_CANDIDATES",
    "/,/asr,/ws,/v1/asr,/v1/ws,/transcribe,/api/asr",
)
WHISPERLIVEKIT_AUTOSTART = os.environ.get("WHISPERLIVEKIT_AUTOSTART", "1").strip().lower() not in ("0", "false", "no")
WHISPERLIVEKIT_MODEL = os.environ.get("WHISPERLIVEKIT_MODEL", "base.en")
WHISPERLIVEKIT_LANGUAGE = os.environ.get("WHISPERLIVEKIT_LANGUAGE", "en")
WHISPERLIVEKIT_BACKEND = os.environ.get("WHISPERLIVEKIT_BACKEND", "faster-whisper")
WHISPERLIVEKIT_HEALTH_TIMEOUT_S = float(os.environ.get("WHISPERLIVEKIT_HEALTH_TIMEOUT_S", "3"))
WHISPERLIVEKIT_STARTUP_TIMEOUT_S = float(os.environ.get("WHISPERLIVEKIT_STARTUP_TIMEOUT_S", "180"))
# Extra CLI args for whisperlivekit-server.
# Lower chunk sizes improve perceived latency for live partials.
WHISPERLIVEKIT_SERVER_EXTRA_ARGS = os.environ.get(
    "WHISPERLIVEKIT_SERVER_EXTRA_ARGS",
    "--vac-chunk-size 0.04 --min-chunk-size 0.08",
)

# ================= CONFIG =================
# Try device 24 first (may give true stereo on some drivers); fallback to 15
DEVICE_INDEX = 24     # PreSonus AudioBox USB 96 (callback-only on some Windows setups)
DEVICE_INDEX_FALLBACK = 15   # Fallback if 24 fails
SAMPLE_RATE_CAPTURE = 48000
SAMPLE_RATE_WHISPER = 16000
CHANNELS = 2
CHUNK = 1536
# Callback-based capture (required for device 24 on Windows when blocking fails)
USE_CALLBACK_CAPTURE = True
RMS_DISPLAY_INTERVAL = 0.1  # seconds between RMS console updates

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


def _parse_http_host_port(base_url: str):
    u = urlparse(base_url)
    host = u.hostname or "127.0.0.1"
    if u.port is not None:
        port = u.port
    elif u.scheme == "https":
        port = 443
    else:
        port = 8001
    return host, port


def _http_to_ws_base(base_url: str) -> str:
    u = urlparse(base_url)
    scheme = "wss" if u.scheme == "https" else "ws"
    host = u.hostname or "127.0.0.1"
    port = u.port
    if port is None:
        port = 443 if u.scheme == "https" else 8001
    return f"{scheme}://{host}:{port}"


def _build_asr_websocket_url() -> str:
    base = _http_to_ws_base(WHISPERLIVEKIT_BASE_URL)
    path = WHISPERLIVEKIT_WS_PATH if WHISPERLIVEKIT_WS_PATH.startswith("/") else f"/{WHISPERLIVEKIT_WS_PATH}"
    lang = (WHISPERLIVEKIT_LANGUAGE or "").strip().lower()
    if lang and lang not in ("auto", "none"):
        return f"{base}{path}?language={quote(WHISPERLIVEKIT_LANGUAGE)}"
    return f"{base}{path}"


def _candidate_asr_websocket_urls():
    base = _http_to_ws_base(WHISPERLIVEKIT_BASE_URL)
    lang = (WHISPERLIVEKIT_LANGUAGE or "").strip().lower()
    raw_candidates = ["/", WHISPERLIVEKIT_WS_PATH] + [
        p.strip() for p in str(WHISPERLIVEKIT_WS_PATH_CANDIDATES or "").split(",") if p.strip()
    ]
    seen = set()
    urls = []
    for raw in raw_candidates:
        path = raw if str(raw).startswith("/") else f"/{raw}"
        if path in seen:
            continue
        seen.add(path)
        if lang and lang not in ("auto", "none"):
            urls.append(f"{base}{path}?language={quote(WHISPERLIVEKIT_LANGUAGE)}")
        else:
            urls.append(f"{base}{path}")
    return urls


def _health_ping_ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        # Some ASR servers are reachable but do not implement /health and return
        # HTTP errors like 404. Treat non-5xx as reachable so startup can proceed.
        return 400 <= int(getattr(e, "code", 0)) < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _tcp_port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


class WhisperLiveKitProcess:
    """Starts whisperlivekit-server (PCM mode) so /asr owns VAC/VAD/chunking."""

    _lock = Lock()
    _proc = None
    _log_path = REPO_ROOT / "runs" / "whisperlivekit_server.log"

    @classmethod
    def _is_running(cls):
        return cls._proc is not None and cls._proc.poll() is None

    @classmethod
    def get_exit_code_if_stopped(cls):
        if cls._proc is None:
            return None
        code = cls._proc.poll()
        if code is None:
            return None
        return code

    @classmethod
    def ensure_started(cls):
        if not WHISPERLIVEKIT_AUTOSTART:
            return
        host, port = _parse_http_host_port(WHISPERLIVEKIT_BASE_URL)
        argv_core = [
            "--host",
            host,
            "--port",
            str(port),
            "--pcm-input",
            "--backend",
            WHISPERLIVEKIT_BACKEND,
            "--model",
            WHISPERLIVEKIT_MODEL,
            "--lan",
            WHISPERLIVEKIT_LANGUAGE or "auto",
        ]
        extra = shlex.split(WHISPERLIVEKIT_SERVER_EXTRA_ARGS.strip() or "", posix=os.name != "nt")
        with cls._lock:
            if cls._is_running():
                return
            # Always launch through the currently running Python interpreter so
            # we use the same venv/package set as this Flask app.
            cmd = [sys.executable, "-m", "whisperlivekit.basic_server"] + argv_core + extra
            try:
                cls._log_path.parent.mkdir(parents=True, exist_ok=True)
                log_f = open(cls._log_path, "a", encoding="utf-8")
                log_f.write(
                    f"\n[{datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}] "
                    f"Launching WhisperLiveKit: {' '.join(cmd)}\n"
                )
                log_f.flush()
                cls._proc = subprocess.Popen(
                    cmd,
                    stdout=log_f,
                    stderr=log_f,
                    env={
                        **os.environ,
                        # Keep WhisperLiveKit on CPU unless user explicitly overrides.
                        "CT2_FORCE_CPU": os.environ.get("CT2_FORCE_CPU", "1"),
                        "CUDA_VISIBLE_DEVICES": os.environ.get("CUDA_VISIBLE_DEVICES", "-1"),
                    },
                )
                # Give the process a moment: if it exits immediately, surface a useful hint.
                time.sleep(0.4)
                if cls._proc.poll() is not None:
                    exit_code = cls._proc.returncode
                    cls._proc = None
                    print(
                        f"[WhisperLiveKit] Server exited immediately (code {exit_code}) on {host}:{port}. "
                        "Likely startup/runtime error. Check runs/whisperlivekit_server.log."
                    )
                    return
                print(
                    f"[WhisperLiveKit] Started server ({' '.join(cmd[:3])} …) on {host}:{port} (--pcm-input)"
                )
            except Exception as e:
                cls._proc = None
                print(f"[WhisperLiveKit] Failed to autostart server: {e}")

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
        self._transcript_lock = threading.Lock()
        self._rms_lock = threading.Lock()
        self._rms_ch1 = 0.0
        self._rms_ch2 = 0.0
        self._last_stream_status_log_at = 0.0
        self._last_rms_update_at = 0.0
        self._stream_stop_event = threading.Event()
        self._session_id = "default"
        self._bridge_thread = None
        self._wlk_loop = None
        self._pcm_q_ch1 = None
        self._pcm_q_ch2 = None
        self._bridge_ready = threading.Event()
        self._routing_ready = threading.Event()
        self._wlk_blocks = {"Mic 1": "", "Mic 2": ""}
        self._wlk_display_lock = threading.Lock()
        self._wlk_connected_lock = threading.Lock()
        self._wlk_connected_mics = set()
        self._last_full_text = ""
        self._last_interim_lines = []

    def _float_chunk_to_pcm_bytes(self, float_ch: np.ndarray) -> bytes:
        y = resample_audio(float_ch.astype(np.float32), SAMPLE_RATE_CAPTURE, SAMPLE_RATE_WHISPER)
        y = np.clip(y, -1.0, 1.0)
        return (y * 32767.0).astype(np.int16).tobytes()

    def _enqueue_pcm_chunk(self, pcm_bytes: bytes, q):
        if self._wlk_loop is None or q is None or not pcm_bytes:
            return

        def _try_put():
            try:
                q.put_nowait(pcm_bytes)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(pcm_bytes)
                except asyncio.QueueFull:
                    pass

        self._wlk_loop.call_soon_threadsafe(_try_put)

    def _format_wlk_block(self, msg: dict, mic_label: str) -> str:
        parts = []
        for line in (msg.get("lines") or []):
            t = (line.get("text") or "").strip()
            if not t or line.get("speaker") == -2:
                continue
            st = line.get("start") or ""
            en = line.get("end") or ""
            parts.append(f"[{st} -> {en}] {mic_label}: {t}")
        buf = (msg.get("buffer_transcription") or "").strip()
        if buf:
            parts.append(f"[interim] {mic_label}: {buf}")
        return "\n".join(parts)

    def _emit_wlk_update(self, session_id: str, mic_label: str, msg: dict):
        with self._wlk_display_lock:
            block = self._format_wlk_block(msg, mic_label)
            self._wlk_blocks[mic_label] = block
            chunks = []
            if self.active_channels == 2:
                for key in ("Mic 1", "Mic 2"):
                    b = (self._wlk_blocks.get(key) or "").strip()
                    if b:
                        chunks.append(b)
            else:
                b = (self._wlk_blocks.get("Mic 1") or "").strip()
                if b:
                    chunks.append(b)
            full_text = "\n\n".join(chunks)
            self._last_full_text = full_text
        buf = (msg.get("buffer_transcription") or "").strip()
        interim = [f"[interim] {mic_label}: {buf}"] if buf else []
        self._last_interim_lines = interim
        delta = buf
        if not delta:
            lines = msg.get("lines") or []
            if lines:
                delta = (lines[-1].get("text") or "").strip()
        if self.callback:
            try:
                self.callback(delta or "")
            except Exception:
                pass
        socketio.emit(
            "transcription_update",
            {
                "session_id": session_id,
                "text": delta or "",
                "full_text": full_text,
                "interim": interim,
            },
        )

    async def _await_wlk_health(self):
        url = f"{WHISPERLIVEKIT_BASE_URL}/health"
        deadline = time.time() + WHISPERLIVEKIT_HEALTH_TIMEOUT_S
        while self.is_running and time.time() < deadline:
            if _health_ping_ok(url):
                return True
            await asyncio.sleep(0.25)
        if not self.is_running:
            return False
        print(
            f"[WhisperLiveKit] Health endpoint not reachable at {url}; "
            "continuing with direct WS connection attempts.",
            flush=True,
        )
        return False

    async def _await_wlk_port_open(self):
        host, port = _parse_http_host_port(WHISPERLIVEKIT_BASE_URL)
        deadline = time.time() + WHISPERLIVEKIT_STARTUP_TIMEOUT_S
        while self.is_running and time.time() < deadline:
            exit_code = WhisperLiveKitProcess.get_exit_code_if_stopped()
            if exit_code is not None:
                print(
                    f"[WhisperLiveKit] Server process exited before port became reachable "
                    f"(exit_code={exit_code}, target={host}:{port}).",
                    flush=True,
                )
                return False
            if _tcp_port_open(host, port):
                print(f"[WhisperLiveKit] Port is now reachable at {host}:{port}", flush=True)
                return True
            await asyncio.sleep(0.5)
        if not self.is_running:
            return False
        print(
            f"[WhisperLiveKit] Port did not open at {host}:{port} within "
            f"{WHISPERLIVEKIT_STARTUP_TIMEOUT_S:.0f}s",
            flush=True,
        )
        return False

    async def _run_one_mic_ws(self, session_id: str, mic_label: str, pcm_queue: asyncio.Queue):
        urls = _candidate_asr_websocket_urls()
        last_error = None
        round_idx = 0
        # Keep trying for a short warmup window so server startup race doesn't
        # leave the session without WS connectivity.
        while self.is_running and round_idx < 8:
            round_idx += 1
            for attempt, uri in enumerate(urls, start=1):
                try:
                    print(
                        f"[WhisperLiveKit] Connecting {mic_label} WS "
                        f"(round {round_idx}, {attempt}/{len(urls)}): {uri}"
                    , flush=True)
                    async with websockets.connect(uri, max_size=None) as ws:
                        with self._wlk_connected_lock:
                            self._wlk_connected_mics.add(mic_label)
                        raw = await ws.recv()
                        if isinstance(raw, str):
                            try:
                                json.loads(raw)
                            except json.JSONDecodeError:
                                pass

                        print(f"[WhisperLiveKit] Connected {mic_label} WS: {uri}", flush=True)

                        async def sender():
                            try:
                                while self.is_running:
                                    try:
                                        chunk = await asyncio.wait_for(pcm_queue.get(), timeout=0.05)
                                    except asyncio.TimeoutError:
                                        continue
                                    await ws.send(chunk)
                            finally:
                                try:
                                    await ws.send(b"")
                                except Exception:
                                    pass

                        async def receiver():
                            while self.is_running:
                                try:
                                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                                except asyncio.TimeoutError:
                                    continue
                                except websockets.exceptions.ConnectionClosed:
                                    break
                                if isinstance(raw, bytes):
                                    continue
                                try:
                                    msg = json.loads(raw)
                                except json.JSONDecodeError:
                                    continue
                                mtype = msg.get("type")
                                if mtype == "ready_to_stop":
                                    break
                                if mtype == "config":
                                    continue
                                self._emit_wlk_update(session_id, mic_label, msg)

                        await asyncio.gather(sender(), receiver())
                        return
                except Exception as e:
                    last_error = e
                    msg = str(e)
                    # Continue trying alternate endpoints if this one is missing.
                    if "HTTP 404" in msg or "404" in msg:
                        print(f"[WhisperLiveKit] WS endpoint not found for {mic_label}: {uri}", flush=True)
                        continue
                    print(f"[WhisperLiveKit] WebSocket error ({mic_label}) at {uri}: {e}", flush=True)
                    continue
                finally:
                    with self._wlk_connected_lock:
                        self._wlk_connected_mics.discard(mic_label)
            await asyncio.sleep(0.5)
        if last_error is not None:
            print(f"[WhisperLiveKit] Failed to connect {mic_label} WS after retries: {last_error}", flush=True)

    async def _wlk_session_main(self, session_id: str):
        print(f"[WhisperLiveKit] Bridge session starting for {session_id}", flush=True)
        WhisperLiveKitProcess.ensure_started()
        health_ok = await self._await_wlk_health()
        print(f"[WhisperLiveKit] Health check result for {session_id}: {health_ok}", flush=True)
        # On first run WhisperLiveKit can spend significant time downloading/loading
        # the model before it starts listening. Wait for port readiness to avoid
        # immediate WS connection-refused loops.
        port_ready = await self._await_wlk_port_open()
        if not port_ready:
            print(f"[WhisperLiveKit] Port not ready for session {session_id}; skipping WS streaming.", flush=True)
            return
        if not self.is_running:
            return
        if self.active_channels == 2:
            await asyncio.gather(
                self._run_one_mic_ws(session_id, "Mic 1", self._pcm_q_ch1),
                self._run_one_mic_ws(session_id, "Mic 2", self._pcm_q_ch2),
            )
        else:
            await self._run_one_mic_ws(session_id, "Mic 1", self._pcm_q_ch1)

    def _bridge_main(self, session_id: str):
        print(f"[WhisperLiveKit] Bridge thread booting for {session_id}", flush=True)
        loop = asyncio.new_event_loop()
        self._wlk_loop = loop
        asyncio.set_event_loop(loop)
        self._pcm_q_ch1 = asyncio.Queue(maxsize=500)
        self._pcm_q_ch2 = asyncio.Queue(maxsize=500) if self.active_channels == 2 else None
        self._bridge_ready.set()
        try:
            loop.run_until_complete(self._wlk_session_main(session_id))
        except Exception as e:
            print(f"[WhisperLiveKit] Bridge stopped: {e}")
        finally:
            loop.close()
            self._wlk_loop = None

    def _capture_callback(self, indata, frames, time_info, status):
        if status:
            now = time.time()
            if now - self._last_stream_status_log_at >= 2.0:
                print(f"[Session] Stream status: {status}")
                self._last_stream_status_log_at = now
        if not (self.is_running and indata is not None and len(indata) > 0):
            return
        now = time.time()
        if now - self._last_rms_update_at >= RMS_DISPLAY_INTERVAL:
            if indata.ndim == 1 or indata.shape[1] == 1:
                r1 = float(np.sqrt(np.mean(indata**2)))
                r2 = 0.0
            else:
                r1 = float(np.sqrt(np.mean(indata[:, 0] ** 2)))
                r2 = float(np.sqrt(np.mean(indata[:, 1] ** 2)))
            with self._rms_lock:
                self._rms_ch1, self._rms_ch2 = r1, r2
            self._last_rms_update_at = now
        if not self._routing_ready.is_set():
            return
        try:
            if indata.ndim == 1 or indata.shape[1] == 1:
                pcm = self._float_chunk_to_pcm_bytes(indata.reshape(-1))
                self._enqueue_pcm_chunk(pcm, self._pcm_q_ch1)
            else:
                pcm1 = self._float_chunk_to_pcm_bytes(indata[:, 0])
                self._enqueue_pcm_chunk(pcm1, self._pcm_q_ch1)
                if self._pcm_q_ch2 is not None:
                    pcm2 = self._float_chunk_to_pcm_bytes(indata[:, 1])
                    self._enqueue_pcm_chunk(pcm2, self._pcm_q_ch2)
        except Exception:
            pass

    def _rms_display_loop(self):
        while self.is_running:
            with self._rms_lock:
                r1, r2 = self._rms_ch1, self._rms_ch2
            print(f"\rRMS -> Mic 1: {r1:.3f}, Mic 2: {r2:.3f}", end="", flush=True)
            time.sleep(RMS_DISPLAY_INTERVAL)

    def start(self, session_id="default"):
        self._session_id = session_id
        self.is_running = True
        self._stream_stop_event.clear()
        self._bridge_ready.clear()
        self._routing_ready.clear()
        self._wlk_blocks = {"Mic 1": "", "Mic 2": ""}
        self._last_full_text = ""
        self._last_interim_lines = []
        requested_channels = self.channels_requested
        selected_device = self.device_index
        device = selected_device if selected_device is not None else DEVICE_INDEX
        use_callback = USE_CALLBACK_CAPTURE

        if not use_callback:
            print("[Session] USE_CALLBACK_CAPTURE must be True for WhisperLiveKit streaming.")
            self.is_running = False
            return

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
                        dtype="float32",
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
                            dtype="float32",
                            blocksize=CHUNK,
                            callback=self._capture_callback,
                        )
                        self.stream.start()
                        self.active_channels = 1
                        print(f"[Session] Device {try_device} does not support stereo, using mono.")
                    else:
                        raise
                print(f"[Transcription] Capture started (device {try_device}, channels={self.active_channels})")
                break
            except sd.PortAudioError as e:
                if try_device != devices_to_try[-1]:
                    print(f"[Session] Device {try_device} failed: {e}, trying fallback {devices_to_try[-1]}")
                else:
                    print(f"[Session] Audio input error: {e}")
                    self.is_running = False
                    return

        self._bridge_thread = threading.Thread(target=self._bridge_main, args=(session_id,), daemon=True)
        self._bridge_thread.start()
        if not self._bridge_ready.wait(timeout=30.0):
            print("[Session] WhisperLiveKit bridge failed to initialize.")
            self.stop()
            return
        self._routing_ready.set()

        try:
            rms_thread = threading.Thread(target=self._rms_display_loop, daemon=True)
            rms_thread.start()
            while self.is_running and not self._stream_stop_event.is_set():
                time.sleep(0.25)
        except Exception as e:
            print(f"[Session] Exception in audio loop: {e}")
        finally:
            self.stop()

    def stop(self):
        self.is_running = False
        self._routing_ready.clear()
        self._stream_stop_event.set()
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
        if self._bridge_thread and self._bridge_thread.is_alive():
            self._bridge_thread.join(timeout=8.0)
        self._bridge_thread = None

    def get_full_transcript(self):
        with self._wlk_display_lock:
            if self._last_full_text.strip():
                return self._last_full_text
        with self._transcript_lock:
            return "\n".join(self.transcripts)

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
    # Real-time emits: TranscriptionSession -> WhisperLiveKit /asr WebSocket -> socketio
    session.callback = None
    thread = threading.Thread(target=session.start, args=(session_id,), daemon=True)
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
        host_apis = sd.query_hostapis()
        input_devices = []
        for idx, dev in enumerate(devices):
            max_input_channels = int(dev.get('max_input_channels', 0) or 0)
            if max_input_channels > 0:
                hostapi_idx = dev.get('hostapi')
                hostapi_name = ""
                if isinstance(hostapi_idx, (int, float)):
                    hidx = int(hostapi_idx)
                    if 0 <= hidx < len(host_apis):
                        hostapi_name = host_apis[hidx].get('name', '')
                input_devices.append({
                    'index': idx,
                    'name': dev.get('name', f'Input {idx}'),
                    'max_input_channels': max_input_channels,
                    'default_samplerate': dev.get('default_samplerate'),
                    'hostapi_name': hostapi_name,
                })
        return jsonify({'devices': input_devices})
    except Exception as e:
        return jsonify({'error': f'Failed to enumerate devices: {e}'}), 500

@app.route('/api/transcription/stop', methods=['POST'])
def stop_transcription():
    data = request.get_json(silent=True)
    session_id = (data or {}).get('session_id', 'default')

    # Idempotent stop: if a duplicate stop arrives after a successful stop,
    # return success instead of 404/500 so the UI can settle cleanly.
    session = active_sessions.pop(session_id, None)
    if session is None:
        return jsonify({
            'success': True,
            'session_id': session_id,
            'full_text': '',
            'message': 'Session already stopped'
        })

    session.stop()
    full_transcript = session.get_full_transcript()

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
        with session._wlk_display_lock:
            if session._last_full_text.strip():
                count = max(count, len([ln for ln in session._last_full_text.splitlines() if ln.strip()]))
        return jsonify({
            'active': session.is_running,
            'session_id': session_id,
            'transcript_count': count,
            'expected_mics': session.active_channels,
            'connected_mics': len(session._wlk_connected_mics),
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
    patient_mrn = data.get("patient_mrn")
    camera_index = int(data.get("camera_index", 0))

    if not visit_id or not patient_mrn:
        return jsonify({"error": "visit_id and patient_mrn are required"}), 400

    if visit_id in active_face_sessions:
        session = active_face_sessions[visit_id]
        thread = session.get("thread")
        if thread and thread.is_alive():
            return jsonify({"error": f"Face analysis already running for visit {visit_id}"}), 400
        active_face_sessions.pop(visit_id, None)

    visit_dir = _resolve_visit_dir(visit_id, patient_mrn=patient_mrn, create=True)
    visit_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_mrn": patient_mrn,
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
                        patient_id=patient_mrn,
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


def _patient_runs_dir(patient_mrn):
    mrn = str(patient_mrn or "").strip()
    if not mrn:
        return None
    return RUNS_DIR / _safe_folder_name(mrn)


def _legacy_visit_dir(visit_id):
    return RUNS_DIR / f"visit_{visit_id}"


def _nested_visit_dir(visit_id, patient_mrn):
    patient_dir = _patient_runs_dir(patient_mrn)
    if not patient_dir:
        return None
    return patient_dir / f"visit_{visit_id}"


def _iter_nested_visit_dirs(visit_id, patient_mrn=None):
    if not RUNS_DIR.exists():
        return

    if patient_mrn:
        patient_dir = _patient_runs_dir(patient_mrn)
        if patient_dir and patient_dir.exists() and patient_dir.is_dir():
            candidate = patient_dir / f"visit_{visit_id}"
            if candidate.exists() and candidate.is_dir():
                yield candidate
        return

    for child in RUNS_DIR.iterdir():
        if not child.is_dir():
            continue
        candidate = child / f"visit_{visit_id}"
        if candidate.exists() and candidate.is_dir():
            yield candidate


def _find_existing_visit_dir(visit_id, patient_mrn=None):
    for d in _iter_nested_visit_dirs(visit_id, patient_mrn=patient_mrn):
        return d
    legacy = _legacy_visit_dir(visit_id)
    if legacy.exists() and legacy.is_dir():
        if not patient_mrn:
            return legacy
        meta = _read_json_file(legacy / "visit_metadata.json") or {}
        manifest = _read_manifest_from_dir(legacy) or {}
        legacy_mrn = (
            str(meta.get("patient_mrn") or manifest.get("patient_mrn") or "")
            .strip()
            .lower()
        )
        if legacy_mrn and legacy_mrn == str(patient_mrn).strip().lower():
            return legacy
    return None


def _resolve_visit_dir(visit_id, patient_mrn=None, create=False):
    existing = _find_existing_visit_dir(visit_id, patient_mrn=patient_mrn)
    if existing:
        return existing

    if patient_mrn:
        nested = _nested_visit_dir(visit_id, patient_mrn)
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
        patient_mrn = meta.get("patient_mrn") or manifest.get("patient_mrn")
        if not patient_mrn:
            continue
        target_dir = _nested_visit_dir(visit_id, patient_mrn)
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
    patient_mrn = data.get("patient_mrn", "")
    visit_dir = _resolve_visit_dir(visit_id, patient_mrn=patient_mrn, create=True)

    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_mrn": patient_mrn,
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
    visit_dir = _resolve_visit_dir(
        visit_id,
        patient_mrn=data.get("patient_mrn"),
        create=True,
    )
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
    visit_dir = _resolve_visit_dir(
        visit_id,
        patient_mrn=data.get("patient_mrn"),
        create=True,
    )
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
    patient_mrn = data.get("patient_mrn")
    if not patient_mrn:
        old_meta = _read_visit_metadata(old_id) or {}
        old_manifest = _read_manifest_from_dir(_resolve_visit_dir(old_id, create=False)) or {}
        patient_mrn = (
            old_meta.get("patient_mrn")
            or old_manifest.get("patient_mrn")
            or None
        )
    if not old_id or not new_id:
        return jsonify({"error": "missing from/to"}), 400
    old_dir = _resolve_visit_dir(old_id, patient_mrn=patient_mrn, create=False)
    new_dir = _resolve_visit_dir(new_id, patient_mrn=patient_mrn, create=True)
    try:
        if old_dir.resolve() == new_dir.resolve():
            print(f"[Visit] Rename no-op (same folder): {old_dir}")
            return jsonify({"status": "ok", "note": "same-folder no-op"})
    except Exception:
        pass

    if old_dir.exists():
        new_dir.mkdir(parents=True, exist_ok=True)
        for file in old_dir.iterdir():
            dst = new_dir / file.name
            try:
                if file.resolve() == dst.resolve():
                    continue
            except Exception:
                pass
            shutil.copy2(str(file), str(dst))
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

    # Extract MRN
    visit_id_clean = visit_id
    patient_mrn = None
    for rec in (audio_records + face_records + gait_records):
        if rec.get("patient_mrn"):
            patient_mrn = rec["patient_mrn"]
            break

    report = {
        "schema_version": "v0.1",
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "visit_id": visit_id_clean,
        "patient_mrn": patient_mrn,
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


def _read_visit_metadata(visit_id, patient_mrn=None):
    path = _resolve_visit_dir(visit_id, patient_mrn=patient_mrn, create=False) / "visit_metadata.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_visit_metadata(visit_id, data):
    visit_dir = _resolve_visit_dir(
        visit_id,
        patient_mrn=data.get("patient_mrn"),
        create=True,
    )
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


def _next_visit_serial(patient_mrn):
    """Return next per-patient visit serial as a string."""
    visits = [
        v for v in _all_visits()
        if str(v.get("patient_mrn", "")).strip().lower() == str(patient_mrn or "").strip().lower()
    ]
    max_n = 0
    for v in visits:
        for candidate in (v.get("visit_number"), v.get("id")):
            try:
                n = int(str(candidate).strip())
                if n > max_n:
                    max_n = n
            except Exception:
                continue
    return str(max_n + 1)


def _read_json_file(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── No automatic demo patient seeding ─────────────────────────────────────────


# ── Patient endpoints ─────────────────────────────────────────────────────────

@app.route('/api/patients', methods=['GET'])
def list_patients():
    return jsonify(_read_patients())


@app.route('/api/patients', methods=['POST'])
def create_patient():
    data = request.get_json(silent=True) or {}
    patients = _read_patients()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    mrn = str(data.get("medical_record_number") or "").strip()
    if not mrn:
        return jsonify({"error": "medical_record_number is required"}), 400
    if any(str(p.get("medical_record_number", "")).strip().lower() == mrn.lower() for p in patients):
        return jsonify({"error": "medical_record_number already exists"}), 409
    new_patient = {
        **data,
        "medical_record_number": mrn,
        "created_date": data.get("created_date") or now,
        "updated_date": now,
    }
    patients.append(new_patient)
    _write_patients(patients)
    print(f"[Patient] Created: {new_patient['medical_record_number']} — {new_patient.get('first_name')} {new_patient.get('last_name')}")
    return jsonify(new_patient), 201


@app.route('/api/patients/<patient_mrn>', methods=['GET'])
def get_patient(patient_mrn):
    patients = _read_patients()
    p = next((x for x in patients if str(x.get("medical_record_number", "")).strip().lower() == str(patient_mrn).strip().lower()), None)
    if not p:
        return jsonify({"error": "Patient not found"}), 404
    return jsonify(p)


@app.route('/api/patients/<patient_mrn>', methods=['PATCH'])
def update_patient(patient_mrn):
    data = request.get_json(silent=True) or {}
    patients = _read_patients()
    idx = next(
        (
            i
            for i, p in enumerate(patients)
            if str(p.get("medical_record_number", "")).strip().lower() == str(patient_mrn).strip().lower()
        ),
        None,
    )
    if idx is None:
        return jsonify({"error": "Patient not found"}), 404
    if "medical_record_number" in data:
        new_mrn = str(data.get("medical_record_number") or "").strip()
        if not new_mrn:
            return jsonify({"error": "medical_record_number cannot be empty"}), 400
        dup = next(
            (
                p
                for p in patients
                if p is not patients[idx]
                and str(p.get("medical_record_number", "")).strip().lower() == new_mrn.lower()
            ),
            None,
        )
        if dup:
            return jsonify({"error": "medical_record_number already exists"}), 409
    patients[idx] = {
        **patients[idx],
        **data,
        "updated_date": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _write_patients(patients)
    return jsonify(patients[idx])


@app.route('/api/patients/<patient_mrn>', methods=['DELETE'])
def delete_patient(patient_mrn):
    patients = _read_patients()
    new_list = [
        p
        for p in patients
        if str(p.get("medical_record_number", "")).strip().lower() != str(patient_mrn).strip().lower()
    ]
    if len(new_list) == len(patients):
        return jsonify({"error": "Patient not found"}), 404

    deleted_visit_dirs = []
    if RUNS_DIR.exists():
        for visit_dir in RUNS_DIR.rglob("visit_*"):
            if not visit_dir.is_dir() or not visit_dir.name.startswith("visit_"):
                continue

            visit_matches_patient = False

            # Match persisted visits by metadata patient_mrn
            meta_path = visit_dir / "visit_metadata.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    mmrn = str(meta.get("patient_mrn") or "").strip().lower()
                    if mmrn == str(patient_mrn).strip().lower():
                        visit_matches_patient = True
                except Exception:
                    pass

            # Match manifest fallback if metadata is missing
            if not visit_matches_patient:
                manifest_path = visit_dir / "manifest.json"
                if manifest_path.exists():
                    try:
                        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                        mmrn = str(manifest.get("patient_mrn") or "").strip().lower()
                        if mmrn == str(patient_mrn).strip().lower():
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
    print(f"[Patient] Deleted: {patient_mrn} (removed visit dirs: {deleted_visit_dirs})")
    return jsonify({"success": True, "deleted_visit_dirs": deleted_visit_dirs})


# ── Visit endpoints ───────────────────────────────────────────────────────────

@app.route('/api/visits', methods=['GET'])
def list_visits():
    return jsonify(_all_visits())


@app.route('/api/visits', methods=['POST'])
def create_visit():
    data = request.get_json(silent=True) or {}
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    patient_mrn = data.get("patient_mrn")
    if not patient_mrn:
        return jsonify({"error": "patient_mrn is required"}), 400
    visit_id = str(data.get("id") or _next_visit_serial(patient_mrn)).strip()
    if not visit_id:
        visit_id = _next_visit_serial(patient_mrn)
    if _read_visit_metadata(visit_id, patient_mrn=patient_mrn) is not None:
        return jsonify({"error": "visit_id already exists"}), 409
    visit_number = data.get("visit_number")
    if visit_number in (None, ""):
        try:
            visit_number = int(visit_id)
        except Exception:
            visit_number = int(_next_visit_serial(patient_mrn))

    visit_metadata = {
        **data,
        "id": visit_id,
        "patient_mrn": patient_mrn,
        "visit_number": visit_number,
        "created_date": data.get("created_date") or now,
        "updated_date": now,
    }

    # Write visit_metadata.json
    _write_visit_metadata(visit_id, visit_metadata)

    # Create manifest.json for the subsystem pipeline
    visit_dir = _resolve_visit_dir(visit_id, patient_mrn=patient_mrn, create=True)
    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "schema_version": "v0.1",
            "visit_id": visit_id,
            "patient_mrn": patient_mrn,
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
    visit_dir = _resolve_visit_dir(
        visit_id,
        patient_mrn=meta.get("patient_mrn"),
        create=False,
    )
    shutil.rmtree(visit_dir, ignore_errors=True)
    print(f"[Visit] Deleted: visit_{visit_id}")
    return jsonify({"success": True})


# ── Dev utility ───────────────────────────────────────────────────────────────

@app.route('/api/dev/clear', methods=['POST'])
def dev_clear():
    """Dev-only: wipe patients.json and all visit artifacts."""
    if PATIENTS_FILE.exists():
        PATIENTS_FILE.unlink()
    if RUNS_DIR.exists():
        shutil.rmtree(RUNS_DIR, ignore_errors=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    return jsonify({"status": "cleared"})
if __name__ == '__main__':
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    moved = _migrate_runs_to_mrn_structure()
    if moved:
        print(f"[Migration] Moved {len(moved)} visit folder(s) to MRN structure")
    print("Starting transcription server on http://localhost:5000")
    print(f"Visit artifacts will be saved to: {RUNS_DIR.resolve()}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)