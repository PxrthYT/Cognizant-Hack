"""Run a YOLO model on the live webcam (or one image) and draw boxes.

  python tools/live_detect.py                          # webcam and debris checkpoint from config.yaml
  python tools/live_detect.py --weights models/pretrain.pt --conf 0.25
  python tools/live_detect.py --image some.jpg --save out.jpg
Press q to quit.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import torch
from ultralytics import YOLO

from street_cleaner.camera import Camera
from street_cleaner.config import ROOT, load_config


def pick_device():
    if torch.cuda.is_available():
        return 0
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights")
    ap.add_argument("--conf", type=float)
    ap.add_argument("--image")
    ap.add_argument("--save")
    args = ap.parse_args()

    cfg = load_config()
    conf = args.conf if args.conf is not None else cfg["detector"]["confidence"]
    model = YOLO(args.weights or str(ROOT / cfg["detector"]["model_path"]))
    device = pick_device()

    if args.image:
        res = model.predict(args.image, conf=conf, device=device, verbose=False)[0]
        print(f"{len(res.boxes)} detections:",
              [(res.names[int(b.cls)], round(float(b.conf), 2)) for b in res.boxes])
        if args.save:
            cv2.imwrite(args.save, res.plot())
        return

    cam = Camera(cfg["camera"])
    fps, n, t0 = 0.0, 0, time.time()
    while True:
        frame = cam.read()
        if frame is None:
            print("No frame from camera")
            break
        res = model.predict(frame, conf=conf, device=device, verbose=False)[0]
        out = res.plot()
        n += 1
        if n % 10 == 0:
            fps, t0 = 10 / (time.time() - t0), time.time()
        cv2.putText(out, f"{len(res.boxes)} det  {fps:.1f} FPS  conf>={conf}",
                    (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow("live_detect (q to quit)", out)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
