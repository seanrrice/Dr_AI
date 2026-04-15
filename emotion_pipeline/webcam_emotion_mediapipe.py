"""
Webcam Emotion Detection - legacy/standalone debug path.

This script is intentionally preserved as an OpenCV-window flow for manual debugging.
The integrated GUI path now uses browser webcam + Flask frame API.
"""
from __future__ import annotations

import argparse
import cv2
import json
import time
from datetime import datetime
from pathlib import Path

from emotion_pipeline.face_runtime import FaceAnalysisSession, VisitContext


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--visit_id", default=None, help="Visit ID created by orchestrator")
    ap.add_argument("--patient_id", default=None, help="Patient identifier")
    ap.add_argument("--visit_label", default=None, help="Visit label/date string")
    ap.add_argument("--runs_dir", default="runs", help="Directory to save visit logs")
    ap.add_argument("--camera_index", type=int, default=0, help="OpenCV camera index")
    ap.add_argument("--analysis_fps", type=float, default=2.0, help="Approx analysis request rate")
    return ap.parse_args()


def main():
    args = parse_args()
    using_cli_visit = args.visit_id is not None and args.patient_id is not None

    if using_cli_visit:
        visit_id = args.visit_id
        patient_id = args.patient_id
        visit_label = args.visit_label if args.visit_label else datetime.now().date().isoformat()
    else:
        print("[INFO] No orchestrator visit args supplied; entering standalone mode")
        patient_id = input("Patient ID (or MRN / initials): ").strip() or "Unknown"
        visit_label = datetime.now().date().isoformat()
        visit_id = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")

    runs_dir = Path(args.runs_dir)
    visit_dir = runs_dir / f"visit_{visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)
    stop_file = visit_dir / "stop_face.txt"

    session = FaceAnalysisSession(
        context=VisitContext(
            visit_id=str(visit_id),
            patient_id=str(patient_id),
            visit_label=str(visit_label),
            runs_dir=runs_dir,
        ),
        log_interval_sec=max(0.3, 1.0 / max(0.2, args.analysis_fps)),
    )

    cap = cv2.VideoCapture(args.camera_index, cv2.CAP_DSHOW)
    print(f"[INFO] Opening camera index {args.camera_index}")
    if not cap.isOpened():
        print("[ERROR] Could not open webcam.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[WARN] Failed to grab frame")
                break

            result = session.analyze_frame(frame)
            if result.get("detections"):
                for det in result["detections"]:
                    b = det["bbox"]
                    cv2.rectangle(
                        frame,
                        (b["x"], b["y"]),
                        (b["x"] + b["width"], b["y"] + b["height"]),
                        (0, 255, 0),
                        2,
                    )
                    cv2.putText(
                        frame,
                        det["label"],
                        (b["x"], max(0, b["y"] - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (0, 255, 0),
                        2,
                    )

            cv2.imshow("Webcam Emotion (Legacy Debug)", frame)

            if stop_file.exists():
                print("[INFO] Stop signal detected. Ending face subsystem.")
                break
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()

        if stop_file.exists():
            try:
                stop_file.unlink()
            except Exception:
                pass

        summary = session.finalize()
        print(f"[INFO] Face subsystem complete: {json.dumps(summary)}")


if __name__ == "__main__":
    main()
