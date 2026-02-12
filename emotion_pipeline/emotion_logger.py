import csv
from pathlib import Path
from datetime import datetime
from collections import Counter
from typing import Iterable, Optional
from typing import Mapping, Any, List

class EmotionVisitLogger:
    def __init__(
        self,
        log_dir: str = "emotion_logs",
        filename: str = "visit_emotions_5classes.csv",
        emotion_labels: Optional[Iterable[str]] = None,
        metadata_fields: Optional[Iterable[str]] = None,
    ):

        # emotion_labels: list of emotion class names
        # metadata_fields: list of extra columns to include, e.g. ["patient_id", "visit_label"]
        # if True, raises error if existing CSV header doesn't match expected schema

        if emotion_labels is None:
            emotion_labels = ['Angry', 'Disgust', 'Happy', 'LowAffect', 'Arousal']
        
        if metadata_fields is None:
            metadata_fields = []
        
        self.emotion_labels = list(emotion_labels)
        self.metadata_fields = list(metadata_fields)
    
        # Set up paths
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

        self.log_path = self.log_dir / filename

        # Ensure file has header
        self._ensure_header()

    def _ensure_header(self):
        file_exists = self.log_path.exists()
        if file_exists:
            return 
        
        with self.log_path.open("w", newline = "") as f:
            writer = csv.writer(f)

            header = (
                list(self.metadata_fields) + # e.g. ["patient_id", "visit_label"]
                ["visit_id", "timestamp", "total_samples"] +
                [f"{emo}_count" for emo in self.emotion_labels] +
                [f"{emo}_pct" for emo in self.emotion_labels]
            )
            writer.writerow(header)

    def log_visit(
            self,
            emotion_counts: Counter,
            total_samples: int,
            visit_id: Optional[str] = None,
            visit_time: Optional[str] = None,
            meta: Optional[Mapping[str, Any]] = None,
    ):
        # Log a single visit summary.

        # emotion_counts: Counter with counts per emotion label
        # total_samples: total number of logged samples this visit
        # visit_id: optional external ID; if None, auto-generate from timestamp
        # visit_time: optional ISO timestamp string; if None, uses now()
        # meta: dict providing values for metadata_fields, e.g. {"patient_id": "...", "visit_label": "..."}

        if total_samples <= 0:
            # Nothing to log for this visit
            return
        
        if visit_time is None:
            visit_time = datetime.now().isoformat(timespec="seconds")
        if visit_id is None:
            visit_id = visit_time.replace(":", "-")
        
        if meta is None:
            meta = {}
        
        #Compute percentages
        emotion_percent = {
            emo: (emotion_counts[emo] / total_samples) * 100.0
            for emo in self.emotion_labels
        }

        # Build row in the same order as header
        meta_values = [meta.get(field, "") for field in self.metadata_fields]

        row = (
            meta_values +
            [visit_id, visit_time, int(total_samples)] +
            [int(emotion_counts[emo]) for emo in self.emotion_labels]+
            [round(emotion_percent[emo], 2) for emo in self.emotion_labels]
        )

        with self.log_path.open("a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(row)
        