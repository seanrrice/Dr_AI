import time
import numpy as np
import cv2
import mediapipe as mp
import pyrealsense2 as rs
from dataclasses import dataclass
from typing import Optional, Dict, Any, List, Tuple, Callable

mp_pose = mp.solutions.pose
mp_draw = mp.solutions.drawing_utils

_stop_flag = False


def request_stop():
    global _stop_flag
    _stop_flag = True


def clamp_int(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def angle3d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    ba = a - b
    bc = c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cosang = float(np.dot(ba, bc) / denom)
    cosang = np.clip(cosang, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosang)))


def moving_average(x: np.ndarray, win: int = 5) -> np.ndarray:
    if len(x) < win or win <= 1:
        return x
    kernel = np.ones(win, dtype=float) / win
    return np.convolve(x, kernel, mode="same")


def robust_diff(x: np.ndarray) -> np.ndarray:
    if len(x) < 2:
        return np.zeros_like(x)
    dx = np.diff(x)
    return np.concatenate([[0.0], dx])


def symmetry_index(a: float, b: float) -> float:
    denom = 0.5 * (abs(a) + abs(b)) + 1e-8
    return float(abs(a - b) / denom * 100.0)


def landmark_to_pixel(lm, w: int, h: int) -> Tuple[int, int]:
    px = clamp_int(int(round(lm.x * w)), 0, w - 1)
    py = clamp_int(int(round(lm.y * h)), 0, h - 1)
    return px, py


def deproject(intr: rs.intrinsics, px: int, py: int, depth_m: float) -> np.ndarray:
    X, Y, Z = rs.rs2_deproject_pixel_to_point(intr, [float(px), float(py)], float(depth_m))
    return np.array([X, Y, Z], dtype=np.float32)


@dataclass
class GateResult:
    ok: bool
    reason: str


def gate_visibility(lm_list: List, pose_landmarks, key_ids: List[int], vis_thresh: float) -> GateResult:
    if not pose_landmarks:
        return GateResult(False, "no_pose")
    if any(lm_list[int(i)].visibility < vis_thresh for i in key_ids):
        return GateResult(False, "low_visibility")
    return GateResult(True, "ok")


def _horizontal_pca_axis(points_xyz: np.ndarray) -> Optional[np.ndarray]:
    """
    Estimate primary motion axis in horizontal plane (X-Z) using PCA.
    Returns a 3D unit vector [x, 0, z].
    """
    if points_xyz.shape[0] < 12:
        return None

    xz = points_xyz[:, [0, 2]]
    xz = xz - np.mean(xz, axis=0, keepdims=True)

    if np.linalg.norm(xz) < 1e-6:
        return None

    cov = np.cov(xz.T)
    vals, vecs = np.linalg.eigh(cov)
    v = vecs[:, int(np.argmax(vals))]
    v = v / (np.linalg.norm(v) + 1e-8)

    axis = np.array([float(v[0]), 0.0, float(v[1])], dtype=float)
    axis = axis / (np.linalg.norm(axis) + 1e-8)
    return axis


def _project_lateral_axis(forward_axis: np.ndarray) -> np.ndarray:
    up = np.array([0.0, 1.0, 0.0], dtype=float)
    lat = np.cross(up, forward_axis)
    lat[1] = 0.0
    lat = lat / (np.linalg.norm(lat) + 1e-8)
    return lat


def _find_peaks_1d(
    x: np.ndarray,
    thresh: float,
    min_sep: int,
    min_prom: float = 0.01,
    prom_win: int = 10,
) -> List[int]:
    peaks: List[int] = []
    last = -10**9
    n = len(x)

    if n < 3:
        return peaks

    for i in range(1, n - 1):
        if x[i] < thresh:
            continue
        if not (x[i] >= x[i - 1] and x[i] >= x[i + 1]):
            continue
        if i - last < min_sep:
            continue

        w = int(min(prom_win, i, (n - 1 - i)))
        if w <= 1:
            prom_ok = True
        else:
            left_min = float(np.min(x[i - w:i]))
            right_min = float(np.min(x[i + 1:i + 1 + w]))
            prom = float(x[i] - max(left_min, right_min))
            prom_ok = prom >= float(min_prom)

        if prom_ok:
            peaks.append(i)
            last = i

    return peaks


