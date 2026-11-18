"""Serve webcam frame detections to CIVIC over loopback."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
from pathlib import Path
import sys
from threading import Lock
from time import perf_counter

import cv2
import numpy as np
from ultralytics import YOLO

from live_detect import pick_device
from street_cleaner.agent.steering import recommend_steering
from street_cleaner.config import load_config


ROOT = Path(__file__).resolve().parents[1]
MAX_FRAME_BYTES = 1024 * 1024
DEFAULT_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("127.0.0.1", "localhost")
    for port in (5199, 4173)
}
OBSTACLES = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "dog", "cat", "bench", "chair", "suitcase", "backpack", "potted plant",
}


class Detector:
    def __init__(self, debris_weights, object_weights, device, debris_conf):
        self.models = [
            ("debris", YOLO(str(debris_weights)), debris_conf),
            ("object", YOLO(str(object_weights)), 0.4),
        ]
        self.device = device
        self.lock = Lock()

    def detect(self, frame):
        detections = []
        for category, model, threshold in self.models:
            result = model.predict(frame, imgsz=640, conf=threshold, max_det=24,
                                   device=self.device, verbose=False)[0]
            if result.boxes is None:
                continue
            coords = result.boxes.xyxyn.cpu().tolist()
            scores = result.boxes.conf.cpu().tolist()
            classes = result.boxes.cls.cpu().tolist()
            for (x1, y1, x2, y2), confidence, class_id in zip(coords, scores, classes):
                label = result.names[int(class_id)]
                kind = "obstacle" if category == "object" and label in OBSTACLES else category
                detections.append({
                    "label": label.replace("_", " "),
                    "kind": kind,
                    "confidence": round(confidence, 3),
                    "x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1,
                })
        return detections


def serve(port, origins, detector, regions):
    class Handler(BaseHTTPRequestHandler):
        def end_headers(self):
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def respond(self, status, payload):
            body = json.dumps(payload).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def allowed(self):
            origin = self.headers.get("Origin")
            if origin is None or origin in origins:
                return True
            self.respond(403, {"error": "This dashboard origin is not allowed by the vision bridge."})
            return False

        def do_OPTIONS(self):
            if self.path != "/detect":
                return self.respond(404, {"error": "Endpoint not found."})
            if not self.allowed():
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            if self.path != "/health":
                return self.respond(404, {"error": "Endpoint not found."})
            if self.allowed():
                self.respond(200, {"status": "ready"})

        def do_POST(self):
            if self.path != "/detect":
                return self.respond(404, {"error": "Endpoint not found."})
            if not self.allowed():
                return
            if self.headers.get_content_type() != "image/jpeg":
                return self.respond(415, {"error": "Send a JPEG frame."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 0 < size <= MAX_FRAME_BYTES:
                return self.respond(413, {"error": "Frame must be between 1 byte and 1 MB."})

            self.connection.settimeout(4)
            try:
                data = self.rfile.read(size)
                frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR) if data else None
            except (OSError, cv2.error):
                frame = None
            if frame is None or frame.size == 0 or frame.shape[0] * frame.shape[1] > 1280 * 720:
                return self.respond(400, {"error": "Invalid JPEG or frame dimensions."})
            if not detector.lock.acquire(blocking=False):
                return self.respond(429, {"error": "Detector busy. Retrying…"})
            try:
                start = perf_counter()
                detections = detector.detect(frame)
                elapsed = round((perf_counter() - start) * 1000)
            except Exception:
                logging.exception("Frame inference failed")
                return self.respond(500, {"error": "Frame inference failed. Check the vision bridge terminal."})
            finally:
                detector.lock.release()
            self.respond(200, {
                "detections": detections,
                "inferenceMs": elapsed,
                "guidance": recommend_steering(detections, regions),
            })

        def log_message(self, format, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"CIVIC vision bridge ready at http://127.0.0.1:{port}", flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", action="append", default=[], help="Additional dashboard origin to allow")
    parser.add_argument("--debris-weights", type=Path, default=ROOT / "models" / "pretrain.pt")
    parser.add_argument("--object-weights", type=Path, default=ROOT / "yolo11n.pt")
    parser.add_argument("--debris-confidence", type=float, default=0.25)
    parser.add_argument("--device", default="auto", help="auto, cpu, mps, or a CUDA device index")
    args = parser.parse_args()
    for path in (args.debris_weights, args.object_weights):
        if not path.is_file():
            parser.error(f"Missing model checkpoint: {path}")
    if not 0 < args.debris_confidence <= 1:
        parser.error("--debris-confidence must be between 0 and 1")

    device = pick_device() if args.device == "auto" else args.device
    print(f"Loading debris and general object models on {device}…", flush=True)
    detector = Detector(args.debris_weights, args.object_weights, device, args.debris_confidence)
    detector.detect(np.zeros((360, 640, 3), dtype=np.uint8))
    try:
        serve(args.port, DEFAULT_ORIGINS.union(args.origin), detector, load_config()["regions"])
    except KeyboardInterrupt:
        return
    except OSError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
