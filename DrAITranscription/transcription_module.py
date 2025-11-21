import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import wave
import tempfile
import numpy as np
import sounddevice as sd
import time
from datetime import timedelta
from faster_whisper import WhisperModel
from threading import Event

# Module-level shared model to allow loading once at server start
GLOBAL_MODEL = None


def load_global_model(model_name: str = "small.en", device: str = "cpu", compute_type: str = "int8") -> bool:
    """Load the Whisper model into the module-level GLOBAL_MODEL so all sessions reuse it.

    Returns True on success, False on failure.
    """
    global GLOBAL_MODEL
    if GLOBAL_MODEL is not None:
        print("[transcription_module] GLOBAL_MODEL already loaded")
        return True

    try:
        print(f"[transcription_module] Preloading WhisperModel '{model_name}' on device={device}...")
        GLOBAL_MODEL = WhisperModel(model_name, device=device, compute_type=compute_type)
        print("[transcription_module] GLOBAL_MODEL loaded successfully")
        return True
    except Exception as e:
        print(f"[transcription_module] Failed to preload GLOBAL_MODEL: {e}")
        return False

# ========= CONFIG =========
SAMPLE_RATE = 16000
CHANNELS = 2       # 2 for interface, auto-falls back to 1 if not available
DEVICE_INDEX = None  # None = default input device
SILENCE_THRESHOLD = 300   # lower = more sensitive
MIN_SPEECH = 0.5          # seconds of minimum speech before a pause can trigger
SILENCE_DURATION = 0.8     # seconds of silence that defines a pause
# ==========================

# ====== AUDIO HELPERS ======
try:
    import audioop
    def _rms_bytes(data):
        return audioop.rms(data, 2)
except Exception:
    print("[transcription_module] audioop not available; using numpy fallback for RMS calculations")
    def _rms_bytes(data):
        arr = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        return int(np.sqrt(np.mean(arr * arr))) if arr.size else 0


def is_silent(data, threshold=SILENCE_THRESHOLD):
    if data is None or len(data) == 0:
        return True
    return _rms_bytes(data) < threshold


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


# ====== TRANSCRIPTION ======
def format_timestamp(seconds):
    td = timedelta(seconds=int(seconds))
    mm, ss = divmod(td.seconds, 60)
    return f"{mm:02}:{ss:02}"


def transcribe_segment(model, audio, sr, speaker_label, start_time, end_time):
    """Transcribe a single utterance and return formatted text with timestamps and speaker label."""
    audio = normalize_audio(audio)
    wav_path = save_wav_file(audio, sr, 1)
    print(f"[transcribe_segment] Saved temp wav: {wav_path} (speaker={speaker_label}, start={start_time}, end={end_time})")
    start_stamp = format_timestamp(start_time)
    end_stamp = format_timestamp(end_time)

    try:
        segments, _ = model.transcribe(wav_path)
        text = " ".join([seg.text for seg in segments]).strip()
        if text:
            # Format like original: [mm:ss → mm:ss] Speaker: text
            line = f"[{start_stamp} → {end_stamp}] {speaker_label}: {text}"
            print(f"[transcribe_segment] Transcribed: {line}")
            return line
        print("[transcribe_segment] No text transcribed for this segment")
        return ""
    except Exception as e:
        print(f"Transcription error ({speaker_label}): {e}")
        return ""
    finally:
        try:
            os.remove(wav_path)
        except Exception:
            pass


