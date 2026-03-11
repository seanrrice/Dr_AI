from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt


def safe_now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def load_manifest(visit_dir: Path) -> dict:
    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError(f"Missing manifest.json in {visit_dir}")
    with open(manifest_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_jsonl(path: Path) -> list[dict]:
    records = []
    if not path.exists():
        return records

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def get_latest_summary(records: list[dict]) -> dict | None:
    summaries = [r for r in records if r.get("type") == "summary"]
    if not summaries:
        return None
    return summaries[-1]


def make_face_bar_chart(emotion_pct: dict, out_path: Path) -> None:
    labels = list(emotion_pct.keys())
    values = [emotion_pct[k] for k in labels]

    plt.figure(figsize=(8, 5))
    plt.bar(labels, values)
    plt.title("Face Emotion Distribution")
    plt.xlabel("Emotion")
    plt.ylabel("Percent (0-100)")
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=200)
    plt.close()


def process_face(visit_dir: Path) -> tuple[dict, dict]:
    """
    Returns:
        section_data, figures_data
    """
    face_path = visit_dir / "face.jsonl"
    records = load_jsonl(face_path)

    if not records:
        return (
            {
                "status": "missing",
                "message": "No face.jsonl found"
            },
            {}
        )

    summary = get_latest_summary(records)
    if summary is None:
        return (
            {
                "status": "invalid",
                "message": "No summary record found in face.jsonl"
            },
            {}
        )

    features = summary.get("features", {})
    emotion_pct = features.get("emotion_pct", {})
    emotion_counts = features.get("emotion_counts", {})

    dominant_emotion = None
    if emotion_pct:
        dominant_emotion = max(emotion_pct.items(), key=lambda kv: kv[1])[0]

    figures = {}
    if emotion_pct:
        fig_path = visit_dir / "figures" / "face_emotion_bar.png"
        make_face_bar_chart(emotion_pct, fig_path)
        figures["face_emotion_bar"] = str(Path("figures") / "face_emotion_bar.png")

    section = {
        "status": "available",
        "phase": summary.get("phase"),
        "t_start": summary.get("t_start"),
        "t_end": summary.get("t_end"),
        "confidence": summary.get("confidence"),
        "valid": summary.get("valid"),
        "model_version": summary.get("model_version"),
        "visit_label": features.get("visit_label"),
        "timestamp": features.get("timestamp"),
        "total_samples": features.get("total_samples"),
        "pct_scale": features.get("pct_scale", "0-100"),
        "dominant_emotion": dominant_emotion,
        "emotion_pct": emotion_pct,
        "emotion_counts": emotion_counts,
    }

    return section, figures


def process_audio(visit_dir: Path) -> dict:
    audio_path = visit_dir / "audio.jsonl"
    if not audio_path.exists():
        return {
            "status": "missing",
            "message": "Audio subsystem output not available yet"
        }

    return {
        "status": "pending",
        "message": "Audio subsystem integration not yet implemented"
    }


def process_gait(visit_dir: Path) -> dict:
    gait_path = visit_dir / "gait.jsonl"
    if not gait_path.exists():
        return {
            "status": "missing",
            "message": "Gait subsystem output not available yet"
        }

    return {
        "status": "pending",
        "message": "Gait subsystem integration not yet implemented"
    }


def compute_availability(face_section: dict, audio_section: dict, gait_section: dict) -> dict:
    return {
        "face": face_section.get("status", "missing"),
        "audio": audio_section.get("status", "missing"),
        "gait": gait_section.get("status", "missing"),
    }


def build_report(visit_dir: Path, manifest: dict) -> dict:
    face_section, face_figures = process_face(visit_dir)
    audio_section = process_audio(visit_dir)
    gait_section = process_gait(visit_dir)

    availability = compute_availability(face_section, audio_section, gait_section)

    report = {
        "schema_version": "v0.1",
        "generated_utc": safe_now_iso(),
        "visit_id": manifest.get("visit_id"),
        "patient_id": manifest.get("patient_id"),
        "visit_label": manifest.get("visit_label"),
        "manifest_created_utc": manifest.get("created_utc"),
        "phases": manifest.get("phases", {}),
        "expected_subsystems": manifest.get("expected_subsystems", []),
        "availability": availability,
        "sections": {
            "face_encounter_summary": face_section,
            "audio_encounter_summary": audio_section,
            "gait_entry_summary": gait_section,
        },
        "figures": {}
    }

    report["figures"].update(face_figures)

    # Placeholder for future synthesis logic
    report["encounter_synthesis"] = {
        "status": "pending",
        "message": "Cross-modal synthesis will be added when audio and gait outputs are integrated"
    }

    return report


def newest_visit_dir(runs_dir: Path) -> Path:
    visit_dirs = [p for p in runs_dir.glob("visit_*") if p.is_dir()]
    if not visit_dirs:
        raise RuntimeError(f"No visit folders found in {runs_dir}")
    return max(visit_dirs, key=lambda p: p.stat().st_mtime)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs_dir", default="runs", help="Base runs directory (default: runs)")
    ap.add_argument("--visit_dir", default=None, help="Optional specific visit directory")
    args = ap.parse_args()

    runs_dir = Path(args.runs_dir)

    if args.visit_dir:
        visit_dir = Path(args.visit_dir)
        if not visit_dir.exists():
            raise RuntimeError(f"visit_dir not found: {visit_dir}")
    else:
        visit_dir = newest_visit_dir(runs_dir)

    manifest = load_manifest(visit_dir)
    report = build_report(visit_dir, manifest)

    report_path = visit_dir / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"[OK] Visit directory: {visit_dir}")
    print(f"[OK] Wrote report: {report_path}")

    figures = report.get("figures", {})
    if figures:
        for name, rel_path in figures.items():
            print(f"[OK] Figure: {name} -> {rel_path}")


if __name__ == "__main__":
    main()