"""Step 1 test: list cameras or preview one.

  python tools/check_camera.py --list
  python tools/check_camera.py            # preview camera from config.yaml
  python tools/check_camera.py --index 1  # override index
Press q to quit.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2

from street_cleaner.camera import Camera, list_cameras
from street_cleaner.config import load_config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="probe camera indices")
    ap.add_argument("--index", type=int, help="override camera index")
    args = ap.parse_args()

    cfg = load_config()
    cam_cfg = cfg["camera"]
    if args.index is not None:
        cam_cfg["index"] = args.index

    if args.list:
        cams = list_cameras(backend=cam_cfg.get("backend", "auto"))
        if not cams:
            print("No cameras found. Check the USB cable / camera permissions.")
        for i, (w, h) in cams:
            print(f"index {i}: {w}x{h}")
        return

    cam = Camera(cam_cfg)
    n, t0 = 0, time.time()
    fps = 0.0
    while True:
        frame = cam.read()
        if frame is None:
            print("No frame received (wrong index or camera busy?).")
            break
        n += 1
        if n % 15 == 0:
            fps = 15 / (time.time() - t0)
            t0 = time.time()
        h, w = frame.shape[:2]
        # draw left/centre/right guides and the 'close' line from config
        r = cfg["regions"]
        for x in (r["left_max"], r["right_min"]):
            cv2.line(frame, (int(x * w), 0), (int(x * w), h), (0, 255, 255), 1)
        cv2.line(frame, (0, int(r["close_y"] * h)), (w, int(r["close_y"] * h)), (0, 0, 255), 1)
        cv2.putText(frame, f"idx {cam_cfg['index']}  {w}x{h}  {fps:.1f} FPS",
                    (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow("check_camera (q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
