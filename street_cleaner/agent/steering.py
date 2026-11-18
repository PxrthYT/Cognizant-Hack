"""Pure steering logic: detections in -> (decision, reason). No camera, no model.

Detections are (x1, y1, x2, y2, label, conf) in pixels. Regions come from config.yaml.
The agent's state machine will reuse this, so what you see in the capture overlay
is exactly what the robot will be told.
"""


def steer(detections, width, height, regions):
    if not detections:
        return "SEARCH", "nothing visible: slow spin to look for debris"

    # Chase the closest piece of debris (lowest on screen = nearest the vacuum).
    x1, y1, x2, y2, label, conf = max(detections, key=lambda d: d[3])
    cx = (x1 + x2) / 2 / width
    bottom = y2 / height
    where = f"{label} {conf:.2f} at x={cx:.2f}, bottom={bottom:.2f}"

    if bottom >= regions["close_y"] and regions["left_max"] <= cx <= regions["right_min"]:
        return "CLEAN", f"{where}: under the vacuum, hold position"
    if cx < regions["left_max"]:
        return "LEFT", f"{where}: debris on the left, turn left"
    if cx > regions["right_min"]:
        return "RIGHT", f"{where}: debris on the right, turn right"
    return "FORWARD", f"{where}: debris centred, drive forward"


def recommend_steering(detections, regions):
    """Recommend a manual action from normalized webcam detections."""
    left, right = regions["left_max"], regions["right_min"]
    sectors = {"left": (0, left), "center": (left, right), "right": (right, 1)}
    # The lower part of the image approximates the robot's approach area.
    near_y = regions.get("obstacle_y", 0.55)
    obstacles = [d for d in detections if d["kind"] == "obstacle" and d["y"] + d["h"] >= near_y]

    def covers(box, start, end):
        minimum_overlap = min(0.04, box["w"] / 2)
        return min(end, box["x"] + box["w"]) - max(start, box["x"]) >= minimum_overlap

    blockers = {
        name: [box for box in obstacles if covers(box, start, end)]
        for name, (start, end) in sectors.items()
    }
    blocked = [name for name, boxes in blockers.items() if boxes]

    def decision(action, reason):
        return {"action": action, "reason": reason, "blockedSectors": blocked}

    if blockers["center"]:
        if any(box["label"] == "person" for box in blockers["center"]):
            return decision("STOP", "A person is in the approach area.")
        obstacle = max(blockers["center"], key=lambda box: box["y"] + box["h"])
        label = obstacle["label"].capitalize()
        open_sides = [side for side in ("left", "right") if side not in blocked]
        if not open_sides:
            return decision("STOP", f"{label} ahead and both sides show obstacles.")
        if len(open_sides) == 1:
            turn = open_sides[0]
        else:
            turn = "left" if obstacle["x"] + obstacle["w"] / 2 > 0.5 else "right"
        return decision(turn.upper(), f"{label} ahead. The {turn} lane has no detected obstacle.")

    debris = [d for d in detections if d["kind"] == "debris"]
    if not debris:
        return decision("SCAN", "Hold position and scan for debris.")

    target = max(debris, key=lambda box: box["y"] + box["h"])
    x, y, w, h = (target[key] for key in ("x", "y", "w", "h"))
    label = target["label"].capitalize()
    action, _ = steer([(x, y, x + w, y + h, label, target["confidence"])], 1, 1, regions)
    target_sector = {"LEFT": "left", "RIGHT": "right"}.get(action, "center")
    if target_sector in blocked:
        return decision("STOP", f"An obstacle blocks the approach to {label.lower()} on the {target_sector}.")
    reason = {
        "LEFT": f"{label} is to the left.",
        "RIGHT": f"{label} is to the right.",
        "FORWARD": f"{label} is centered ahead.",
        "CLEAN": f"{label} is in the pickup area. Hold position.",
    }
    return decision(action, reason[action])
