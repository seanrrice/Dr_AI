from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

EMOTION_LABELS = ["angry", "disgust", "happy", "low_affect", "arousal"]


def safe_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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

def load_face_history_for_patient(runs_dir: Path, patient_id: str) -> pd.DataFrame:
    """
    Load all face summary records across all visits for one patient.
    Returns a DataFrame sorted by timestamp.
    """
    records = []

    visit_dirs = sorted([p for p in runs_dir.glob("visit_*") if p.is_dir()])
    for visit_dir in visit_dirs:
        face_path = visit_dir/ "face.jsonl"
        if not face_path.exists():
            continue

        face_records = load_jsonl(face_path)
        for record in face_records:
            if record.get("type") != "summary":
                continue
            if record.get("patient_id") != patient_id:
                continue
            features = record.get("features", {})
            emotion_counts = features.get("emotion_counts", {})
            emotion_pct = features.get("emotion_pct", {})

            flat = {
                "visit_id": record.get("visit_id"),
                "patient_id": record.get("patient_id"),
                "phase": record.get("phase"),
                "t_start": record.get("t_start"),
                "t_end": record.get("t_end"),
                "confidence": record.get("confidence"),
                "valid": record.get("valid"),
                "schema_version": record.get("schema_version"),
                "model_version": record.get("model_version"),
                "timestamp": features.get("timestamp", ""),
                "visit_label": features.get("visit_label", ""),
                "total_samples": features.get("total_samples", 0),
            }

            for emo in emotion_counts:
                flat[f"{emo}_count"] = emotion_counts.get(emo, 0)
                flat[f"{emo}_pct"] = emotion_pct.get(emo, 0.0)
            
            records.append(flat)
       
    if not records:
            print("[INFO] no record found")
            return pd.DataFrame()
        
    df = pd.DataFrame(records)

        #sort by timestamp if available, otherwise leave as-is
    if "timestamp" in df.columns:
         df = df.sort_values("timestamp").reset_index(drop=True)
        
    df["visit_number"] = range(1, len(df) + 1)
    
    return df

def compute_dominant_emotions(history_df: pd.DataFrame) -> pd.DataFrame:
    if history_df.empty:
        return history_df

    pct_cols = [f"{emo}_pct" for emo in EMOTION_LABELS]
    existing_pct_cols = [c for c in pct_cols if c in history_df.columns]

    if not existing_pct_cols:
        history_df["dominant_emotion"] = None
        return history_df

    history_df = history_df.copy()
    history_df["dominant_emotion"] = (
        history_df[existing_pct_cols]
        .idxmax(axis=1)
        .str.replace("_pct", "", regex=False)
        .str.replace("_", " ", regex=False)
        .str.title()
    )
    return history_df

def make_face_trend_plot(history_df: pd.DataFrame, out_path: Path) -> None:
    """
    Save longitudinal emotion trend plot across visits for one patient.
    """
    if history_df.empty or len(history_df) < 2:
        return

    plt.figure(figsize=(10, 6))

    for emo in EMOTION_LABELS:
        col = f"{emo}_pct"
        if col not in history_df.columns:
            continue

        plt.plot(
            history_df["visit_number"],
            history_df[col],
            marker="o",
            label=emo.replace("_", " ").title(),
            linewidth=2,
        )

    plt.title(f"Face Emotion Trends Across Visits - Patient {history_df.iloc[0]['patient_id']}")
    plt.xlabel("Visit Number")
    plt.ylabel("Percentage (0-100)")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=200)
    plt.close()

def build_face_serial_trends(runs_dir: Path, patient_id: str, current_visit_dir: Path) -> tuple[dict, dict]:
    """
    Returns:
        serial_trends_section, figures_dict
    """
    history_df = load_face_history_for_patient(runs_dir, patient_id)

    if history_df.empty:
        return (
            {
                "status": "missing",
                "message": "No face history available for this patient"
            },
            {}
        )

    history_df = compute_dominant_emotions(history_df)

    latest_visit = history_df.iloc[-1].to_dict()

    section = {
        "status": "available",
        "num_visits": int(len(history_df)),
        "latest_visit_id": latest_visit.get("visit_id"),
        "latest_visit_label": latest_visit.get("visit_label"),
        "latest_dominant_emotion": latest_visit.get("dominant_emotion"),
        "dominant_emotions_by_visit": [
            {
                "visit_number": int(row["visit_number"]),
                "visit_id": row.get("visit_id"),
                "visit_label": row.get("visit_label"),
                "dominant_emotion": row.get("dominant_emotion"),
                "t_end": row.get("t_end"),
            }
            for _, row in history_df.iterrows()
        ],
    }

    figures = {}

    if len(history_df) > 1:
        fig_path = current_visit_dir / "figures" / "face_serial_trends.png"
        make_face_trend_plot(history_df, fig_path)
        figures["face_serial_trends"] = str(Path("figures") / "face_serial_trends.png")
    else:
        section["message"] = "Only one visit available; no trend plot generated"

    return section, figures

#==========================================================================
#Process each subsystem's output and produce a structured section for the report, along with any figures to be included. For now we have a simple implementation for face, and placeholders for audio and gait which can be filled in as those subsystems are integrated.
#========================================================================

# Face: Currently processses summary record only, can be extended to do more complex processing of the raw records if needed in the future
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


def build_report(visit_dir: Path, manifest: dict, runs_dir: Path) -> dict:
    face_section, face_figures = process_face(visit_dir)
    audio_section = process_audio(visit_dir)
    gait_section = process_gait(visit_dir)

    availability = compute_availability(face_section, audio_section, gait_section)

    patient_id = manifest.get("patient_id")
    if patient_id:
        face_serial_section, face_serial_figures = build_face_serial_trends(
            runs_dir=runs_dir,
            patient_id=patient_id,
            current_visit_dir=visit_dir,
        )
    else:
        face_serial_section, face_serial_figures = (
            {
                "status": "missing",
                "message": "No patient_id in manifest; cannot compute serial trends"
            },
            {}
        )

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
        "serial_trends": {
            "face": face_serial_section
        },
        "figures": {}
    }

    report["figures"].update(face_figures)
    report["figures"].update(face_serial_figures)

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
    report = build_report(visit_dir, manifest, runs_dir)

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