def _compute_sts_from_yrel(
    t: np.ndarray,
    y_rel_sm: np.ndarray,
    fps_est: float
) -> Tuple[bool, Optional[float], Optional[int], Optional[int]]:
    """
    Sit-to-stand detection using relative vertical signal:
        y_rel = pelvisY - shoulderY
    RealSense Y is positive downward. Standing up decreases y_rel.

    Returns:
      detected, duration_s, start_idx, end_idx
    """
    n = len(y_rel_sm)
    if n < 30:
        return False, None, None, None

    sit_win_s = 1.5
    stand_win_s = 1.5
    sit_start_offset_s = 0.5

    sit_win = int(max(8, sit_win_s * fps_est))
    stand_win = int(max(8, stand_win_s * fps_est))
    sit_start = int(min(max(0, sit_start_offset_s * fps_est), max(0, n - sit_win - 1)))

    if sit_start + sit_win >= n or stand_win >= n:
        return False, None, None, None

    sit_seg = y_rel_sm[sit_start:sit_start + sit_win]
    stand_seg = y_rel_sm[n - stand_win:n]

    sit_level = float(np.median(sit_seg))
    stand_level = float(np.median(stand_seg))

    sit_std = float(np.std(sit_seg))
    stand_std = float(np.std(stand_seg))

    if sit_std > 0.08 and stand_std > 0.08:
        return False, None, None, None

    drop = sit_level - stand_level
    min_drop = 0.04  # 4 cm equivalent in relative vertical signal

    if drop < min_drop:
        return False, None, None, None

    y_start_thresh = sit_level - 0.20 * drop
    y_end_thresh = sit_level - 0.80 * drop

    sustain = int(max(3, 0.15 * fps_est))

    start_idx = None
    for i in range(sit_start, n - sustain):
        if np.all(y_rel_sm[i:i + sustain] <= y_start_thresh):
            start_idx = i
            break

    if start_idx is None:
        return False, None, None, None

    end_idx = None
    for j in range(start_idx + sustain, n - sustain):
        if np.all(y_rel_sm[j:j + sustain] <= y_end_thresh):
            end_idx = j
            break

    if end_idx is None or end_idx <= start_idx:
        return False, None, None, None

    return True, float(t[end_idx] - t[start_idx]), int(start_idx), int(end_idx)


