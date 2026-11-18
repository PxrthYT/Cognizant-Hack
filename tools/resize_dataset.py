"""Shrink every image in a YOLO dataset so its longest side is <= --max (default 640).

  python tools/resize_dataset.py                       # data/pretrain
  python tools/resize_dataset.py --root data/my --max 640

YOLO labels are normalized (0-1), so they stay valid; only images are rewritten.
Safe to re-run: images already small enough are skipped.
"""
import argparse
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(ROOT / "data" / "pretrain"))
    ap.add_argument("--max", type=int, default=640)
    args = ap.parse_args()

    root = Path(args.root)
    done = skipped = 0
    before = after = 0
    for p in list((root / "images").rglob("*.jpg")) + list((root / "images").rglob("*.png")):
        before += p.stat().st_size
        img = cv2.imread(str(p))
        if img is None:
            print("unreadable:", p)
            continue
        h, w = img.shape[:2]
        scale = args.max / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            done += 1
        else:
            skipped += 1
        after += p.stat().st_size
    print(f"resized {done}, already small {skipped}")
    print(f"size: {before / 1e6:.0f} MB -> {after / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