class TranscriptionSession:
    def __init__(self, callback=None):
        self.callback = callback  # Function to call with each transcription
        self.model = None
        self.stream = None
        self.is_running = False
        self.stop_event = Event()
        self.transcripts = []
        
    def initialize_model(self):
        """Initialize the Whisper model."""
        global GLOBAL_MODEL
        # If a global model has been preloaded, use it
        if GLOBAL_MODEL is not None:
            if self.model is None:
                self.model = GLOBAL_MODEL
                print("[TranscriptionSession] Using preloaded global WhisperModel")
            return True

        # Otherwise, load into both self.model and GLOBAL_MODEL
        if self.model is None:
            try:
                print("[TranscriptionSession] Loading WhisperModel (this may take a while)...")
                self.model = WhisperModel("small.en", device="cpu", compute_type="int8")
                GLOBAL_MODEL = self.model
                print("[TranscriptionSession] WhisperModel loaded successfully and stored as GLOBAL_MODEL")
                return True
            except Exception as e:
                print(f"❌ Failed to load WhisperModel: {e}")
                return False
        print("[TranscriptionSession] WhisperModel already initialized on this session")
        return True
    
    def start(self):
        """Start the transcription session."""
        # Ensure the model is loaded before proceeding. Retry for a short timeout
        MAX_WAIT = 120  # seconds
        waited = 0
        interval = 2
        while not self.initialize_model():
            print(f"[TranscriptionSession] Model not ready, waiting {interval} seconds (waited {waited}s)")
            time.sleep(interval)
            waited += interval
            if waited >= MAX_WAIT:
                print("[TranscriptionSession] Timed out waiting for model to load. Aborting start.")
                return False
            
        self.is_running = True
        self.stop_event.clear()
        self.transcripts = []
        
        print("[TranscriptionSession] Initializing audio input stream...")
        # Initialize the stream
        channels = CHANNELS
        try:
            stream = sd.InputStream(device=DEVICE_INDEX,
                                    samplerate=SAMPLE_RATE,
                                    channels=channels,
                                    dtype='float32')
            stream.start()
            print(f"[TranscriptionSession] Audio input stream started (channels={channels}, samplerate={SAMPLE_RATE})")
        except sd.PortAudioError:
            print("⚠️ Multi-channel not supported, falling back to mono.")
            channels = 1
            stream = sd.InputStream(device=DEVICE_INDEX,
                                    samplerate=SAMPLE_RATE,
                                    channels=channels,
                                    dtype='float32')
            stream.start()
            print(f"[TranscriptionSession] Audio input stream started in mono (channels={channels})")
        
        self.stream = stream
        session_start = time.time()
        
        CHUNK = 1024
        chunks_per_second = SAMPLE_RATE / CHUNK
        min_chunks = int(MIN_SPEECH * chunks_per_second)
        silence_limit = int(SILENCE_DURATION * chunks_per_second)
        
        try:
            while not self.stop_event.is_set():
                frames = []
                silent_chunks = 0
                speaking_chunks = 0
                speech_start_time = None
                
                # Capture one full speech segment
                while not self.stop_event.is_set():
                    data, _ = stream.read(CHUNK)
                    if data is None or len(data) == 0:
                        continue
                    
                    rms = _rms_bytes((data * 32767).astype(np.int16).tobytes())
                    silent = rms < SILENCE_THRESHOLD
                    
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
                
                if self.stop_event.is_set():
                    break
                
                # Combine frames into one numpy array
                audio_chunk = np.concatenate(frames, axis=0)
                speech_end_time = time.time() - session_start
                
                # Skip if truly empty
                if np.mean(np.abs(audio_chunk)) < 1e-4:
                    continue
                
                # Transcribe
                if audio_chunk.ndim == 1 or audio_chunk.shape[1] == 1:
                    text = transcribe_segment(
                        self.model,
                        audio_chunk[:, 0] if audio_chunk.ndim > 1 else audio_chunk,
                        SAMPLE_RATE, "Speaker 1",
                        speech_start_time, speech_end_time
                    )
                    if text:
                        self.transcripts.append(text)
                        if self.callback:
                            self.callback(text)
                else:
                    ch1, ch2 = audio_chunk[:, 0], audio_chunk[:, 1]
                    text1 = transcribe_segment(self.model, ch1, SAMPLE_RATE, "Speaker 1",
                                               speech_start_time, speech_end_time)
                    text2 = transcribe_segment(self.model, ch2, SAMPLE_RATE, "Speaker 2",
                                               speech_start_time, speech_end_time)
                    if text1:
                        self.transcripts.append(text1)
                        if self.callback:
                            self.callback(text1)
                    if text2:
                        self.transcripts.append(text2)
                        if self.callback:
                            self.callback(text2)
        
        except Exception as e:
            print(f"Error during transcription: {e}")
        finally:
            if self.stream:
                self.stream.stop()
                self.stream.close()
            self.is_running = False
    
    def stop(self):
        """Stop the transcription session."""
        self.stop_event.set()
        self.is_running = False
    
    def get_full_transcript(self):
        """Get the complete transcript as a single string with newlines between entries."""
        return "\n".join(self.transcripts)