def _compute_planar_stability_metrics(
    pelvis_xyz: np.ndarray,
    prefer_axis: Optional[np.ndarray] = None
) -> Dict[str, Any]:
    """
    Computes pelvis stability in horizontal plane:
      - AP RMS
      - ML RMS
      - planar RMS = sqrt(mean((ap-ap_mean)^2 + (ml-ml_mean)^2))

    AP/ML are determined from a horizontal PCA axis when possible.
    """
    if pelvis_xyz.shape[0] < 5:
        return {
            "stability_ap_rms_m": None,
            "stability_ml_rms_m": None,
            "stability_planar_rms_m": None,
            "stability_ap_series_m": [],
            "stability_ml_series_m": [],
            "stability_axis_ap_xyz": None,
            "stability_axis_ml_xyz": None,
        }

    ap_axis = prefer_axis
    if ap_axis is None:
        ap_axis = _horizontal_pca_axis(pelvis_xyz)

    if ap_axis is None:
        # fallback: use camera Z as AP
        ap_axis = np.array([0.0, 0.0, 1.0], dtype=float)

    ml_axis = _project_lateral_axis(ap_axis)

    pelvis_centered = pelvis_xyz - np.mean(pelvis_xyz, axis=0, keepdims=True)

    ap_series = np.dot(pelvis_centered, ap_axis)
    ml_series = np.dot(pelvis_centered, ml_axis)

    # Remove slow drift and camera/pose tracking bias so RMS reflects sway,
    # not long-trend translation through the scene.
    def _detrend_and_clip(series: np.ndarray) -> np.ndarray:
        if series.size < 5:
            return series - np.mean(series)
        x = np.arange(series.size, dtype=float)
        coeff = np.polyfit(x, series, 1)
        trend = coeff[0] * x + coeff[1]
        residual = series - trend
        lo, hi = np.percentile(residual, [2.0, 98.0])
        residual = np.clip(residual, lo, hi)
        return residual - np.mean(residual)

    ap_series = _detrend_and_clip(ap_series)
    ml_series = _detrend_and_clip(ml_series)

    ap_rms = float(np.sqrt(np.mean(ap_series ** 2)))
    ml_rms = float(np.sqrt(np.mean(ml_series ** 2)))
    planar_rms = float(np.sqrt(np.mean(ap_series ** 2 + ml_series ** 2)))

    return {
        "stability_ap_rms_m": ap_rms,
        "stability_ml_rms_m": ml_rms,
        "stability_planar_rms_m": planar_rms,
        "stability_ap_series_m": [float(x) for x in ap_series.tolist()],
        "stability_ml_series_m": [float(x) for x in ml_series.tolist()],
        "stability_axis_ap_xyz": [float(ap_axis[0]), float(ap_axis[1]), float(ap_axis[2])],
        "stability_axis_ml_xyz": [float(ml_axis[0]), float(ml_axis[1]), float(ml_axis[2])],
    }


