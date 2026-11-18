"""Download TACO (litter dataset) and convert it to YOLO format with OUR classes.

  python tools/get_taco.py              # everything (~1500 images, 640px thumbnails)
  python tools/get_taco.py --limit 50   # quick test

Output: data/pretrain/{images,labels}/{train,val}/  +  data/pretrain/dataset.yaml
Needs internet ONCE; afterwards everything is local.
TACO has no leaves or dust, so those classes stay empty here; they come from
your own webcam images later. Check TACO's license before redistributing.
"""
import argparse
import json
import random
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "taco_raw"
OUT = ROOT / "data" / "pretrain"
ANN_URL = "https://raw.githubusercontent.com/pedropro/TACO/master/data/annotations.json"

CLASSES = ["leaves", "paper_confetti", "dust_dirt", "other_litter"]
# TACO category ids -> our class index. Everything not listed -> other_litter.
PAPER_IDS = {30, 31, 32, 33, 34, 35}  # magazine/tissue/wrapping/normal paper, paper bags
SKIP_IDS = {58}  # 'Unlabeled litter' is too vague to learn from


def map_class(cat_id: int):
    if cat_id in SKIP_IDS:
        return None
    return 1 if cat_id in PAPER_IDS else 3


def download(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dest.write_bytes(r.read())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  failed {url}: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only first N images")
    ap.add_argument("--val", type=float, default=0.2, help="validation fraction")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    ann_path = RAW / "annotations.json"
    if not ann_path.exists():
        print("Downloading annotations...")
        download(ANN_URL, ann_path)
    data = json.loads(ann_path.read_text(encoding="utf-8"))

    boxes = {}
    for a in data["annotations"]:
        boxes.setdefault(a["image_id"], []).append(a)

    images = data["images"][: args.limit or None]
    print(f"Downloading {len(images)} images with {args.workers} workers...")

    def fetch(im):
        url = im.get("flickr_640_url") or im.get("flickr_url")
        dest = RAW / "images" / (str(im["id"]) + ".jpg")
        return im, dest, download(url, dest)

    with ThreadPoolExecutor(args.workers) as ex:
        results = list(ex.map(fetch, images))

    random.seed(0)
    kept = {"train": 0, "val": 0}
    counts = [0] * len(CLASSES)
    for im, src, ok in results:
        if not ok:
            continue
        lines = []
        W, H = im["width"], im["height"]
        for a in boxes.get(im["id"], []):
            c = map_class(a["category_id"])
            if c is None:
                continue
            x, y, w, h = a["bbox"]
            lines.append(f"{c} {(x + w / 2) / W:.6f} {(y + h / 2) / H:.6f} {w / W:.6f} {h / H:.6f}")
            counts[c] += 1
        if not lines:
            continue
        split = "val" if random.random() < args.val else "train"
        (OUT / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUT / "labels" / split).mkdir(parents=True, exist_ok=True)
        name = f"taco_{im['id']}"
        (OUT / "images" / split / f"{name}.jpg").write_bytes(src.read_bytes())
        (OUT / "labels" / split / f"{name}.txt").write_text("\n".join(lines), encoding="utf-8")
        kept[split] += 1

    (OUT / "dataset.yaml").write_text(
        f"path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\n"
        "names:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(CLASSES)),
        encoding="utf-8",
    )
    print(f"Done. train={kept['train']} val={kept['val']}")
    print("boxes per class:", dict(zip(CLASSES, counts)))
    print(f"Dataset config: {OUT / 'dataset.yaml'}")


if __name__ == "__main__":
    main()
