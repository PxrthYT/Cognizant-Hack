"""Webcam wrapper: index switching, backend choice, simple reconnect."""
import sys

import cv2


def _backend(name: str):
    name = (name or "auto").lower()
    if name == "dshow":
        return cv2.CAP_DSHOW
    if name == "avfoundation":
        return cv2.CAP_AVFOUNDATION
    if sys.platform.startswith("win"):
        return cv2.CAP_DSHOW
    if sys.platform == "darwin":
        return cv2.CAP_AVFOUNDATION
    return cv2.CAP_ANY


class Camera:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.cap = None
        self.open()

    def open(self):
        if self.cap is not None:
            self.cap.release()
        c = self.cfg
        self.cap = cv2.VideoCapture(int(c["index"]), _backend(c.get("backend")))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, c.get("width", 640))
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, c.get("height", 480))
        self.cap.set(cv2.CAP_PROP_FPS, c.get("fps", 30))

    def read(self):
        """Return a BGR frame, or None. Tries one reconnect on failure."""
        ok, frame = self.cap.read()
        if not ok:
            self.open()
            ok, frame = self.cap.read()
        return frame if ok else None

    def release(self):
        if self.cap is not None:
            self.cap.release()


def list_cameras(max_index: int = 6, backend: str = "auto"):
    """Return [(index, (w, h))] for indices that deliver a frame."""
    found = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, _backend(backend))
        ok, frame = cap.read() if cap.isOpened() else (False, None)
        cap.release()
        if ok:
            found.append((i, (frame.shape[1], frame.shape[0])))
    return found
