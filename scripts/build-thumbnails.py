#!/usr/bin/env python3
"""Build the small square thumbnails the UI actually requests.

The photographs on Wikimedia Commons are full-size files: 1280 px wide and
300-400 KB each, with 85 MB of them in the repository. The search list shows
forty of them at once and asks for a 44 px square, so serving the originals
means downloading ten megabytes to draw a column of postage stamps.

Cloudinary does this job in production — `c_fill,w_160,g_auto` is exactly
what `landmarkThumb` asks for — but the cloud is not always configured, and a
local fallback that quietly serves 400 KB files is a poor one. This script
produces the same crops locally with Pillow, into a parallel tree:

    public/assets/landmarks/<folder>/<name>.jpg      original
    public/assets/landmarks-thumb/<folder>/<name>.jpg  160 px square

`landmarkThumb` prefers the thumb tree and falls back to the original if a
thumb is missing, so the two can drift apart without breaking the app.

Run it after adding or replacing photographs:

    python scripts/build-thumbnails.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "public" / "assets" / "landmarks"
DST_DIR = ROOT / "public" / "assets" / "landmarks-thumb"

THUMB_SIZE = 160
QUALITY = 80

# Landmarks are usually photographed from below, so the building sits in the
# upper half of the frame. "Context" shots are wide street views where that is
# still true; the rest are close-ups where the centre is the subject.
CONTEXT_CENTRING = (0.5, 0.35)
DEFAULT_CENTRING = (0.5, 0.5)


def context_angles(manifest_path: Path) -> dict[str, set[str]]:
    """Map each photograph folder to the files shot as context shots."""
    import json

    if not manifest_path.exists():
        return {}
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    out: dict[str, set[str]] = {}
    for slug, entry in (data.get("landmarks") or {}).items():
        for image in entry.get("images") or []:
            if image.get("angle") == "context":
                out.setdefault(slug, set()).add(image["file"])
    return out


def main() -> int:
    if not SRC_DIR.exists():
        print(f"no photographs at {SRC_DIR}", file=sys.stderr)
        return 1

    context = context_angles(SRC_DIR / "manifest.json")

    total = 0
    written = 0
    before = 0
    after = 0

    for folder in sorted(p for p in SRC_DIR.iterdir() if p.is_dir()):
        dst_folder = DST_DIR / folder.name
        for image_path in sorted(folder.iterdir()):
            if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            total += 1
            before += image_path.stat().st_size

            dst_path = dst_folder / image_path.name
            dst_folder.mkdir(parents=True, exist_ok=True)

            try:
                with Image.open(image_path) as source:
                    source = source.convert("RGB")
                    is_context = image_path.name in context.get(folder.name, ())
                    centring = CONTEXT_CENTRING if is_context else DEFAULT_CENTRING
                    thumb = ImageOps.fit(
                        source,
                        (THUMB_SIZE, THUMB_SIZE),
                        method=Image.Resampling.LANCZOS,
                        centering=centring,
                    )
                    thumb.save(dst_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            except Exception as exc:  # noqa: BLE001 - report and carry on
                print(f"  skipped {image_path.name}: {exc}", file=sys.stderr)
                continue

            written += 1
            after += dst_path.stat().st_size

    if not total:
        print("no photographs found", file=sys.stderr)
        return 1

    print(
        f"{written}/{total} thumbnails at {THUMB_SIZE}px -> {DST_DIR.relative_to(ROOT)}\n"
        f"  originals {before / 1048576:.1f} MB  ->  thumbs {after / 1048576:.1f} MB "
        f"({after / max(before, 1) * 100:.1f}% of the original)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
