
#!/usr/bin/env python3
"""
Facial Feature Extraction from MediaPipe FaceMesh (long-format CSV)
===================================================================

Input schema (long format):
    frame, time_s, face, landmark, x, y, z

- One row per landmark per frame (and per face if multiple).
- 'landmark' is the MediaPipe index (0..467). Indices are fixed by MP spec.

Outputs:
- A per-(frame, face) feature table with geometric features:
  EAR (left/right), MAR, brow-eye distances, symmetry, roll, mouth sizes, etc.
- Optional temporal features (EMA, diffs, rolling stats) computed causally.

Usage:
    python facial_features_from_long_csv.py \
        --landmarks path/to/landmarks.csv \
        --out path/to/features.parquet \
        --fps 30 \
        --win_frames 15

Notes:
- This script auto-detects whether your mesh has 468 or 478 points.
- All geometry is computed after translation/scale/roll normalization.
- You can safely extend LANDMARKS below if you want more features.
"""

import argparse
import pandas as pd
import numpy as np
from typing import Dict, Tuple

# ---------------------------- Landmark indices ---------------------------- #
# MediaPipe FaceMesh canonical indices (468). We pick a stable subset for features.
# You can adjust these to your preferred set if desired.
LANDMARKS: Dict[str, int] = dict(
    # Eye corners
    R_eye_outer=33,   R_eye_inner=133,
    L_eye_outer=263,  L_eye_inner=362,
    # Eyelid points (for EAR)
    R_eye_top1=159,   R_eye_bot1=145,
    R_eye_top2=160,   R_eye_bot2=144,
    L_eye_top1=386,   L_eye_bot1=374,
    L_eye_top2=387,   L_eye_bot2=373,
    # Mouth
    mouth_left=61, mouth_right=291,
    mouth_up_in=13, mouth_down_in=14,
    # Brows (inner brow; useful for frown/surprise proxies)
    brow_L_inner=70,  brow_R_inner=300,
    # Nose base (ref if needed)
    nose_base=2,
)

def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))

def _angle(p1: np.ndarray, p2: np.ndarray) -> float:
    """Angle (radians) of p1->p2 vector vs +x axis."""
    v = p2 - p1
    return float(np.arctan2(v[1], v[0]))

