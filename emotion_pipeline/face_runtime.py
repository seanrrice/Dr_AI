from __future__ import annotations

import base64
import statistics
import time
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torchvision import models, transforms

from emotion_pipeline.emotion_logger_spec_v01 import EmotionVisitLogger
from common_utils.orchestrator_utils import update_manifest_status

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CHECKPOINT_PATH = PROJECT_ROOT / "models" / "emotion" / "best_model.pth"

EMOTION_LABELS = ["Angry", "Happy", "Sad", "Surprise", "Neutral"]
NUM_CLASSES = len(EMOTION_LABELS)
CONF_THRESHOLD = 0.5
DEFAULT_LOG_INTERVAL_SEC = 0.5

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

inference_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
])


@dataclass
class VisitContext:
    visit_id: str
    patient_id: str
    runs_dir: Path
    visit_label: str


_MODEL: Optional[nn.Module] = None


def build_model(num_classes: int, dropout_p: float = 0.3) -> nn.Module:
    model = models.resnet34(weights=None)
    in_features = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Dropout(dropout_p),
        nn.Linear(in_features, num_classes),
    )
    return model


def get_model() -> nn.Module:
    global _MODEL
    if _MODEL is None:
        print("[FaceRuntime] Loading emotion model checkpoint...")
        model = build_model(num_classes=NUM_CLASSES, dropout_p=0.3)
        state_dict = torch.load(CHECKPOINT_PATH, map_location=DEVICE)
        model.load_state_dict(state_dict)
        model.to(DEVICE)
        model.eval()
        _MODEL = model
        print("[FaceRuntime] Emotion model ready")
    return _MODEL


def predict_emotion_from_face(face_bgr) -> tuple[str, float]:
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


def decode_data_url_image(image_b64: str):
    payload = image_b64.split(",", 1)[1] if image_b64.startswith("data:") else image_b64
    raw_bytes = base64.b64decode(payload)
    arr = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    return arr


def _parse_manifest_created_ts(visit_dir: Path) -> tuple[float, bool]:
    manifest_path = visit_dir / "manifest.json"
    if manifest_path.exists():
        try:
            import json

            with manifest_path.open("r", encoding="utf-8") as f:
                manifest = json.load(f)
            t0_str = manifest.get("created_utc")
            if t0_str:
                dt = datetime.strptime(t0_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                return dt.timestamp(), True
        except Exception as exc:
            print(f"[FaceRuntime] WARN: unable to parse manifest created_utc: {exc}")
    return time.time(), False


class FaceAnalysisSession:
    def __init__(
        self,
        context: VisitContext,
        log_interval_sec: float = DEFAULT_LOG_INTERVAL_SEC,
        smoothing_window: int = 10,
    ):
        self.context = context
        self.visit_dir = context.runs_dir / f"visit_{context.visit_id}"
        self.visit_dir.mkdir(parents=True, exist_ok=True)

        self.log_interval_sec = max(0.2, float(log_interval_sec))
        self.label_history = deque(maxlen=max(1, int(smoothing_window)))
        self.emotion_counts = Counter()
        self.total_samples = 0
        self.last_log_time = time.time()
        self.latency_history = []
        self.request_count = 0

        self.face_detection = mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=0.5,
        )

        self.face_start_abs = time.time()
        self.t0, self.using_orchestrator = _parse_manifest_created_ts(self.visit_dir)
        update_manifest_status(self.visit_dir, "face", "running")

    def _get_smoothed_label(self) -> Optional[str]:
        if not self.label_history:
            return None
        return Counter(self.label_history).most_common(1)[0][0]

    def analyze_frame(self, frame_bgr):
        t_start = time.perf_counter()
        self.request_count += 1

        if frame_bgr is None:
            return {"ok": False, "error": "Invalid frame payload"}

        h, w, _ = frame_bgr.shape
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.face_detection.process(frame_rgb)

        detections_out = []
        now = time.time()
        sampled = False
        smoothed_label = None

        if results.detections:
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

                face_roi = frame_bgr[y_min:y_max, x_min:x_max]
                label, conf = predict_emotion_from_face(face_roi)
                if conf > CONF_THRESHOLD:
                    self.label_history.append(label)

                if now - self.last_log_time >= self.log_interval_sec:
                    smoothed_label = self._get_smoothed_label()
                    if smoothed_label is not None:
                        self.emotion_counts[smoothed_label] += 1
                        self.total_samples += 1
                        sampled = True
                    self.last_log_time = now

                detections_out.append(
                    {
                        "bbox": {
                            "x": x_min,
                            "y": y_min,
                            "width": x_max - x_min,
                            "height": y_max - y_min,
                        },
                        "label": smoothed_label or label,
                        "raw_label": label,
                        "confidence": round(conf, 4),
                    }
                )

        elapsed_ms = (time.perf_counter() - t_start) * 1000.0
        self.latency_history.append(elapsed_ms)
        avg_latency_ms = round(statistics.mean(self.latency_history[-30:]), 2)

        return {
            "ok": True,
            "detections": detections_out,
            "sample_logged": sampled,
            "total_samples": int(self.total_samples),
            "avg_latency_ms": avg_latency_ms,
            "request_count": self.request_count,
            "server_ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    def finalize(self):
        face_end_abs = time.time()
        face_duration = face_end_abs - self.face_start_abs

        if self.using_orchestrator:
            log_t_start = self.face_start_abs - self.t0
            log_t_end = face_end_abs - self.t0
        else:
            log_t_start = 0.0
            log_t_end = face_duration

        logger = EmotionVisitLogger(
            runs_dir=str(self.context.runs_dir),
            emotion_labels=EMOTION_LABELS,
            metadata_fields=["patient_id", "visit_label"],
            model_version="resnet34_5class_v3",
        )

        logger.log_visit(
            emotion_counts=self.emotion_counts,
            total_samples=self.total_samples,
            visit_id=self.context.visit_id,
            visit_duration=face_duration,
            t_start=log_t_start,
            t_end=log_t_end,
            meta={
                "patient_id": self.context.patient_id,
                "visit_label": self.context.visit_label,
            },
        )

        update_manifest_status(self.visit_dir, "face", "done")

        try:
            self.face_detection.close()
        except Exception:
            pass

        return {
            "visit_id": self.context.visit_id,
            "duration_sec": round(face_duration, 2),
            "total_samples": int(self.total_samples),
            "avg_latency_ms": round(statistics.mean(self.latency_history), 2) if self.latency_history else None,
        }
