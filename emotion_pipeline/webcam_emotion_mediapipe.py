"""
Webcam Emotion Detection - ORCHESTRATOR MODE

This version preserves the original MediaPipe + ResNet34 facial pipeline,
and also exposes a reusable frame-based analyzer so the GUI can send frames
to Flask instead of the model owning the webcam directly.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torchvision import models, transforms

from emotion_logger_spec_v01 import EmotionVisitLogger

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
from common_utils.orchestrator_utils import update_manifest_status

# ==========================
# CONFIG
# ==========================

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CHECKPOINT_PATH = PROJECT_ROOT / "models" / "emotion" / "best_model.pth"

EMOTION_LABELS = ["Angry", "Disgust", "Happy", "LowAffect", "Arousal"]
NUM_CLASSES = len(EMOTION_LABELS)
MODEL_VERSION = "resnet34_5class_v3"

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

_MODEL = None

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

def get_model():
    global _MODEL
    if _MODEL is None:
        print("[INFO] Loading model checkpoint...")
        model = build_model(num_classes=NUM_CLASSES, dropout_p=0.3)
        state_dict = torch.load(CHECKPOINT_PATH, map_location=DEVICE)
        model.load_state_dict(state_dict)
        model.to(DEVICE)
        model.eval()
        _MODEL = model
        print("[INFO] Model loaded and ready.")
    return _MODEL

def predict_emotion_from_face(face_bgr):
    model = get_model()
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
# FRAME-BASED ANALYZER
# ==========================

class FrameEmotionAnalyzer:
    """
    Reusable analyzer for GUI-fed frames.
    Keeps the original MediaPipe face detection + ResNet34 prediction logic intact.
    """
    def __init__(
        self,
        conf_threshold: float = CONF_THRESHOLD,
        smoothing_window: int = 10,
        min_detection_confidence: float = 0.5,
    ):
        self.conf_threshold = conf_threshold
        self.label_history = deque(maxlen=smoothing_window)
        self.last_log_time = 0.0
        self.face_detection = mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence,
        )

    def close(self):
        try:
            self.face_detection.close()
        except Exception:
            pass

    def analyze_frame(self, frame_bgr, count_interval_sec: float = LOG_INTERVAL_SEC) -> dict[str, Any]:
        if frame_bgr is None or frame_bgr.size == 0:
            return {
                "detected": False,
                "label": None,
                "smoothed_label": None,
                "confidence": 0.0,
                "box": None,
                "should_count": False,
            }

        h, w, _ = frame_bgr.shape
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.face_detection.process(frame_rgb)

        if not results.detections:
            return {
                "detected": False,
                "label": None,
                "smoothed_label": get_smoothed_label(self.label_history),
                "confidence": 0.0,
                "box": None,
                "should_count": False,
            }

        best = None
        best_area = -1

        for detection in results.detections:
            bbox = detection.location_data.relative_bounding_box
            x_min = max(0, int(bbox.xmin * w))
            y_min = max(0, int(bbox.ymin * h))
            box_width = int(bbox.width * w)
            box_height = int(bbox.height * h)
            x_max = min(w, x_min + box_width)
            y_max = min(h, y_min + box_height)

            if x_max <= x_min or y_max <= y_min:
                continue

            area = (x_max - x_min) * (y_max - y_min)
            if area > best_area:
                best_area = area
                best = (x_min, y_min, x_max, y_max)

        if best is None:
            return {
                "detected": False,
                "label": None,
                "smoothed_label": get_smoothed_label(self.label_history),
                "confidence": 0.0,
                "box": None,
                "should_count": False,
            }

        x_min, y_min, x_max, y_max = best
        face_roi = frame_bgr[y_min:y_max, x_min:x_max]

        label, conf = predict_emotion_from_face(face_roi)

        if conf > self.conf_threshold:
            self.label_history.append(label)

        smoothed_label = get_smoothed_label(self.label_history) or label

        now = time.time()
        should_count = bool(smoothed_label) and (now - self.last_log_time >= count_interval_sec)
        if should_count:
            self.last_log_time = now

        return {
            "detected": True,
            "label": label,
            "smoothed_label": smoothed_label,
            "confidence": conf,
            "box": {
                "x": x_min,
                "y": y_min,
                "w": x_max - x_min,
                "h": y_max - y_min,
            },
            "should_count": should_count,
        }

# ==========================
# ORCHESTRATOR INTEGRATION
# ==========================

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--visit_id", default=None, help="Visit ID created by orchestrator")
    ap.add_argument("--patient_id", default=None, help="Patient identifier")
    ap.add_argument("--visit_label", default=None, help="Visit label/date string")
    ap.add_argument("--runs_dir", default="runs", help="Directory to save visit logs")
    return ap.parse_args()

def get_visit_t0(visit_dir: Path) -> tuple[float, bool]:
    manifest_path = visit_dir / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            t0_str = manifest.get("created_utc")
            if t0_str:
                dt = datetime.strptime(t0_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                return dt.timestamp(), True
        except Exception as e:
            print(f"[WARN] Failed to read manifest.json: {e}")
            print("[INFO] Falling back to standalone mode")
    return time.time(), False

# ==========================
# MAIN WEBCAM MODE
# ==========================

def main():
    args = parse_args()
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

    stop_file = visit_dir / "stop_face.txt"
    t0, using_orchestrator = get_visit_t0(visit_dir)

    if using_cli_visit:
        update_manifest_status(visit_dir, "face", "running")

    logger = EmotionVisitLogger(
        runs_dir=str(runs_dir),
        emotion_labels=EMOTION_LABELS,
        metadata_fields=["patient_id", "visit_label"],
        model_version=MODEL_VERSION,
    )

    emotion_counts = Counter()
    total_samples = 0
    latency_history = []

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[Error] Could not open webcam.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    face_start_abs = time.time()
    analyzer = FrameEmotionAnalyzer()

    try:
        while True:
            frame_start = time.time()
            ret, frame = cap.read()

            if not ret:
                print("[WARN] Failed to grab frame")
                break

            result = analyzer.analyze_frame(frame, count_interval_sec=LOG_INTERVAL_SEC)

            if result["detected"] and result["box"]:
                box = result["box"]
                x_min, y_min = box["x"], box["y"]
                x_max = x_min + box["w"]
                y_max = y_min + box["h"]

                text = result["smoothed_label"] or result["label"] or "Unknown"
                cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (0, 255, 0), 2)
                cv2.putText(
                    frame,
                    text,
                    (x_min, max(y_min - 10, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2,
                )

            if result["should_count"] and result["smoothed_label"]:
                emotion_counts[result["smoothed_label"]] += 1
                total_samples += 1

            frame_end = time.time()
            latency_history.append((frame_end - frame_start) * 1000)
            if len(latency_history) >= 30:
                print(f"Avg latency for last 30 frames: {statistics.mean(latency_history):.2f} ms")
                latency_history = []

            cv2.imshow("Webcam Emotion (Mediapipe + ResNet34)", frame)

            if stop_file.exists():
                print("[INFO] Stop signal detected. Ending face subsystem.")
                break

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        analyzer.close()

    if stop_file.exists():
        try:
            stop_file.unlink()
        except Exception as e:
            print(f"[WARN] Could not remove stop signal file: {e}")

    face_end_abs = time.time()
    face_duration = face_end_abs - face_start_abs

    if using_orchestrator:
        log_t_start = face_start_abs - t0
        log_t_end = face_end_abs - t0
        print("[INFO] Logging times relative to orchestrator t0")
    else:
        log_t_start = 0.0
        log_t_end = face_duration
        print("[INFO] Logging times relative to face subsystem start")

    print("\n[INFO] Face timing:")
    print(f"  t_start = {log_t_start:.2f}s")
    print(f"  t_end   = {log_t_end:.2f}s")
    print(f"  duration= {face_duration:.2f}s")

    log_time_start = time.time()

    logger.log_visit(
        emotion_counts=emotion_counts,
        total_samples=total_samples,
        visit_id=visit_id,
        visit_duration=face_duration,
        t_start=log_t_start,
        t_end=log_t_end,
        meta={
            "patient_id": patient_id,
            "visit_label": visit_label,
        },
    )

    if using_cli_visit:
        update_manifest_status(visit_dir, "face", "done")

    log_time_end = time.time()
    print(f"\n[INFO] Logger latency: {((log_time_end - log_time_start) * 1000):.2f}ms")
    print("[INFO] Face subsystem complete!")

if __name__ == "__main__":
    main()