def _rotate(points_xy: np.ndarray, theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    R = np.array([[c, -s],[s, c]], dtype=np.float64)
    return (R @ points_xy.T).T

def _pre_normalize(all_xy: np.ndarray) -> Tuple[np.ndarray, float, float]:
    """
    Translate to eye-midpoint origin, scale by inter-canthi distance, de-roll.
    Returns (xy_norm, roll_deg, D_scale)
    """
    idx = LANDMARKS
    # Eye centers from outer/inner
    Lc = 0.5 * (all_xy[idx['L_eye_outer']] + all_xy[idx['L_eye_inner']])
    Rc = 0.5 * (all_xy[idx['R_eye_outer']] + all_xy[idx['R_eye_inner']])
    mid = 0.5 * (Lc + Rc)
    xy = all_xy - mid  # translate
    D = np.linalg.norm(Rc - Lc) + 1e-8  # scale
    xy /= D
    theta = _angle(Lc, Rc)
    xy = _rotate(xy, -theta)  # de-roll
    roll_deg = np.degrees(theta)
    return xy, roll_deg, D

def _EAR(xy: np.ndarray, side: str) -> float:
    i = LANDMARKS
    if side == 'R':
        p1 = xy[i['R_eye_outer']]; p4 = xy[i['R_eye_inner']]
        t1 = xy[i['R_eye_top1']];  b1 = xy[i['R_eye_bot1']]
        t2 = xy[i['R_eye_top2']];  b2 = xy[i['R_eye_bot2']]
    else:
        p1 = xy[i['L_eye_outer']]; p4 = xy[i['L_eye_inner']]
        t1 = xy[i['L_eye_top1']];  b1 = xy[i['L_eye_bot1']]
        t2 = xy[i['L_eye_top2']];  b2 = xy[i['L_eye_bot2']]
    A = _dist(t1, b1)
    B = _dist(t2, b2)
    C = _dist(p1, p4)
    return (A + B) / (2.0 * C + 1e-8)

def _MAR(xy: np.ndarray) -> float:
    i = LANDMARKS
    left, right = xy[i['mouth_left']], xy[i['mouth_right']]
    top, bottom = xy[i['mouth_up_in']], xy[i['mouth_down_in']]
    return _dist(top, bottom) / (_dist(left, right) + 1e-8)

def _brow_eye_verticals(xy: np.ndarray) -> Tuple[float, float, float]:
    """Vertical distances: inner-brow to eye center, per side, and symmetry diff."""
    i = LANDMARKS
    # Use eye centers from corners in normalized coordinates
    Lc = 0.5 * (xy[i['L_eye_outer']] + xy[i['L_eye_inner']])
    Rc = 0.5 * (xy[i['R_eye_outer']] + xy[i['R_eye_inner']])
    # positive y is "down" in image coords; after normalization, we can use y directly
    browL_eyeL = float(xy[i['brow_L_inner'], 1] - Lc[1])
    browR_eyeR = float(xy[i['brow_R_inner'], 1] - Rc[1])
    brow_sym = float(browL_eyeL - browR_eyeR)
    return browL_eyeL, browR_eyeR, brow_sym

def _mouth_dims(xy: np.ndarray) -> Tuple[float, float]:
    i = LANDMARKS
    w = _dist(xy[i['mouth_left']], xy[i['mouth_right']])
    h = _dist(xy[i['mouth_up_in']], xy[i['mouth_down_in']])
    return w, h

def compute_features_for_group(group: pd.DataFrame) -> dict:
    """
    group: DataFrame for a single (frame, face), sorted by landmark
    Returns a dict of features.
    """
    # Build [N, 2] arrays; we only need x,y for geometry here
    xy = group[['x', 'y']].to_numpy(dtype=np.float64)
    # In case landmarks are not contiguous/complete, pad or index via landmark id
    lm_ids = group['landmark'].to_numpy()
    max_id = int(lm_ids.max())
    N = max(468, max_id+1)  # support 468/478
    all_xy = np.zeros((N, 2), dtype=np.float64)
    all_xy[lm_ids, :] = xy

    # Normalize & compute features
    xyN, roll_deg, D = _pre_normalize(all_xy.copy())
    EAR_R = _EAR(xyN, 'R')
    EAR_L = _EAR(xyN, 'L')
    MAR   = _MAR(xyN)
    mouth_w, mouth_h = _mouth_dims(xyN)
    browL_eyeL, browR_eyeR, brow_sym = _brow_eye_verticals(xyN)
    eye_sym = float( (0.5*(xyN[LANDMARKS['L_eye_outer']] + xyN[LANDMARKS['L_eye_inner']]))[1]
                   - (0.5*(xyN[LANDMARKS['R_eye_outer']] + xyN[LANDMARKS['R_eye_inner']]))[1] )

    # Package
    out = {
        'frame': int(group['frame'].iloc[0]),
        'time_s': float(group['time_s'].iloc[0]),
        'face': int(group['face'].iloc[0]),
        'roll_deg': float(roll_deg),
        'EAR_left': float(EAR_L),
        'EAR_right': float(EAR_R),
        'EAR_mean': float(0.5*(EAR_L+EAR_R)),
        'MAR': float(MAR),
        'mouth_w': float(mouth_w),
        'mouth_h': float(mouth_h),
        'browL_eyeL': float(browL_eyeL),
        'browR_eyeR': float(browR_eyeR),
        'brow_sym': float(brow_sym),
        'eye_sym': float(eye_sym),
    }
    return out

def add_temporal_features(df: pd.DataFrame, cols, win_frames: int = 15) -> pd.DataFrame:
    """
    Adds EMA, d1, d2, rolling mean/std/p95 per face stream.
    Causal windows (min_periods=1). Assumes regular frame cadence.
    """
    out = df.sort_values(['face','frame']).copy()
    for c in cols:
        out[f'{c}_ema'] = out.groupby('face')[c].transform(lambda s: s.ewm(alpha=0.3, adjust=False).mean())
        out[f'{c}_d1']  = out.groupby('face')[c].diff()
        out[f'{c}_d2']  = out.groupby('face')[f'{c}_d1'].diff()
        out[f'{c}_mean{win_frames}'] = out.groupby('face')[c].transform(lambda s: s.rolling(win_frames, min_periods=1).mean())
        out[f'{c}_std{win_frames}']  = out.groupby('face')[c].transform(lambda s: s.rolling(win_frames, min_periods=1).std()).fillna(0.0)
        out[f'{c}_p95{win_frames}']  = out.groupby('face')[c].transform(lambda s: s.rolling(win_frames, min_periods=1).quantile(0.95))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--landmarks", required=True, help="Path to long-format landmarks CSV")
    ap.add_argument("--out", required=True, help="Output features file (.parquet or .csv)")
    ap.add_argument("--win_frames", type=int, default=15, help="Rolling window in frames for temporal features")
    args = ap.parse_args()

    df = pd.read_csv(args.landmarks)
    # Keep only needed columns and ensure types
    need = ['frame','time_s','face','landmark','x','y','z']
    missing = [c for c in need if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in input: {missing}")
    df = df[need].copy()
    df[['frame','face','landmark']] = df[['frame','face','landmark']].astype(int)

    # Sort for stable grouping
    df = df.sort_values(['face','frame','landmark']).reset_index(drop=True)

    # Compute per-(frame,face) features
    feats = [compute_features_for_group(g) for _, g in df.groupby(['face','frame'], sort=True)]
    feat_df = pd.DataFrame(feats).sort_values(['face','frame']).reset_index(drop=True)

    # Add temporal features
    temporal_cols = ['EAR_left','EAR_right','EAR_mean','MAR','roll_deg','mouth_h','mouth_w','browL_eyeL','browR_eyeR','brow_sym']
    feat_df = add_temporal_features(feat_df, temporal_cols, win_frames=args.win_frames)

    # Save
    out_path = args.out
    if out_path.lower().endswith(".parquet"):
        feat_df.to_parquet(out_path, index=False)
    else:
        feat_df.to_csv(out_path, index=False)

    # Print a short summary
    print(f"Saved {len(feat_df)} rows -> {out_path}")
    print("Columns:", list(feat_df.columns)[:12], "... (+ more)")

if __name__ == "__main__":
    main()
