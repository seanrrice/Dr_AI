import csv
import json
from pathlib import Path
import argparse


def make_record(r: dict) -> dict:
    return {
        "visit_id": r["visit_id"],
        "patient_id": r["patient_id"],
        "subsystem": "face",
        "phase": "encounter",
        "type": "summary",
        "t_start": 0.0,
        "t_end": None,
        "features": {
            "visit_label": r.get("visit_label"),
            "timestamp": r.get("timestamp"),
            "total_samples": int(r["total_samples"]),
            "emotion_counts": {
                "angry": int(r["Angry_count"]),
                "disgust": int(r["Disgust_count"]),
                "happy": int(r["Happy_count"]),
                "low_affect": int(r["LowAffect_count"]),
                "arousal": int(r["Arousal_count"]),
            },
            "emotion_pct": {
                "angry": float(r["Angry_pct"]),
                "disgust": float(r["Disgust_pct"]),
                "happy": float(r["Happy_pct"]),
                "low_affect": float(r["LowAffect_pct"]),
                "arousal": float(r["Arousal_pct"]),
            },
            "pct_scale": "0-100",
        },
        "confidence": 1.0,
        "valid": True,
        "schema_version": "v0.1",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="Path to face summary CSV (one row per visit)")
    ap.add_argument("--runs_dir", default="runs", help="Base runs directory (default: runs)")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    runs_dir = Path(args.runs_dir)
    runs_dir.mkdir(parents=True, exist_ok=True)

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if not rows:
        raise RuntimeError("CSV has no rows")

    created = 0
    skipped = 0

    for r in rows:
        visit_id = r.get("visit_id")
        if not visit_id:
            print("[WARN] Skipping row with missing visit_id")
            continue

        visit_dir = runs_dir / f"visit_{visit_id}"
        visit_dir.mkdir(parents=True, exist_ok=True)

        out_path = visit_dir / "face.jsonl"
        if out_path.exists():
            skipped += 1
            continue

        record = make_record(r)
        out_path.write_text(json.dumps(record) + "\n", encoding="utf-8")
        print(f"[OK] Created {out_path}")
        created += 1

    print(f"[DONE] Created {created} face.jsonl file(s), skipped {skipped} existing")


if __name__ == "__main__":
    main()
