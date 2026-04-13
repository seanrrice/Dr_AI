import os
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import time
import json
import threading
import cv2
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

from gait_capture_realsense_advanced import capture_motion_realsense, request_stop
from common_utils.orchestrator_utils import update_manifest_status, read_manifest

app = Flask(__name__)
CORS(app)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = PROJECT_ROOT / "DrAITranscription" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_DIR = os.path.abspath("./gait_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

_frame_lock = threading.Lock()
_latest_jpeg = None


def _update_latest_frame_bgr(frame_bgr):
    global _latest_jpeg
    ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        return
    with _frame_lock:
        _latest_jpeg = buf.tobytes()


def _mjpeg_generator():
    global _latest_jpeg
    while True:
        with _frame_lock:
            jpg = _latest_jpeg
        if jpg is None:
            time.sleep(0.02)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
        )
        time.sleep(1 / 30.0)


def ensure_manifest_exists(visit_dir: Path, visit_id: str, patient_id: str):
    manifest = read_manifest(visit_dir)
    if manifest:
        return

    manifest_path = visit_dir / "manifest.json"
    new_manifest = {
        "schema_version": "v0.1",
        "visit_id": visit_id,
        "patient_id": patient_id,
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expected_subsystems": ["audio", "face", "gait"],
        "status": {
            "audio": "pending",
            "face": "pending",
            "gait": "pending"
        }
    }

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(new_manifest, f, indent=2)


def _write_gait_jsonl(visit_id, patient_id, summary):
    visit_dir = RUNS_DIR / f"visit_{visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)
    ensure_manifest_exists(visit_dir, str(visit_id), str(patient_id or visit_id))

    update_manifest_status(visit_dir, "gait", "running")

    gait_jsonl_path = visit_dir / "gait.jsonl"

    payload = {
        "visit_id": str(visit_id),
        "patient_id": str(patient_id or visit_id),
        "subsystem": "gait",
        "phase": "encounter",
        "type": "summary",
        "t_start": 0.0,
        "t_end": summary.get("duration_s"),
        "features": summary,
        "confidence": 1.0,
        "valid": True,
        "schema_version": "v0.1",
        "model_version": "gait_realsense_v1"
    }

    with open(gait_jsonl_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")

    update_manifest_status(visit_dir, "gait", "done")


@app.route("/api/gait/live", methods=["GET"])
def api_gait_live():
    return Response(
        _mjpeg_generator(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/api/gait", methods=["GET"])
def api_gait():
    try:
        duration = request.args.get("duration", default=0.0, type=float)
        visit_id = request.args.get("visit_id")
        patient_id = request.args.get("patient_id")

        max_duration_s = None if duration <= 0 else float(duration)

        ts = time.strftime("%Y%m%d_%H%M%S")
        video_name = f"gait_overlay_{ts}.mp4"
        video_path = os.path.join(OUTPUT_DIR, video_name)

        json_name = f"gait_summary_{ts}.json"
        json_path = os.path.join(OUTPUT_DIR, json_name)

        summary = capture_motion_realsense(
            max_duration_s=max_duration_s,
            export_overlay_video=True,
            overlay_out_path=video_path,
            show_window=False,
            frame_callback=_update_latest_frame_bgr,
        )

        overlay_video_url = f"/api/gait/video/{video_name}"
        summary_json_url = f"/api/gait/summary/{json_name}"

        summary["overlay_video_url"] = overlay_video_url
        summary["summary_json_url"] = summary_json_url

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)

        if visit_id:
            _write_gait_jsonl(visit_id, patient_id or visit_id, summary)

        return jsonify({"ok": True, "summary": summary})

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/gait/stop", methods=["POST"])
def api_gait_stop():
    request_stop()
    return jsonify({"ok": True})


@app.route("/api/gait/video/<path:filename>", methods=["GET"])
def api_gait_video(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


@app.route("/api/gait/summary/<path:filename>", methods=["GET"])
def api_gait_summary(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True, threaded=True)