def capture_motion_realsense(
    max_duration_s: Optional[float] = 15.0,
    export_overlay_video: bool = True,
    overlay_out_path: str = "gait_overlay.mp4",
    show_window: bool = False,
    vis_thresh: float = 0.6,
    min_depth_m: float = 0.35,
    max_depth_m: float = 6.0,
    fps: int = 30,
    frame_callback: Optional[Callable[[np.ndarray], None]] = None,
    task_mode: str = "gait",   # "gait" or "sts"
) -> Dict[str, Any]:
    """
    Coordinate note (RealSense deprojection):
      X: right, Y: down, Z: forward (away from camera).

    task_mode:
      - "gait": walking / gait metrics + stability + optional STS
      - "sts": sit-to-stand focused capture using relative vertical signal
    """

    global _stop_flag
    _stop_flag = False

    if task_mode not in ("gait", "sts"):
        raise ValueError("task_mode must be 'gait' or 'sts'")

    pipeline = rs.pipeline()
    config = rs.config()
    config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, fps)
    config.enable_stream(rs.stream.depth, 640, 480, rs.format.z16, fps)

    profile = pipeline.start(config)
    align = rs.align(rs.stream.color)

    color_stream = profile.get_stream(rs.stream.color).as_video_stream_profile()
    intr = color_stream.get_intrinsics()

    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    writer = None
    if export_overlay_video:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(overlay_out_path, fourcc, float(fps), (640, 480))

    start = time.time()
    frames_total = 0

    LH = mp_pose.PoseLandmark.LEFT_HIP
    LK = mp_pose.PoseLandmark.LEFT_KNEE
    LA = mp_pose.PoseLandmark.LEFT_ANKLE
    RH = mp_pose.PoseLandmark.RIGHT_HIP
    RK = mp_pose.PoseLandmark.RIGHT_KNEE
    RA = mp_pose.PoseLandmark.RIGHT_ANKLE
    LS = mp_pose.PoseLandmark.LEFT_SHOULDER
    RS = mp_pose.PoseLandmark.RIGHT_SHOULDER

    # Upper-body series
    t_u: List[float] = []
    pelvis_u: List[List[float]] = []
    shoulder_u: List[List[float]] = []

    # Gait series
    t_g: List[float] = []
    lk_deg: List[float] = []
    rk_deg: List[float] = []
    pelvis_g: List[List[float]] = []
    shoulder_g: List[List[float]] = []
    lank_g: List[List[float]] = []
    rank_g: List[List[float]] = []

    upper_ok = 0
    gait_ok = 0

    def pt3(idx, lm, w, h, depth_frame) -> Optional[np.ndarray]:
        px, py = landmark_to_pixel(lm[int(idx)], w, h)
        d = float(depth_frame.get_distance(px, py))
        if d <= 0.0 or d < min_depth_m or d > max_depth_m:
            return None
        return deproject(intr, px, py, d)

    try:
        while True:
            if _stop_flag:
                break
            if max_duration_s is not None and (time.time() - start) >= float(max_duration_s):
                break

            frames = pipeline.wait_for_frames()
            frames = align.process(frames)

            depth_frame = frames.get_depth_frame()
            color_frame = frames.get_color_frame()
            if not depth_frame or not color_frame:
                continue

            frame = np.asanyarray(color_frame.get_data())
            h, w = frame.shape[:2]
            frames_total += 1

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)

            overlay = frame.copy()
            if res.pose_landmarks:
                mp_draw.draw_landmarks(overlay, res.pose_landmarks, mp_pose.POSE_CONNECTIONS)

            lm_list = res.pose_landmarks.landmark if res.pose_landmarks else []
            gate_upper = gate_visibility(lm_list, res.pose_landmarks, [LH, RH, LS, RS], vis_thresh)
            gate_gait = gate_visibility(lm_list, res.pose_landmarks, [LH, LK, LA, RH, RK, RA, LS, RS], vis_thresh)

            midhip = None
            midsho = None
            Lhip = Rhip = Lsho = Rsho = None

            if res.pose_landmarks and gate_upper.ok:
                lm = res.pose_landmarks.landmark
                Lhip = pt3(LH, lm, w, h, depth_frame)
                Rhip = pt3(RH, lm, w, h, depth_frame)
                Lsho = pt3(LS, lm, w, h, depth_frame)
                Rsho = pt3(RS, lm, w, h, depth_frame)

                if all(p is not None for p in [Lhip, Rhip, Lsho, Rsho]):
                    midhip = 0.5 * (Lhip + Rhip)
                    midsho = 0.5 * (Lsho + Rsho)

            if midhip is not None and midsho is not None:
                upper_ok += 1
                t_now = time.time() - start
                t_u.append(float(t_now))
                pelvis_u.append(midhip.astype(float).tolist())
                shoulder_u.append(midsho.astype(float).tolist())

            if task_mode == "gait" and res.pose_landmarks and gate_gait.ok:
                lm = res.pose_landmarks.landmark

                Lhip2 = Lhip if Lhip is not None else pt3(LH, lm, w, h, depth_frame)
                Rhip2 = Rhip if Rhip is not None else pt3(RH, lm, w, h, depth_frame)
                Lsho2 = Lsho if Lsho is not None else pt3(LS, lm, w, h, depth_frame)
                Rsho2 = Rsho if Rsho is not None else pt3(RS, lm, w, h, depth_frame)

                Lknee = pt3(LK, lm, w, h, depth_frame)
                Rknee = pt3(RK, lm, w, h, depth_frame)
                Lank = pt3(LA, lm, w, h, depth_frame)
                Rank = pt3(RA, lm, w, h, depth_frame)

                if all(p is not None for p in [Lhip2, Rhip2, Lsho2, Rsho2, Lknee, Rknee, Lank, Rank]):
                    gait_ok += 1
                    midhip2 = 0.5 * (Lhip2 + Rhip2)
                    midsho2 = 0.5 * (Lsho2 + Rsho2)

                    left_deg = angle3d(Lhip2, Lknee, Lank)
                    right_deg = angle3d(Rhip2, Rknee, Rank)

                    t_now = time.time() - start
                    t_g.append(float(t_now))
                    lk_deg.append(float(left_deg))
                    rk_deg.append(float(right_deg))
                    pelvis_g.append(midhip2.astype(float).tolist())
                    shoulder_g.append(midsho2.astype(float).tolist())
                    lank_g.append(Lank.astype(float).tolist())
                    rank_g.append(Rank.astype(float).tolist())

                    cv2.putText(
                        overlay, f"L knee: {left_deg:.1f} deg", (10, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2
                    )
                    cv2.putText(
                        overlay, f"R knee: {right_deg:.1f} deg", (10, 55),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2
                    )

            cv2.putText(
                overlay, f"Upper OK frames: {upper_ok}", (10, 85),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2
            )
            cv2.putText(
                overlay, f"Gait OK frames:  {gait_ok}", (10, 110),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2
            )

            if task_mode == "gait":
                prompt_text = "Walk as prompted. Press 'q' to stop."
            else:
                prompt_text = "Sit, then stand once. Press 'q' to stop."

            cv2.putText(
                overlay, prompt_text, (10, 140),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2
            )

            if frame_callback is not None:
                try:
                    frame_callback(overlay)
                except Exception:
                    pass

            if writer is not None:
                writer.write(overlay)

            if show_window:
                cv2.imshow("RealSense Capture (MediaPipe Overlay)", overlay)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

    finally:
        pose.close()
        pipeline.stop()
        if writer is not None:
            writer.release()
        if show_window:
            cv2.destroyAllWindows()

    if len(t_u) < 20:
        raise RuntimeError(
            "Not enough valid upper-body frames. "
            "Try better lighting, full torso in frame, stand 1.5–3m away, and keep shoulders/hips visible."
        )

    # Upper-body arrays
    tU = np.array(t_u, dtype=float)
    pelvisU = np.array(pelvis_u, dtype=float)
    shoulderU = np.array(shoulder_u, dtype=float)

    fps_est = float(len(tU) / max(tU[-1] - tU[0], 1e-6))

    # ----------------------------
    # STABILITY FROM PELVIS MOTION
    # ----------------------------
    # Use pelvis motion in horizontal plane and split into AP / ML RMS.
    stability = _compute_planar_stability_metrics(pelvisU, prefer_axis=None)

    # For backward compatibility with your terminal print script:
    # treat ML RMS as the main "sway RMS"
    trunk_sway_rms_m = stability["stability_ml_rms_m"]
    trunk_sway_peak2peak_m = None
    if len(stability["stability_ml_series_m"]) > 0:
        ml_arr = np.array(stability["stability_ml_series_m"], dtype=float)
        trunk_sway_peak2peak_m = float(np.max(ml_arr) - np.min(ml_arr))

    # ---------------------------------------
    # SIT-TO-STAND USING RELATIVE VERTICAL Y
    # ---------------------------------------
    y_rel = (pelvisU[:, 1] - shoulderU[:, 1])
    y_rel_sm = moving_average(y_rel, int(max(7, 0.3 * fps_est)))

    print("DEBUG y_rel_sm range (cm):", 100.0 * float(np.max(y_rel_sm) - np.min(y_rel_sm)))

    sts_detected, sts_time_s, sts_start_idx, sts_end_idx = _compute_sts_from_yrel(tU, y_rel_sm, fps_est)

    # ----------------------------
    # GAIT METRICS (if gait mode)
    # ----------------------------
    gait_available = (task_mode == "gait") and (len(t_g) >= 20)

    if gait_available:
        tG = np.array(t_g, dtype=float)
        pelvisG = np.array(pelvis_g, dtype=float)
        shoulderG = np.array(shoulder_g, dtype=float)
        lankG = np.array(lank_g, dtype=float)
        rankG = np.array(rank_g, dtype=float)
        lk_arr = np.array(lk_deg, dtype=float)
        rk_arr = np.array(rk_deg, dtype=float)

        lk_sm = moving_average(lk_arr, 5)
        rk_sm = moving_average(rk_arr, 5)

        dp = np.vstack([np.zeros((1, 3)), np.diff(pelvisG, axis=0)])
        dt = np.maximum(robust_diff(tG), 1e-3)
        speed_3d = np.linalg.norm(dp, axis=1) / dt
        speed_3d_sm = moving_average(speed_3d, 7)

        moving = speed_3d_sm > max(0.05, np.percentile(speed_3d_sm, 30) * 0.5)
        mean_speed_mps = float(np.mean(speed_3d_sm[moving])) if np.any(moving) else float(np.mean(speed_3d_sm))

        forward_axis_g = _horizontal_pca_axis(pelvisG)
        if forward_axis_g is not None:
            v = dp / dt[:, None]
            forward_speed = np.dot(v, forward_axis_g)
            forward_speed_sm = moving_average(forward_speed, 7)
            mean_forward_speed_mps = (
                float(np.mean(np.abs(forward_speed_sm[moving])))
                if np.any(moving)
                else float(np.mean(np.abs(forward_speed_sm)))
            )
        else:
            mean_forward_speed_mps = None

        lift_L = -lankG[:, 1]
        lift_R = -rankG[:, 1]
        lift_L_sm = moving_average(lift_L, 7)
        lift_R_sm = moving_average(lift_R, 7)

        fps_g = float(len(tG) / max(tG[-1] - tG[0], 1e-6))
        min_sep = int(max(6, 0.25 * fps_g))

        if (not np.any(moving)) or (mean_speed_mps < 0.10) or (int(np.sum(moving)) < 10):
            peaks_L, peaks_R = [], []
        else:
            Lm = lift_L_sm[moving]
            Rm = lift_R_sm[moving]

            base_L = float(np.median(Lm))
            base_R = float(np.median(Rm))
            std_L = float(np.std(Lm)) + 1e-8
            std_R = float(np.std(Rm)) + 1e-8

            k = 1.7
            min_prom = 0.012

            thr_L = base_L + k * std_L
            thr_R = base_R + k * std_R

            peaks_L_all = _find_peaks_1d(lift_L_sm, thr_L, min_sep, min_prom=min_prom)
            peaks_R_all = _find_peaks_1d(lift_R_sm, thr_R, min_sep, min_prom=min_prom)

            peaks_L = [i for i in peaks_L_all if moving[i]]
            peaks_R = [i for i in peaks_R_all if moving[i]]

        num_steps = int(len(peaks_L) + len(peaks_R))
        duration_s = float(tG[-1] - tG[0]) if len(tG) > 1 else float(tG[-1])
        cadence_spm = float((num_steps / max(duration_s, 1e-6)) * 60.0)

        def _mean_step_interval(times_idx: List[int], t_arr: np.ndarray) -> Optional[float]:
            if len(times_idx) < 3:
                return None
            tt = t_arr[np.array(times_idx, dtype=int)]
            d = np.diff(tt)
            if len(d) < 2:
                return None
            return float(np.mean(d))

        mean_L_step_s = _mean_step_interval(peaks_L, tG)
        mean_R_step_s = _mean_step_interval(peaks_R, tG)

        step_time_si = None
        if mean_L_step_s is not None and mean_R_step_s is not None:
            step_time_si = float(symmetry_index(mean_L_step_s, mean_R_step_s))

        mean_l = float(np.mean(lk_sm))
        mean_r = float(np.mean(rk_sm))
        knee_sym_deg = float(abs(mean_l - mean_r))
        knee_si = float(symmetry_index(mean_l, mean_r))

    else:
        duration_s = float(tU[-1] - tU[0]) if len(tU) > 1 else float(tU[-1])
        mean_speed_mps = None
        mean_forward_speed_mps = None
        cadence_spm = 0.0
        num_steps = 0
        mean_l = mean_r = knee_sym_deg = knee_si = None
        mean_L_step_s = mean_R_step_s = step_time_si = None
        lk_sm = rk_sm = None
        peaks_L = peaks_R = []

    quality_upper = float(upper_ok / max(frames_total, 1))
    quality_gait = float(gait_ok / max(frames_total, 1))

    def summary_text() -> str:
        notes = []

        ap_rms = stability["stability_ap_rms_m"]
        ml_rms = stability["stability_ml_rms_m"]

        if ap_rms is not None or ml_rms is not None:
            stability_note_parts = []
            if ap_rms is not None:
                stability_note_parts.append(f"AP RMS={100.0 * ap_rms:.1f} cm")
            if ml_rms is not None:
                stability_note_parts.append(f"ML RMS={100.0 * ml_rms:.1f} cm")
            notes.append("Stability: " + ", ".join(stability_note_parts))

        if gait_available and knee_si is not None:
            notes.append("Knee symmetry within expected range" if knee_si < 10 else "Noticeable knee asymmetry")

        if sts_detected:
            notes.append("Sit-to-stand detected")

        return "; ".join(notes) if notes else "OK"

    result = {
        "task_mode": task_mode,
        "duration_s": float(duration_s),

        "frames_total": int(frames_total),
        "upper_ok_frames": int(upper_ok),
        "gait_ok_frames": int(gait_ok),

        "tracking_quality_upper_ok_fraction": float(quality_upper),
        "tracking_quality_gait_ok_fraction": float(quality_gait),

        "mean_speed_mps": float(mean_speed_mps) if mean_speed_mps is not None else None,
        "mean_forward_speed_mps": float(mean_forward_speed_mps) if mean_forward_speed_mps is not None else None,

        "cadence_spm": float(cadence_spm),
        "num_steps_est": int(num_steps),

        "mean_left_knee_deg": float(mean_l) if mean_l is not None else None,
        "mean_right_knee_deg": float(mean_r) if mean_r is not None else None,
        "knee_symmetry_deg": float(knee_sym_deg) if knee_sym_deg is not None else None,
        "knee_symmetry_index_percent": float(knee_si) if knee_si is not None else None,

        "mean_left_step_interval_s": float(mean_L_step_s) if mean_L_step_s is not None else None,
        "mean_right_step_interval_s": float(mean_R_step_s) if mean_R_step_s is not None else None,
        "step_time_symmetry_index_percent": float(step_time_si) if step_time_si is not None else None,

        # New stability metrics
        "stability_ap_rms_m": stability["stability_ap_rms_m"],
        "stability_ml_rms_m": stability["stability_ml_rms_m"],
        "stability_planar_rms_m": stability["stability_planar_rms_m"],

        # Backward-compatible names
        "trunk_sway_rms_m": float(trunk_sway_rms_m) if trunk_sway_rms_m is not None else None,
        "trunk_sway_peak2peak_m": float(trunk_sway_peak2peak_m) if trunk_sway_peak2peak_m is not None else None,

        "sit_to_stand_detected": bool(sts_detected),
        "sit_to_stand_time_s": float(sts_time_s) if sts_time_s is not None else None,

        "summary_text": summary_text(),

        "timeseries": {
            "t_upper_s": [float(x) for x in tU.tolist()],
            "pelvis_upper_xyz_m": [[float(a), float(b), float(c)] for a, b, c in pelvisU.tolist()],
            "shoulder_upper_xyz_m": [[float(a), float(b), float(c)] for a, b, c in shoulderU.tolist()],
            "pelvis_minus_shoulder_y_m": [float(x) for x in y_rel_sm.tolist()],
            "stability_ap_series_m": stability["stability_ap_series_m"],
            "stability_ml_series_m": stability["stability_ml_series_m"],
            "stability_axis_ap_xyz": stability["stability_axis_ap_xyz"],
            "stability_axis_ml_xyz": stability["stability_axis_ml_xyz"],
            "sts_start_idx": int(sts_start_idx) if sts_start_idx is not None else None,
            "sts_end_idx": int(sts_end_idx) if sts_end_idx is not None else None,
        },
    }

    if gait_available and lk_sm is not None and rk_sm is not None:
        result["timeseries"].update({
            "t_gait_s": [float(x) for x in np.array(t_g, dtype=float).tolist()],
            "left_knee_deg": [float(x) for x in lk_sm.tolist()],
            "right_knee_deg": [float(x) for x in rk_sm.tolist()],
            "gait_speed_mps": [float(x) for x in speed_3d_sm.tolist()],
            "left_step_peak_idx": [int(i) for i in peaks_L],
            "right_step_peak_idx": [int(i) for i in peaks_R],
        })

    return result