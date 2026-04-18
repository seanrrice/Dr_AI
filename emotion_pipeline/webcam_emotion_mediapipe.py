"""
Webcam Emotion Detection - ORCHESTRATOR MODE

This version reads t0 from manifest.json and syncs with orchestrator.
Falls back to standalone mode if manifest.json is not found.
"""
from __future__ import annotations

import argparse
import cv2
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import time
import mediapipe as mp
import torch.nn.functional as F
from collections import deque, Counter
from datetime import datetime, timezone
from pathlib import Path
from emotion_logger_spec_v01 import EmotionVisitLogger
import statistics
import json
import os

import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
from common_utils.orchestrator_utils import update_manifest_status  

# ==========================
# CONFIG
# ==========================

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CHECKPOINT_PATH = PROJECT_ROOT / "models" / "emotion" / "best_model.pth"

EMOTION_LABELS = ["Angry", "Happy", "Sad", "Surprise", "Neutral"];
NUM_CLASSES = len(EMOTION_LABELS)

label_history = deque(maxlen=10)
CONF_THRESHOLD = 0.5
LOG_INTERVAL_SEC = 0.5

inference_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

# ==========================
# MODEL
# ==========================

def build_model(num_classes: int, dropout_p: float = 0.3):
    model = models.resnet34(weights=None)
    in_features = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Dropout(dropout_p),
        nn.Linear(in_features, num_classes)
    )
    return model

print("[INFO] Loading model checkpoint...")
model = build_model(num_classes=NUM_CLASSES, dropout_p=0.3)
checkpoint_env = os.environ.get("EMOTION_CHECKPOINT")
checkpoint_path = Path(checkpoint_env) if checkpoint_env else DEFAULT_CHECKPOINT_PATH

if not checkpoint_path.exists():
    raise FileNotFoundError(
        f"Missing emotion model checkpoint at: {checkpoint_path}\n"
        f"- Default expected path: {DEFAULT_CHECKPOINT_PATH}\n"
        f"- You can override via environment variable EMOTION_CHECKPOINT.\n"
        f"  PowerShell example:\n"
        f"    $env:EMOTION_CHECKPOINT=\"{DEFAULT_CHECKPOINT_PATH}\""
    )

state_dict = torch.load(checkpoint_path, map_location=DEVICE)
model.load_state_dict(state_dict)
model.to(DEVICE)
model.eval()
print("[INFO] Model loaded and ready.")

# ==========================
# MEDIAPIPE FACE DETECTION
# ==========================

mp_face_detection = mp.solutions.face_detection

def predict_emotion_from_face(face_bgr):
    face_rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(face_rgb)
    img_t = inference_transform(img).unsqueeze(0).to(DEVICE)
    
    with torch.no_grad():
        logits = model(img_t)
        probs = F.softmax(logits, dim=1)[0]
        pred_idx = int(torch.argmax(probs).item())
        pred_conf = float(probs[pred_idx].item())
        pred_label = EMOTION_LABELS[pred_idx]
    
    return pred_label, pred_conf

def get_smoothed_label(label_history):
    if not label_history:
        return None
    counts = Counter(label_history)
    return counts.most_common(1)[0][0]

# ==========================
# ORCHESTRATOR INTEGRATION
# ==========================

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--visit_id", default=None, help = "Visit ID created by orchestrator")
    ap.add_argument("--patient_id", default=None, help="Patient identifier")
    ap.add_argument("--visit_label", default=None, help="Visit label/date string")
    ap.add_argument("--runs_dir", default="runs", help="Directory to save visit logs")
    ap.add_argument("--camera_index", type=int, default=0, help="OpenCV camera index")
    return ap.parse_args()

