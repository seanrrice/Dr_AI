from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

@dataclass
class VisitManifest:
    schema_version: str
    visit_id: str
    patient_id: str
    visit_label: Optional[str]
    created_utc: str
    phases: str
    expected_subsystems: list[str]
    status: dict

def utc_iso() -> str:
    # ISO-ish without external deps
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs_dir", default="runs", help="Base runs directory (default:runs)")
    ap.add_argument("--visit_id", required=True)
    ap.add_argument("--patient_id", required=True)
    ap.add_argument("--visit_label", default=None)
    args = ap.parse_args()

    runs_dir = Path(args.runs_dir)
    visit_dir = runs_dir / f"visit_{args.visit_id}"
    visit_dir.mkdir(parents=True, exist_ok=True)

    manifest = VisitManifest(
        schema_version = "v0.1",
        visit_id = args.visit_id,
        patient_id = args.patient_id,
        visit_label = args.visit_label,
        created_utc = utc_iso(),
        phases = {
            "entry": {"t_start": None, "t_end": None},
            "encounter": {"t_start": None, "t_end": None},
        },
        expected_subsystems = ["gait", "face", "audio"],
        status = {"face": "pending", "audio": "missing", "gait": "missing"},
    )

    manifest_path = visit_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(asdict(manifest), f, indent=2)

    print(f"[OK] Created visit folder: {visit_dir}")
    print(f"[OK] Wrote manifest: {manifest_path}")


if __name__ == "__main__":
    main()
    