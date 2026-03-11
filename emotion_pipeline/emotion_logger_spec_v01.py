import json
from pathlib import Path
from datetime import datetime
from collections import Counter
from typing import Iterable, Optional, Mapping, Any
import time

class EmotionVisitLogger:
    """
    Doctor AI Spec v0.1 Compliant Logger for Face Subsystem.
    
    Writes to: runs/visit_<visit_id>/face.jsonl
    Format: JSONL (one JSON object per line)
    Time: Relative to visit start (seconds)
    """
    
    def __init__(
        self,
        runs_dir: str = "runs",
        emotion_labels: Optional[Iterable[str]] = None,
        metadata_fields: Optional[Iterable[str]] = None,
        model_version: str = "resnet34_5class_v3",
    ):
        if emotion_labels is None:
            emotion_labels = ['Angry', 'Disgust', 'Happy', 'LowAffect', 'Arousal']
        
        if metadata_fields is None:
            metadata_fields = ["patient_id", "visit_label"]
        
        self.emotion_labels = list(emotion_labels)
        self.metadata_fields = list(metadata_fields)
        self.model_version = model_version
        
        # Map emotion labels to lowercase keys (per spec)
        self.emotion_key_map = {
            'Angry': 'angry',
            'Disgust': 'disgust',
            'Happy': 'happy',
            'LowAffect': 'low_affect',
            'Arousal': 'arousal'
        }
        
        # Set up runs directory
        self.runs_dir = Path(runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        
        # Track visit start time for relative timing
        self.visit_start_time = None

    def log_visit(
            self,
            emotion_counts: Counter,
            total_samples: int,
            visit_id: Optional[str] = None,
            visit_time: Optional[str] = None,
            meta: Optional[Mapping[str, Any]] = None,
            visit_duration: Optional[float] = None,
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
        """
        if total_samples <= 0:
            print("[WARN] No samples to log for this visit")
            return
        
        if visit_time is None:
            visit_time = datetime.now().isoformat(timespec="seconds")
        if visit_id is None:
            visit_id = visit_time.replace(":", "-")
        
        if meta is None:
            meta = {}
        
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
        
        # Build the spec-compliant record (type="summary")
        record = {
            # Required envelope fields
            "visit_id": visit_id,
            "patient_id": patient_id,
            "subsystem": "face",
            "phase": "encounter",  # Face emotion is captured during encounter
            "type": "summary",     # Visit-level summary
            
            # Time fields (relative to visit start)
            "t_start": 0.0,  # Visit started at t=0
            "t_end": visit_duration if visit_duration else None,  # Total duration or null
            
            # Subsystem-specific features
            "features": {
                "total_samples": int(total_samples),
                "emotion_counts": emotion_counts_dict,
                "emotion_pct": emotion_pct_dict,
                # Optional: include raw timestamp for reference
                "timestamp": visit_time,
                "visit_label": meta.get("visit_label", ""),
            },
            
            # Quality metadata
            "confidence": 1.0,  # Full confidence in summary (aggregated data)
            "valid": True,      # Data is valid
            
            # Optional but recommended fields
            "schema_version": "v0.1",
            "model_version": self.model_version,
        }
        
        # Create visit-specific folder
        visit_dir = self.runs_dir / f"visit_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)
        
        # Write to face.jsonl (append mode for JSONL)
        face_jsonl_path = visit_dir / "face.jsonl"
        
        # Check if file already exists (should only write once per visit)
        if face_jsonl_path.exists():
            print(f"[WARN] {face_jsonl_path} already exists, appending anyway")
        
        # Append the record (JSONL = one JSON per line)
        with face_jsonl_path.open("a", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
            f.write("\n")  # JSONL requires newline
        
        print(f"[OK] Face subsystem summary logged to {face_jsonl_path}")
        print(f"     Visit ID: {visit_id}")
        print(f"     Patient: {patient_id}")
        print(f"     Samples: {total_samples}")
        print(f"     Duration: {visit_duration if visit_duration else 'unknown'}s")
        dominant = max(emotion_counts, key=emotion_counts.get)
        print(f"     Dominant: {dominant} ({emotion_pct_dict[self.emotion_key_map[dominant]]:.1f}%)")
