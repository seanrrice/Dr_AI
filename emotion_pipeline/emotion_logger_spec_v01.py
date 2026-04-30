import json
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
from typing import Iterable, Optional, Mapping, Any
import time
import re

class EmotionVisitLogger:
    """
    Doctor AI Spec v0.1 Compliant Logger for Face Subsystem.
    
    Writes to: runs/visit_<visit_id>/face.jsonl
    Format: JSONL (one JSON object per line)
    Time: Relative to visit start (seconds)
    
    ORCHESTRATOR SUPPORT: Can accept custom t_start and t_end for orchestrator mode
    """
    
    def __init__(
        self,
        runs_dir: str = "runs",
        emotion_labels: Optional[Iterable[str]] = None,
        metadata_fields: Optional[Iterable[str]] = None,
        model_version: str = "resnet34_5class_v3",
    ):
        if emotion_labels is None:
            emotion_labels = ['Angry', 'Happy', 'Sad', 'Surprise', 'Neutral']
        
        if metadata_fields is None:
            metadata_fields = ["patient_id", "visit_label"]
        
        self.emotion_labels = list(emotion_labels)
        self.metadata_fields = list(metadata_fields)
        self.model_version = model_version
        
        # Map emotion labels to lowercase keys (per spec)
        self.emotion_key_map = {
            'Angry': 'angry',
            'Happy': 'happy',
            'Sad': 'sad',
            'Surprise': 'surprise',
            'Neutral': 'neutral'
        }
        
        # Set up runs directory
        self.runs_dir = Path(runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def log_visit(
            self,
            emotion_counts: Counter,
            total_samples: int,
            visit_id: Optional[str] = None,
            visit_time: Optional[str] = None,
            meta: Optional[Mapping[str, Any]] = None,
            visit_duration: Optional[float] = None,
            t_start: Optional[float] = None,  # NEW: For orchestrator mode
            t_end: Optional[float] = None,    # NEW: For orchestrator mode
            quality_metrics: Optional[Mapping[str, Any]] = None,
    ):
        """
        Log a single visit summary (type="summary") per Doctor AI spec v0.1.
        
        Creates: runs/visit_<visit_id>/face.jsonl
        
        Args:
            emotion_counts: Counter with counts per emotion label
            total_samples: total number of logged samples this visit
            visit_id: unique visit identifier (required)
            visit_time: ISO timestamp (optional, for reference)
            meta: dict with patient_id and other metadata
            visit_duration: total visit duration in seconds (optional)
            t_start: custom start time relative to t0 (for orchestrator mode)
            t_end: custom end time relative to t0 (for orchestrator mode)
        """
        if total_samples <= 0:
            print("[WARN] No samples to log for this visit")
            return
        
        if visit_time is None:
            visit_time = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if visit_id is None:
            visit_id = visit_time.replace(":", "-")
        
        if meta is None:
            meta = {}
        if quality_metrics is None:
            quality_metrics = {}
        
        patient_id = meta.get("patient_id", "")
        if not patient_id:
            print("[WARN] No patient_id provided")
        
        # Build emotion counts and percentages with lowercase keys
        emotion_counts_dict = {}
        emotion_pct_dict = {}
        
        for emo in self.emotion_labels:
            lowercase_key = self.emotion_key_map[emo]
            count = int(emotion_counts[emo])
            pct = round((count / total_samples) * 100.0, 2)
            emotion_counts_dict[lowercase_key] = count
            emotion_pct_dict[lowercase_key] = pct

        frame_count = int(quality_metrics.get("frame_count") or 0)
        detected_frame_count = int(quality_metrics.get("detected_frame_count") or 0)
        mean_model_conf = float(quality_metrics.get("mean_model_confidence") or 0.0)
        prediction_switches = int(quality_metrics.get("prediction_switches") or 0)
        prediction_transitions = int(quality_metrics.get("prediction_transitions") or 0)

        tracking_ratio = (
            min(1.0, max(0.0, detected_frame_count / frame_count))
            if frame_count > 0 else 0.0
        )
        stability_score = (
            1.0 - min(1.0, max(0.0, prediction_switches / max(1, prediction_transitions)))
            if prediction_transitions > 0 else 1.0
        )
        mean_model_conf = min(1.0, max(0.0, mean_model_conf))
        computed_confidence = min(
            1.0,
            max(0.0, 0.6 * mean_model_conf + 0.25 * tracking_ratio + 0.15 * stability_score)
        )
        
        # Determine t_start and t_end
        # If custom times provided (orchestrator mode), use them
        # Otherwise use default (standalone mode)
        if t_start is not None and t_end is not None:
            log_t_start = t_start
            log_t_end = t_end
        else:
            log_t_start = 0.0
            log_t_end = visit_duration if visit_duration is not None else None
        
        # Build the spec-compliant record (type="summary")
        record = {
            # Required envelope fields
            "visit_id": visit_id,
            "patient_id": patient_id,
            "subsystem": "face",
            "phase": "encounter",  # Face emotion is captured during encounter
            "type": "summary",     # Visit-level summary
            
            # Time fields (relative to visit start or orchestrator t0)
            "t_start": log_t_start,
            "t_end": log_t_end,
            
            # Subsystem-specific features
            "features": {
                "total_samples": int(total_samples),
                "emotion_counts": emotion_counts_dict,
                "emotion_pct": emotion_pct_dict,
                "pct_scale": "0-100",  # Percentages are on 0-100 scale
                # Optional: include raw timestamp for reference
                "timestamp": visit_time,
                "visit_label": meta.get("visit_label", ""),
                "quality": {
                    "frame_count": frame_count,
                    "detected_frame_count": detected_frame_count,
                    "tracking_ratio": round(tracking_ratio, 4),
                    "mean_model_confidence": round(mean_model_conf, 4),
                    "prediction_switches": prediction_switches,
                    "prediction_transitions": prediction_transitions,
                    "stability_score": round(stability_score, 4),
                    "confidence_formula": "0.6*mean_model_confidence + 0.25*tracking_ratio + 0.15*stability_score",
                },
            },
            
            # Quality metadata
            "confidence": round(computed_confidence, 4),
            "valid": True,      # Data is valid
            
            # Optional but recommended fields
            "schema_version": "v0.1",
            "model_version": self.model_version,
        }
        
        # Create visit-specific folder using MRN-scoped naming.
        safe_patient = re.sub(r"[^A-Za-z0-9_.-]", "_", str(patient_id or "").strip())
        visit_dir = self.runs_dir / f"visit_{safe_patient}_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)
        
        # Write to face.jsonl (append mode for JSONL)
        face_jsonl_path = visit_dir / "face.jsonl"
        
        # Check if file already exists (should only write once per visit)
        if face_jsonl_path.exists():
            print(f"[WARN] {face_jsonl_path} already exists, appending anyway")
        
        # Summary-only mode: overwrite for deterministic output
        with face_jsonl_path.open("w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
            f.write("\n")  # JSONL requires newline
        
        print(f"[OK] Face subsystem summary logged to {face_jsonl_path}")
        print(f"     Visit ID: {visit_id}")
        print(f"     Patient: {patient_id}")
        print(f"     Samples: {total_samples}")
        print(f"     Times: t_start={log_t_start:.2f}s, t_end={log_t_end if log_t_end is not None else 'null'}s")
        dominant = max(emotion_counts, key=emotion_counts.get)
        print(f"     Dominant: {dominant} ({emotion_pct_dict[self.emotion_key_map[dominant]]:.1f}%)")
