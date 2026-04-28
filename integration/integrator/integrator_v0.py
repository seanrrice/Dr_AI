"""
integration/integrator/integrator_v0.py

Merges audio.jsonl + face.jsonl + gait.jsonl into report.json.

Run manually:
    python integrator_v0.py --visit_dir .\runs\visit_V001
    python integrator_v0.py --runs_dir runs   (uses newest visit)

Flask also calls this automatically via /api/visits/<id>/integrate
"""

import argparse
import json
from pathlib import Path
from datetime import datetime


def load_jsonl(path: Path) -> list:
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except Exception:
                pass
    return records


def get_summary(records: list) -> dict:
    for r in records:
        if r.get("type") == "summary":
            return r
    return records[-1] if records else None


def newest_visit_dir(runs_dir: Path) -> Path:
    visit_dirs = [p for p in runs_dir.glob("visit_*") if p.is_dir()]
    if not visit_dirs:
        raise RuntimeError(f"No visit folders found in {runs_dir}")
    return max(visit_dirs, key=lambda p: p.stat().st_mtime)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs_dir", default="runs")
    ap.add_argument("--visit_dir", default=None)
    args = ap.parse_args()

    if args.visit_dir:
        visit_dir = Path(args.visit_dir)
    else:
        visit_dir = newest_visit_dir(Path(args.runs_dir))

    if not visit_dir.exists():
        raise RuntimeError(f"Visit folder not found: {visit_dir}")

    print(f"[Integrator] Processing: {visit_dir}")

    availability = {"audio": "pending", "face": "pending", "gait": "pending"}
    sections = {}
    visit_id = visit_dir.name.replace("visit_", "")
    patient_mrn = None

    # ── Audio ──────────────────────────────────────────────────────────────────
    audio_records = load_jsonl(visit_dir / "audio.jsonl")
    if audio_records:
        summary = get_summary(audio_records)
        features = summary.get("features", {}) if summary else {}
        windows = [r for r in audio_records if r.get("type") == "window"]

        # ── Collect diagnostic terms across all windows ──
        all_terms = {}
        for w in windows:
            for item in (w.get("features", {}).get("diagnostic_terms") or []):
                if isinstance(item, (list, tuple)) and len(item) == 2:
                    all_terms[item[0]] = item[1]

        # ── Extract distress levels and emotional indicators from windows ──
        distress_levels = []
        all_emotional_indicators = set()
        sentiment_per_window = []

        for w in windows:
            wf = w.get("features", {})
            # sentiment is nested under features.sentiment
            sentiment = wf.get("sentiment", {})
            if not sentiment and wf.get("sentiment_analysis"):
                sentiment = wf.get("sentiment_analysis", {})
            dl = sentiment.get("distress_level")
            if dl:
                distress_levels.append(dl)
            for ind in (sentiment.get("emotional_indicators") or []):
                all_emotional_indicators.add(ind)
            polarity = sentiment.get("polarity") or sentiment.get("sentiment_score")
            if polarity is not None:
                sentiment_per_window.append(polarity)

        # Overall distress level — use worst seen across windows
        distress_priority = {"high": 3, "medium": 2, "low": 1}
        overall_distress = "low"
        if distress_levels:
            overall_distress = max(distress_levels, key=lambda d: distress_priority.get(d, 0))

        # Sentiment trajectory — is it getting better or worse across the visit?
        trajectory = "stable"
        if len(sentiment_per_window) >= 3:
            first_half = sum(sentiment_per_window[:len(sentiment_per_window)//2]) / (len(sentiment_per_window)//2)
            second_half = sum(sentiment_per_window[len(sentiment_per_window)//2:]) / (len(sentiment_per_window) - len(sentiment_per_window)//2)
            diff = second_half - first_half
            if diff > 0.15:
                trajectory = "improving"
            elif diff < -0.15:
                trajectory = "worsening"

        # Top words from summary or aggregated from windows
        top_words = features.get("top_words", [])
        top_topics = features.get("top_topics", [])

        sections["audio"] = {
            "type": "summary",
            "subsystem": "audio",
            "t_start": summary.get("t_start") if summary else None,
            "t_end": summary.get("t_end") if summary else None,
            # Core metrics
            "total_words": features.get("total_words", 0),
            "total_windows": features.get("total_windows", len(windows)),
            "avg_sentiment_polarity": features.get("avg_sentiment_polarity"),
            # Distress analysis
            "distress_level": overall_distress,
            "distress_trajectory": trajectory,
            "emotional_indicators": sorted(all_emotional_indicators),
            # Keywords and topics
            "top_words": top_words,
            "top_topics": top_topics,
            "diagnostic_terms": list(all_terms.items()),
            # Raw data for GUI tabs
            "windows": windows,
            "summary": summary,
            "record_count": len(audio_records),
        }
        availability["audio"] = "available"
        patient_mrn = patient_mrn or (summary or {}).get("patient_mrn") or (summary or {}).get("patient_id")
        print(f"[Integrator] Audio: {len(audio_records)} records, {len(windows)} windows, distress={overall_distress}, trajectory={trajectory}")

    # ── Face ───────────────────────────────────────────────────────────────────
    face_records = load_jsonl(visit_dir / "face.jsonl")
    if face_records:
        summary = get_summary(face_records)
        features = summary.get("features", {}) if summary else {}
        emotion_pct = features.get("emotion_pct", {})
        dominant = max(emotion_pct.items(), key=lambda kv: kv[1])[0] if emotion_pct else None

        sections["face"] = {
            "type": "summary",
            "subsystem": "face",
            "t_start": summary.get("t_start") if summary else None,
            "t_end": summary.get("t_end") if summary else None,
            "total_samples": features.get("total_samples", 0),
            "dominant_emotion": dominant,
            "emotion_pct": emotion_pct,
            "emotion_counts": features.get("emotion_counts", {}),
            "model_version": (summary or {}).get("model_version"),
            "features": features,
        }
        availability["face"] = "available"
        patient_mrn = patient_mrn or (summary or {}).get("patient_mrn") or (summary or {}).get("patient_id")
        print(f"[Integrator] Face: dominant={dominant}, samples={features.get('total_samples', 0)}")

    # ── Gait ───────────────────────────────────────────────────────────────────
    gait_records = load_jsonl(visit_dir / "gait.jsonl")
    if gait_records:
        summary = get_summary(gait_records)
        sections["gait"] = summary or {}
        availability["gait"] = "available"
        print(f"[Integrator] Gait: {len(gait_records)} records")

    # ── Write report.json ──────────────────────────────────────────────────────
    report = {
        "schema_version": "v0.1",
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "visit_id": visit_id,
        "patient_mrn": patient_mrn,
        "partial": any(v == "pending" for v in availability.values()),
        "availability": availability,
        "sections": sections,
    }

    out = visit_dir / "report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"[Integrator] report.json written → {out}")
    print(f"[Integrator] Availability: {availability}")


if __name__ == "__main__":
    main()