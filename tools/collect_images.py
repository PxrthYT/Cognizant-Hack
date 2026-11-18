"""Capture training images from the webcam, with an optional live decision overlay.

  python tools/collect_images.py                                  # capture only
  python tools/collect_images.py --weights models/pretrain.pt     # + live detections & decision
  python tools/collect_images.py --weights models/pretrain.pt --device cpu

Keys:  1 leaves   2 paper_confetti   3 dust_dirt   4 other_litter   0 empty_floor
       SPACE save one frame     b toggle burst (auto-save every --burst seconds)
       q quit
Images go to data/own/raw/<label>/<timestamp>.jpg  (clean frames, no overlay).
Capture at the REAL mast angle, and vary lighting, distance and debris amount.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2

from street_cleaner.agent.steering import steer
from street_cleaner.camera import Camera
from street_cleaner.config import ROOT, load_config

LABELS = {ord("0"): "empty_floor", ord("1"): "leaves", ord("2"): "paper_confetti",
          ord("3"): "dust_dirt", ord("4"): "other_litter"}
DECISION_COLORS = {"LEFT": (0, 165, 255), "RIGHT": (0, 165, 255), "FORWARD": (0, 255, 0),
                   "CLEAN": (255, 255, 0), "SEARCH": (0, 0, 255)}


def count_existing(out: Path):
    return {n: len(list((out / n).glob("*.jpg"))) for n in LABELS.values()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", help="optional YOLO weights for the live decision overlay")
    ap.add_argument("--device", default="auto", help="auto | cpu | 0 | mps")
    ap.add_argument("--conf", type=float)
    ap.add_argument("--burst", type=float, default=0.7, help="seconds between burst saves")
    ap.add_argument("--out", default=str(ROOT / "data" / "own" / "raw"))
    args = ap.parse_args()

    cfg = load_config()
    conf = args.conf if args.conf is not None else cfg["detector"]["confidence"]
    out = Path(args.out)
    for name in LABELS.values():
        (out / name).mkdir(parents=True, exist_ok=True)
    counts = count_existing(out)

    model, device = None, None
    if args.weights:
        import torch
        from ultralytics import YOLO
        model = YOLO(args.weights)
        device = args.device
        if device == "auto":
            device = 0 if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

    cam = Camera(cfg["camera"])
    regions = cfg["regions"]
    label, burst, last_burst, flash = "leaves", False, 0.0, 0.0

    def save(frame):
        name = f"{time.strftime('%Y%m%d_%H%M%S')}_{int(time.time() * 1000) % 1000:03d}.jpg"
        cv2.imwrite(str(out / label / name), frame)
        counts[label] += 1

    while True:
        frame = cam.read()
        if frame is None:
            print("No frame from camera")
            break
        clean = frame.copy()
        h, w = frame.shape[:2]

        dets = []
        if model is not None:
            res = model.predict(frame, conf=conf, device=device, verbose=False)[0]
            for b in res.boxes:
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                dets.append((x1, y1, x2, y2, res.names[int(b.cls)], float(b.conf)))
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                cv2.putText(frame, f"{res.names[int(b.cls)]} {float(b.conf):.2f}", (int(x1), max(15, int(y1) - 5)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        for x in (regions["left_max"], regions["right_min"]):
            cv2.line(frame, (int(x * w), 0), (int(x * w), h), (0, 255, 255), 1)
        cv2.line(frame, (0, int(regions["close_y"] * h)), (w, int(regions["close_y"] * h)), (0, 0, 255), 1)

        if model is not None:
            decision, reason = steer(dets, w, h, regions)
            cv2.rectangle(frame, (0, h - 54), (w, h), (0, 0, 0), -1)
            cv2.putText(frame, f"DECISION: {decision}", (10, h - 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                        DECISION_COLORS[decision], 2)
            cv2.putText(frame, reason[:80], (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        if burst and time.time() - last_burst >= args.burst:
            save(clean)
            last_burst, flash = time.time(), time.time()
        cv2.putText(frame, f"label: {label} ({counts[label]})  total: {sum(counts.values())}"
                           f"{'  BURST' if burst else ''}", (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 0, 255) if burst else (0, 255, 0), 2)
        if time.time() - flash < 0.15:
            cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (255, 255, 255), 6)
        cv2.imshow("collect_images (q quit, SPACE save, b burst)", frame)

        k = cv2.waitKey(1) & 0xFF
        if k == ord("q"):
            break
        if k in LABELS:
            label = LABELS[k]
        elif k == ord(" "):
            save(clean)
            flash = time.time()
        elif k == ord("b"):
            burst = not burst
    cam.release()
    cv2.destroyAllWindows()
    print("Saved per class:", counts)


if __name__ == "__main__":
    main()
