import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import wave
import tempfile
import numpy as np
import sounddevice as sd
import time
from datetime import timedelta
from faster_whisper import WhisperModel

# ========= CONFIG =========
SAMPLE_RATE = 16000
CHANNELS = 2       # 2 for interface, auto-falls back to 1 if not available
DEVICE_INDEX = None  # None = default input device
SILENCE_THRESHOLD = 300   # lower = more sensitive
MIN_SPEECH = 0.5          # seconds of minimum speech before a pause can trigger
SILENCE_DURATION = 0.8     # seconds of silence that defines a pause
# ==========================

# Optional colors for console
NEON_GREEN = "\033[92m"
RESET_COLOR = "\033[0m"

# ====== AUDIO HELPERS ======
try:
    import audioop
    def _rms_bytes(data):
        return audioop.rms(data, 2)
except Exception:
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


def transcribe(model, audio, sr, speaker_label, start_time, end_time):
    """Transcribe a single utterance and include both start/end timestamps."""
    audio = normalize_audio(audio)
    wav_path = save_wav_file(audio, sr, 1)
    start_stamp = format_timestamp(start_time)
    end_stamp = format_timestamp(end_time)

    try:
        segments, _ = model.transcribe(wav_path)
        text = " ".join([seg.text for seg in segments]).strip()
        if text:
            line = f"[{start_stamp} → {end_stamp}] {speaker_label}: {text}"
            print(f"{NEON_GREEN}{line}{RESET_COLOR}")
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


# ====== MAIN ======
def main():
    global CHANNELS
    try:
        model = WhisperModel("small.en", device="cpu", compute_type="int8")
    except Exception as e:
        print("❌ Failed to load WhisperModel:", e)
        return

    print("🎙️ Starting audio stream...")

    # Initialize the stream
    try:
        stream = sd.InputStream(device=DEVICE_INDEX,
                                samplerate=SAMPLE_RATE,
                                channels=CHANNELS,
                                dtype='float32')
        stream.start()
    except sd.PortAudioError:
        print("⚠️ Multi-channel not supported, falling back to mono.")
        CHANNELS = 1
        stream = sd.InputStream(device=DEVICE_INDEX,
                                samplerate=SAMPLE_RATE,
                                channels=CHANNELS,
                                dtype='float32')
        stream.start()

    transcripts = []
    session_start = time.time()

    print("🔊 Recording and transcribing by voice activity. Press Ctrl+C to stop.\n")

    CHUNK = 1024
    chunks_per_second = SAMPLE_RATE / CHUNK
    min_chunks = int(MIN_SPEECH * chunks_per_second)
    silence_limit = int(SILENCE_DURATION * chunks_per_second)

    try:
        while True:
            frames = []
            silent_chunks = 0
            speaking_chunks = 0
            speech_start_time = None

            # Capture one full speech segment
            while True:
                data, _ = stream.read(CHUNK)
                if data is None or len(data) == 0:
                    continue

                rms = _rms_bytes((data * 32767).astype(np.int16).tobytes())
                silent = rms < SILENCE_THRESHOLD

                if not silent and speech_start_time is None:
                    speech_start_time = time.time() - session_start  # mark when speech starts

                frames.append(data)

                if silent:
                    silent_chunks += 1
                else:
                    silent_chunks = 0
                    speaking_chunks += 1

                if speaking_chunks > min_chunks and silent_chunks > silence_limit:
                    # pause detected → stop and process this utterance
                    break

            # Combine frames into one numpy array
            audio_chunk = np.concatenate(frames, axis=0)
            speech_end_time = time.time() - session_start

            # Skip if truly empty
            if np.mean(np.abs(audio_chunk)) < 1e-4:
                continue

            # Split by channels
            if audio_chunk.ndim == 1 or audio_chunk.shape[1] == 1:
                text = transcribe(model,
                                  audio_chunk[:, 0] if audio_chunk.ndim > 1 else audio_chunk,
                                  SAMPLE_RATE, "Speaker 1",
                                  speech_start_time, speech_end_time)
                if text:
                    transcripts.append(text)
            else:
                ch1, ch2 = audio_chunk[:, 0], audio_chunk[:, 1]
                text1 = transcribe(model, ch1, SAMPLE_RATE, "Speaker 1",
                                   speech_start_time, speech_end_time)
                text2 = transcribe(model, ch2, SAMPLE_RATE, "Speaker 2",
                                   speech_start_time, speech_end_time)
                if text1:
                    transcripts.append(text1)
                if text2:
                    transcripts.append(text2)

    except KeyboardInterrupt:
        print("\n🛑 Stopping transcription...")
    finally:
        stream.stop()
        stream.close()
        with open("transcript_log.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(transcripts))
        print("📝 Transcripts saved to transcript_log.txt")


if __name__ == "__main__":
    main()
