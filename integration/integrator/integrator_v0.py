import argparse
import json
from pathlib import Path
from datetime import datetime

import matplotlib.pyplot as plt


def load_jsonl_first(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        line = f.readline().strip()
        if not line:
            raise RuntimeError(f"Empty JSONL: {path}")
        return json.loads(line)


def newest_visit_dir(runs_dir: Path) -> Path:
    visit_dirs = [p for p in runs_dir.glob("visit_*") if p.is_dir()]
    if not visit_dirs:
        raise RuntimeError(f"No visit folders found in {runs_dir}")
    # Use folder modification time as a simple "latest"
    return max(visit_dirs, key=lambda p: p.stat().st_mtime)


def safe_now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def make_face_bar_chart(emotion_pct: dict, out_path: Path) -> None:
    labels = list(emotion_pct.keys())
    values = [emotion_pct[k] for k in labels]

    plt.figure()
    plt.title("Facial Emotion Distribution (Encounter)")
    plt.xlabel("Emotion")
    plt.ylabel("Percent (0–100)")
    plt.bar(labels, values)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=200)
    plt.close()


def build_report(visit_dir: Path, face_record: dict, figure_rel_path: str) -> dict:
    features = face_record.get("features", {})
    emotion_pct = features.get("emotion_pct", {})
    pct_scale = features.get("pct_scale", "unknown")

    # dominant emotion (by percentage)
    dominant = None
    if isinstance(emotion_pct, dict) and emotion_pct:
        dominant = max(emotion_pct.items(), key=lambda kv: kv[1])[0]

    report = {
        "schema_version": "v0.1",
        "generated_utc": safe_now_iso(),
        "visit_id": face_record.get("visit_id"),
        "patient_id": face_record.get("patient_id"),
        "availability": {
            "face": "available",
            "audio": "pending",
            "gait": "pending",
        },
        "sections": {
            "face_encounter_summary": {
                "visit_label": features.get("visit_label"),
                "timestamp": features.get("timestamp"),
                "total_samples": features.get("total_samples"),
                "pct_scale": pct_scale,
                "dominant_emotion": dominant,
                "emotion_pct": emotion_pct,
                "emotion_counts": features.get("emotion_counts", {}),
            }
        },
        "figures": {
            "face_emotion_bar": figure_rel_path
        }
    }
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs_dir", default="runs", help="Base runs directory (default: runs)")
    ap.add_argument("--visit_dir", default=None, help="Optional: specific visit folder path")
    args = ap.parse_args()

    runs_dir = Path(args.runs_dir)
    if args.visit_dir:
        visit_dir = Path(args.visit_dir)
        if not visit_dir.exists():
            raise RuntimeError(f"visit_dir not found: {visit_dir}")
    else:
        visit_dir = newest_visit_dir(runs_dir)

    face_jsonl = visit_dir / "face.jsonl"
    if not face_jsonl.exists():
        raise RuntimeError(f"Missing face.jsonl in {visit_dir}")

    face_record = load_jsonl_first(face_jsonl)

    # Build figure
    figures_dir = visit_dir / "figures"
    fig_path = figures_dir / "face_emotion_bar.png"
    emotion_pct = face_record.get("features", {}).get("emotion_pct", {})
    if not isinstance(emotion_pct, dict) or not emotion_pct:
        raise RuntimeError("face.jsonl record missing features.emotion_pct")

    make_face_bar_chart(emotion_pct, fig_path)

    # Build report.json
    report_rel_fig = str(Path("figures") / fig_path.name)
    report = build_report(visit_dir, face_record, report_rel_fig)

    report_path = visit_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"[OK] Visit: {visit_dir}")
    print(f"[OK] Wrote: {report_path}")
    print(f"[OK] Wrote: {fig_path}")


if __name__ == "__main__":
    main()
