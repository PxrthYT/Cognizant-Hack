"""Fine-tune YOLO on a dataset.yaml.

  python tools/train.py --epochs 3                       # quick GPU test on TACO
  python tools/train.py --data data/my/dataset.yaml --weights models/pretrain.pt --epochs 60
Best weights are copied to models/<name>.pt
"""
import argparse
import shutil
from pathlib import Path

import torch
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent


def pick_device(requested: str):
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return 0
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data" / "pretrain" / "dataset.yaml"))
    ap.add_argument("--weights", default="yolo11n.pt")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--name", default="pretrain")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    device = pick_device(args.device)
    if device == 0:
        print("Training on GPU:", torch.cuda.get_device_name(0))
    else:
        print("Training on:", device)

    model = YOLO(args.weights)
    model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        device=device, project=str(ROOT / "runs"), name=args.name, exist_ok=True,
        cache="ram", workers=args.workers,  # set 0 if Windows multiprocessing errors appear
    )
    best = ROOT / "runs" / args.name / "weights" / "best.pt"
    if best.exists():
        (ROOT / "models").mkdir(exist_ok=True)
        shutil.copy(best, ROOT / "models" / f"{args.name}.pt")
        print("Saved", ROOT / "models" / f"{args.name}.pt")


if __name__ == "__main__":
    main()
