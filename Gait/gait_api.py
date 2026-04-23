import os
import time
import json
import threading
import cv2
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

from gait_capture_realsense_advanced import capture_motion_realsense, request_stop

app = Flask(__name__)
CORS(app)

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


def save_gait_jsonl(summary, jsonl_path, visit_id=None, patient_id=None):
    """
    Saves gait output as JSONL.
    Each line is one JSON object.
    This creates:
      1. session_start record
      2. gait_summary record
      3. session_end record
    """

    timestamp_start = time.time()

    session_start = {
        "event": "gait_session_start",
        "subsystem": "gait",
        "visit_id": visit_id,
        "patient_id": patient_id,
        "timestamp_unix": timestamp_start,
        "timestamp_readable": time.strftime("%Y-%m-%d %H:%M:%S")
    }

    gait_summary = {
        "event": "gait_summary",
        "subsystem": "gait",
        "visit_id": visit_id,
        "patient_id": patient_id,
        "timestamp_unix": time.time(),
        "metrics": {
            "num_steps_est": summary.get("num_steps_est"),
            "cadence_spm": summary.get("cadence_spm"),
            "mean_speed_mps": summary.get("mean_speed_mps"),
            "mean_speed_norm_per_s": summary.get("mean_speed_norm_per_s"),
            "left_knee_mean_deg": summary.get("left_knee_mean_deg"),
            "left_knee_std_deg": summary.get("left_knee_std_deg"),
            "right_knee_mean_deg": summary.get("right_knee_mean_deg"),
            "right_knee_std_deg": summary.get("right_knee_std_deg"),
            "knee_mean_abs_diff_deg": summary.get("knee_mean_abs_diff_deg"),
            "knee_symmetry_index_percent": summary.get("knee_symmetry_index_percent"),
            "symmetry_index": summary.get("knee_symmetry_index_percent"),
            "trunk_sway_rms_m": summary.get("trunk_sway_rms_m"),
            "trunk_sway_peak_to_peak_m": summary.get("trunk_sway_peak_to_peak_m"),
            "trunk_sway_rms_norm": summary.get("trunk_sway_rms_norm"),
            "trunk_sway_peak_to_peak_norm": summary.get("trunk_sway_peak_to_peak_norm"),
            "sit_to_stand_detected": summary.get("sit_to_stand_detected"),
            "sit_to_stand_duration_s": summary.get("sit_to_stand_duration_s"),
            "quality_ok_fraction": summary.get("quality_ok_fraction"),
            "duration_s": summary.get("duration_s")
        },
        "artifacts": {
            "overlay_video_url": summary.get("overlay_video_url"),
            "summary_json_url": summary.get("summary_json_url")
        }
    }

    session_end = {
        "event": "gait_session_end",
        "subsystem": "gait",
        "visit_id": visit_id,
        "patient_id": patient_id,
        "timestamp_unix": time.time(),
        "timestamp_readable": time.strftime("%Y-%m-%d %H:%M:%S")
    }

    with open(jsonl_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(session_start) + "\n")
        f.write(json.dumps(gait_summary) + "\n")
        f.write(json.dumps(session_end) + "\n")


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
        max_duration_s = None if duration <= 0 else float(duration)

        # Optional visit/patient IDs for report generation
        visit_id = request.args.get("visit_id", default=None, type=str)
        patient_id = request.args.get("patient_id", default=None, type=str)

        ts = time.strftime("%Y%m%d_%H%M%S")

        video_name = f"gait_overlay_{ts}.mp4"
        video_path = os.path.join(OUTPUT_DIR, video_name)

        json_name = f"gait_summary_{ts}.json"
        json_path = os.path.join(OUTPUT_DIR, json_name)

        jsonl_name = f"gait_log_{ts}.jsonl"
        jsonl_path = os.path.join(OUTPUT_DIR, jsonl_name)

        summary = capture_motion_realsense(
            max_duration_s=max_duration_s,
            export_overlay_video=True,
            overlay_out_path=video_path,
            show_window=False,
            frame_callback=_update_latest_frame_bgr,
        )

        overlay_video_url = f"/api/gait/video/{video_name}"
        summary_json_url = f"/api/gait/summary/{json_name}"
        summary_jsonl_url = f"/api/gait/jsonl/{jsonl_name}"

        summary["overlay_video_url"] = overlay_video_url
        summary["summary_json_url"] = summary_json_url
        summary["summary_jsonl_url"] = summary_jsonl_url
        summary["jsonl_path"] = jsonl_path

        # Save normal JSON summary
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)

        # Save JSONL log
        save_gait_jsonl(
            summary=summary,
            jsonl_path=jsonl_path,
            visit_id=visit_id,
            patient_id=patient_id
        )

        return jsonify({
            "ok": True,
            "summary": summary,
            "files": {
                "overlay_video": overlay_video_url,
                "summary_json": summary_json_url,
                "summary_jsonl": summary_jsonl_url
            }
        })

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


@app.route("/api/gait/jsonl/<path:filename>", methods=["GET"])
def api_gait_jsonl(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True, threaded=True)