from pathlib import Path
import json


def update_manifest_status(visit_dir: Path, subsystem: str, status: str) -> None:
    manifest_path = visit_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"[WARN] No manifest.json found in {visit_dir}")
        return

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        manifest.setdefault("status", {})
        manifest["status"][subsystem] = status

        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        print(f"[OK] Updated manifest status: {subsystem} -> {status}")
    except Exception as e:
        print(f"[WARN] Failed to update manifest status: {e}")