def get_visit_t0(visit_dir: Path) -> tuple[float, bool]:
    """
    Get t0 (visit start time) from manifest.json if available.
    
    Returns:
        (t0_timestamp, using_orchestrator)
    """
    manifest_path = visit_dir / "manifest.json"
    
    # Try to read t0 from orchestrator's manifest.json
    if manifest_path.exists():
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            t0_str = manifest.get('created_utc')
                
            if t0_str:
                # Convert ISO string to Unix timestamp
                # Format: "2026-02-28T14:30:45Z"
                dt = datetime.strptime(t0_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                t0 = dt.timestamp()
                print(f"[INFO] Using orchestrator manifest t0: {t0_str}")
                return t0, True
        except Exception as e:
            print(f"[WARN] Failed to read manifest.json: {e}")
            print("[INFO] Falling back to standalone mode")
    
    # Standalone mode: define our own t0
    t0 = time.time()
    print("[INFO] Standalone mode: Using current time as t0")
    return t0, False

# ==========================
# MAIN
# ==========================

def main():
    args = parse_args()

    # Determine whether orchestrator supplied visit context
    using_cli_visit = args.visit_id is not None and args.patient_id is not None

    if using_cli_visit:
        visit_id = args.visit_id
        patient_id = args.patient_id
        visit_label = args.visit_label if args.visit_label else datetime.now().date().isoformat()
        runs_dir = Path(args.runs_dir)
        visit_dir = runs_dir / f"visit_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)
        print(f"[INFO] Orchestrator mode for visit_id={visit_id}")
    else:
        print("[INFO] No orchestrator visit args supplied; entering standalone mode")
        patient_id = input("Patient ID (or MRN / initials): ").strip() or "Unknown"
        visit_label = datetime.now().date().isoformat()
        visit_id = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        runs_dir = Path(args.runs_dir)
        visit_dir = runs_dir / f"visit_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)
    
    # Create stop file path for signaling when to stop the face subsystem
    stop_file = visit_dir / "stop_face.txt"
    
    # Read t0 from manifest if available, otherwise use current time
    t0, using_orchestrator = get_visit_t0(visit_dir)

    # Update manifest status to "running" for face subsystem if using orchestrator
    if using_cli_visit:
        update_manifest_status(visit_dir, "face", "running")

    # Create logger
    logger = EmotionVisitLogger(
        runs_dir = str(runs_dir),
        emotion_labels=EMOTION_LABELS,
        metadata_fields=["patient_id", "visit_label"],
        model_version="resnet34_5class_v3"
    )

    # For logging emotion data
    last_log_time = time.time()
    emotion_counts = Counter()
    total_samples = 0
    latency_history = []

    cap = cv2.VideoCapture(args.camera_index, cv2.CAP_DSHOW)
    print(f"[INFO] Opening camera index {args.camera_index}")   # optional
    if not cap.isOpened():
        print("[Error] Could not open webcam.")
        return
    
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    # Track visit start time
    face_start_abs = time.time()
    
    with mp_face_detection.FaceDetection(
        model_selection=0,
        min_detection_confidence=0.5
    ) as face_detection:

        while True:
            frame_start = time.time()
            ret, frame = cap.read()
            
            if not ret:
                print("[WARN] Failed to grab frame")
                break
            
            h, w, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_detection.process(frame_rgb)

            smoothed_label = None

            if results.detections:
                for detection in results.detections:
                    bbox = detection.location_data.relative_bounding_box
                    x_min = int(bbox.xmin * w)
                    y_min = int(bbox.ymin * h)
                    box_width = int(bbox.width * w)
                    box_height = int(bbox.height * h)

                    x_min = max(0, x_min)
                    y_min = max(0, y_min)
                    x_max = min(w, x_min + box_width)
                    y_max = min(h, y_min + box_height)

                    if x_max <= x_min or y_max <= y_min:
                        continue

                    face_roi = frame[y_min:y_max, x_min:x_max]
                    label, conf = predict_emotion_from_face(face_roi)
                   
                    if conf > CONF_THRESHOLD:
                        label_history.append(label)

                    now = time.time()
                    if now - last_log_time >= LOG_INTERVAL_SEC:
                        smoothed_label = get_smoothed_label(label_history)
                        if smoothed_label is not None:
                            emotion_counts[smoothed_label] += 1
                            total_samples += 1
                        last_log_time = now

                    cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (0, 255, 0), 2)
                    text = smoothed_label if smoothed_label is not None else label
                    cv2.putText(frame, text, (x_min, y_min - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    
                    frame_end = time.time()
                    latency_history.append((frame_end - frame_start) * 1000)

                    if len(latency_history) >= 30:
                        print(f"Avg latency for last 30 frames: {statistics.mean(latency_history):.2f} ms")
                        latency_history = []
            
            cv2.imshow("Webcam Emotion (Mediapipe + ResNet34)", frame)

            # Check for stop signal 
            if stop_file.exists():
                print("[INFO] Stop signal detected. Ending face subsystem.")
                break

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()
        
        if stop_file.exists():
            try:
                stop_file.unlink()
            except Exception as e:
                print(f"[WARN] Could not remove stop signal file: {e}")

        face_end_abs = time.time()
        face_duration = face_end_abs - face_start_abs

        # Choose which times to log based on mode
        if using_orchestrator:
            log_t_start = face_start_abs - t0
            log_t_end = face_end_abs - t0
            print(f"[INFO] Logging times relative to orchestrator t0")
        else:
            log_t_start = 0.0
            log_t_end = face_duration
            print(f"[INFO] Logging times relative to face subsystem start")
        
        print("\n[INFO] Face timing:")
        print(f"  t_start = {log_t_start:.2f}s")
        print(f"  t_end   = {log_t_end:.2f}s")
        print(f"  duration= {face_duration:.2f}s")
        
        # Log visit summary
        log_time_start = time.time()
        
        logger.log_visit(
            emotion_counts=emotion_counts,
            total_samples=total_samples,
            visit_id=visit_id,
            visit_duration=face_duration,
            t_start=log_t_start,  # Pass orchestrator-aware time
            t_end=log_t_end,      # Pass orchestrator-aware time
            meta={
                "patient_id": patient_id,
                "visit_label": visit_label,
            }
        )

        #update manifest status to "done" for face subsystem if using orchestrator
        if using_cli_visit:
            update_manifest_status(visit_dir, "face", "done")

        log_time_end = time.time()
        print(f"\n[INFO] Logger latency: {((log_time_end - log_time_start) * 1000):.2f}ms")
        print(f"[INFO] Face subsystem complete!")
        

if __name__ == "__main__":
    main()
