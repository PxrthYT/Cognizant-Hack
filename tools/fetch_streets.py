"""Download street geometry from OpenStreetMap for the dashboard.

    python tools/fetch_streets.py

Writes street_cleaner/fleet/streets_osm.json: for every street in
street_cleaner/fleet/layout.py, its pieces ordered end to end, plus a depot
position for each station (the street point nearest the centre of its zone).
Data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from street_cleaner.fleet.layout import BBOX, CLIP_LON, HIGHWAY_TYPES, STATIONS, all_street_names  # noqa: E402

OUT = ROOT / "street_cleaner" / "fleet" / "streets_osm.json"
OVERPASS = "https://overpass-api.de/api/interpreter"


def query(names):
    s, w, n, e = BBOX
    pattern = "|".join(names)
    q = (f'[out:json][timeout:60];way["highway"]["name"~"^({pattern})$"]({s},{w},{n},{e});'
         f"out geom({s},{w},{n},{e});")
    body = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": "street-cleaner-dashboard/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def dist(a, b):
    """Metres between two (lon, lat) points (flat approximation, fine at street scale)."""
    dx = (b[0] - a[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (b[1] - a[1]) * 111320
    return math.hypot(dx, dy)


def length(path):
    return sum(dist(a, b) for a, b in zip(path, path[1:]))


def clip(path, lon_range):
    """Keep the parts of a path inside a longitude range; may split it in pieces."""
    lo, hi = lon_range
    pieces, cur = [], []
    for p in path:
        if lo <= p[0] <= hi:
            cur.append(p)
        else:
            if len(cur) > 1:
                pieces.append(cur)
            cur = []
    if len(cur) > 1:
        pieces.append(cur)
    return pieces


def order_pieces(pieces):
    """Chain pieces so a robot can drive them one after another with short hops."""
    pts = [p for piece in pieces for p in piece]
    # start from the piece endpoint furthest from the centre: one end of the street
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    best = max(range(len(pieces)), key=lambda i: max(dist(pieces[i][0], (cx, cy)), dist(pieces[i][-1], (cx, cy))))
    first = pieces[best]
    if dist(first[0], (cx, cy)) < dist(first[-1], (cx, cy)):
        first = first[::-1]
    ordered, rest = [first], [p for i, p in enumerate(pieces) if i != best]
    while rest:
        end = ordered[-1][-1]
        j = min(range(len(rest)), key=lambda i: min(dist(end, rest[i][0]), dist(end, rest[i][-1])))
        nxt = rest.pop(j)
        if dist(end, nxt[-1]) < dist(end, nxt[0]):
            nxt = nxt[::-1]
        ordered.append(nxt)
    return ordered


def main():
    names = all_street_names()
    print(f"Querying OpenStreetMap for {len(names)} streets...")
    data = query(names)
    raw = {}
    for el in data["elements"]:
        tags = el.get("tags", {})
        if tags.get("highway") not in HIGHWAY_TYPES:
            continue
        path = [(round(p["lon"], 6), round(p["lat"], 6)) for p in (el.get("geometry") or []) if p]
        if len(path) < 2:
            continue
        name = tags["name"]
        pieces = clip(path, CLIP_LON[name]) if name in CLIP_LON else [path]
        raw.setdefault(name, []).extend(p for p in pieces if length(p) > 10)

    missing = [n for n in names if not raw.get(n)]
    if missing:
        sys.exit(f"Not found in OSM inside the search window: {missing}")

    streets = {}
    for name in names:
        pieces = order_pieces(raw[name])
        streets[name] = {"pieces": pieces, "length_m": round(sum(length(p) for p in pieces))}
        print(f"  {name:22s} {len(pieces):2d} pieces {streets[name]['length_m']:5d} m")

    depots = {}
    for st in STATIONS:
        pts = [p for streets_ in st["robots"].values() for s in streets_ for piece in streets[s]["pieces"] for p in piece]
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        depots[st["id"]] = min(pts, key=lambda p: dist(p, c))

    OUT.write_text(json.dumps({
        "attribution": "Street geometry (c) OpenStreetMap contributors, ODbL",
        "osm_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
        "depots": depots,
        "streets": streets,
    }), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
