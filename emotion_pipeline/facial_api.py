import os
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
from flask import Flask, jsonify, Response, request
from flask_cors import CORS
import cv2
import time
import json
from pathlib import Path
from collections import Counter

from common_utils.orchestrator_utils import update_manifest_status, read_manifest

app = Flask(__name__)
CORS(app)

cap = None
running = False
latest_emotion = "Idle"
emotion_history = []

log_file = None
log_path = None
start_time = None
current_visit_id = None
current_patient_id = None
current_visit_dir = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = PROJECT_ROOT / "DrAITranscription" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


def classify_placeholder(face_roi):
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
    mean_val = gray.mean()

    if mean_val > 150:
        return "Happy"
    elif mean_val > 110:
        return "Neutral"
    elif mean_val > 80:
        return "LowAffect"
    else:
        return "Sad"


def write_window_jsonl(emotion):
    global log_file, start_time, current_visit_id, current_patient_id

    if log_file is None or start_time is None:
        return

    t_now = round(time.time() - start_time, 3)

    entry = {
        "visit_id": current_visit_id,
        "patient_id": current_patient_id,
        "subsystem": "face",
        "phase": "encounter",
        "type": "window",
        "t_start": t_now,
        "t_end": t_now,
        "features": {
            "dominant_emotion": emotion,
            "dominant_pct": 100.0
        },
        "confidence": 1.0,
        "valid": True,
        "schema_version": "v0.1",
        "model_version": "opencv_placeholder_v1"
    }

    log_file.write(json.dumps(entry) + "\n")
    log_file.flush()


def write_summary_jsonl():
    global log_file, emotion_history, start_time, current_visit_id, current_patient_id

    if log_file is None or start_time is None:
        return

    counts = Counter([item["emotion"] for item in emotion_history])
    total = sum(counts.values())

    emotion_counts = {
        "angry": counts.get("Angry", 0),
        "disgust": counts.get("Disgust", 0),
        "happy": counts.get("Happy", 0),
        "low_affect": counts.get("LowAffect", 0),
        "arousal": counts.get("Arousal", 0),
        "neutral": counts.get("Neutral", 0),
        "sad": counts.get("Sad", 0),
        "no_face": counts.get("No Face", 0),
    }

    emotion_pct = {}
    if total > 0:
        for key, value in emotion_counts.items():
            emotion_pct[key] = round((value / total) * 100.0, 2)
    else:
        for key in emotion_counts:
            emotion_pct[key] = 0.0

    summary = {
        "visit_id": current_visit_id,
        "patient_id": current_patient_id,
        "subsystem": "face",
        "phase": "encounter",
        "type": "summary",
        "t_start": 0.0,
        "t_end": round(time.time() - start_time, 3),
        "features": {
            "total_samples": total,
            "emotion_counts": emotion_counts,
            "emotion_pct": emotion_pct,
            "pct_scale": "0-100"
        },
        "confidence": 1.0,
        "valid": True,
        "schema_version": "v0.1",
        "model_version": "opencv_placeholder_v1"
    }

    log_file.write(json.dumps(summary) + "\n")
    log_file.flush()


def ensure_manifest_exists(visit_dir: Path, visit_id: str, patient_id: str):
    manifest = read_manifest(visit_dir)
    if manifest:
        return

    manifest_path = visit_dir / "manifest.json"
    new_manifest = {
        "schema_version": "v0.1",
        "visit_id": visit_id,
        "patient_id": patient_id,
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expected_subsystems": ["audio", "face", "gait"],
        "status": {
            "audio": "pending",
            "face": "pending",
            "gait": "pending"
        }
    }

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(new_manifest, f, indent=2)


def generate_frames():
    global cap, running, latest_emotion, emotion_history

    while True:
        if not running or cap is None:
            break

        ok, frame = cap.read()
        if not ok:
            break

        display = frame.copy()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(80, 80)
        )

        detected_emotion = "No Face"

        if len(faces) > 0:
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            face_roi = frame[y:y + h, x:x + w]
            detected_emotion = classify_placeholder(face_roi)

            cv2.rectangle(display, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.putText(
                display,
                detected_emotion,
                (x, max(y - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2
            )

        latest_emotion = detected_emotion

        emotion_history.append({
            "emotion": detected_emotion,
            "time": time.time()
        })
        emotion_history = emotion_history[-300:]

        write_window_jsonl(detected_emotion)

        cv2.putText(
            display,
            f"Emotion: {latest_emotion}",
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (255, 255, 255),
            2
        )

        ret, buffer = cv2.imencode(".jpg", display)
        if not ret:
            continue

        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )


@app.route("/api/facial/start", methods=["POST"])
def start_facial():
    global cap, running, latest_emotion, emotion_history
    global log_file, log_path, start_time
    global current_visit_id, current_patient_id, current_visit_dir

    if running:
        return jsonify({
            "status": "already running",
            "log_path": str(log_path) if log_path else None
        })

    data = request.get_json(silent=True) or {}
    visit_id = str(data.get("visit_id", "")).strip()
    patient_id = str(data.get("patient_id", "")).strip()

    if not visit_id or not patient_id:
        return jsonify({
            "status": "error",
            "message": "visit_id and patient_id are required"
        }), 400

    visit_dir = RUNS_DIR / f"visit_{visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)
    ensure_manifest_exists(visit_dir, visit_id, patient_id)

    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        return jsonify({
            "status": "error",
            "message": "Could not open webcam"
        }), 500

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    running = True
    latest_emotion = "No Face"
    emotion_history = []
    start_time = time.time()
    current_visit_id = visit_id
    current_patient_id = patient_id
    current_visit_dir = visit_dir

    log_path = visit_dir / "face.jsonl"
    log_file = open(log_path, "w", encoding="utf-8")

    update_manifest_status(visit_dir, "face", "running")

    return jsonify({
        "status": "started",
        "log_path": str(log_path)
    })


@app.route("/api/facial/stop", methods=["POST"])
def stop_facial():
    global cap, running, latest_emotion
    global log_file, log_path, start_time
    global current_visit_id, current_patient_id, current_visit_dir

    if running:
        write_summary_jsonl()

    running = False
    latest_emotion = "Stopped"

    if cap is not None:
        cap.release()
        cap = None

    finished_log_path = str(log_path) if log_path else None

    if log_file is not None:
        log_file.close()
        log_file = None

    if current_visit_dir is not None:
        update_manifest_status(current_visit_dir, "face", "done")

    log_path = None
    start_time = None
    current_visit_id = None
    current_patient_id = None
    current_visit_dir = None

    return jsonify({
        "status": "stopped",
        "log_path": finished_log_path
    })


@app.route("/api/facial/live", methods=["GET"])
def facial_live():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/api/facial/emotion", methods=["GET"])
def facial_emotion():
    return jsonify({"emotion": latest_emotion})


@app.route("/api/facial/history", methods=["GET"])
def facial_history():
    counts = Counter([item["emotion"] for item in emotion_history])
    return jsonify({
        "history": emotion_history,
        "counts": dict(counts)
    })


@app.route("/api/facial/status", methods=["GET"])
def facial_status():
    return jsonify({
        "running": running,
        "emotion": latest_emotion,
        "log_path": str(log_path) if log_path else None
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=True)