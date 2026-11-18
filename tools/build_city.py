"""Build the CIVIC web app's city data from OpenStreetMap.

    python tools/build_city.py              # fetch from Overpass and build
    python tools/build_city.py --cache roads.json   # reuse a saved Overpass response

Writes three files to web/src/data/:
  graph.json  road network (node coordinates + edges) used to route robots along real roads
  core.json   default demo: 3 stations, 9 robots, the 31 streets from street_cleaner/fleet/layout.py
  metro.json  scale preset: 20 stations, 100 robots, every named street segment on the peninsula

Each street segment is a path of graph nodes, so robots drive the real road geometry.
Station positions are graph nodes near the centre of their zone (fictional depots).
Data (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import heapq
import json
import math
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from street_cleaner.fleet.layout import CLIP_LON, STATIONS  # noqa: E402

OUT = ROOT / "web" / "src" / "data"
BBOX = (44.618, -63.612, 44.662, -63.562)
ROAD_TYPES = "primary|secondary|tertiary|residential|unclassified|living_street|primary_link|secondary_link|tertiary_link"


def fetch():
    s, w, n, e = BBOX
    q = f'[out:json][timeout:120];way["highway"~"^({ROAD_TYPES})$"]({s},{w},{n},{e});out body geom;'
    req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": "civic-street-cleaning-demo/0.1"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def dist(a, b):
    dx = (b[0] - a[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (b[1] - a[1]) * 111320
    return math.hypot(dx, dy)


class Graph:
    def __init__(self, data):
        self.coord = {}
        self.adj = defaultdict(dict)
        self.ways = []
        for el in data["elements"]:
            nodes, geom = el.get("nodes"), el.get("geometry")
            if not nodes or not geom or len(nodes) != len(geom):
                continue
            for nid, g in zip(nodes, geom):
                if g:
                    self.coord[nid] = (round(g["lon"], 6), round(g["lat"], 6))
            pairs = [(a, b) for a, b in zip(nodes, nodes[1:]) if a in self.coord and b in self.coord]
            for a, b in pairs:
                d = dist(self.coord[a], self.coord[b])
                self.adj[a][b] = d
                self.adj[b][a] = d
            self.ways.append({"name": el.get("tags", {}).get("name"), "nodes": nodes,
                              "highway": el.get("tags", {}).get("highway")})

    def dijkstra(self, src, allowed=None):
        best, prev, pq = {src: 0.0}, {}, [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > best.get(u, 1e18):
                continue
            for v, w in self.adj[u].items():
                if allowed is not None and v not in allowed:
                    continue
                nd = d + w
                if nd < best.get(v, 1e18):
                    best[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        return best, prev

    def largest_component(self):
        seen, best = set(), []
        for n in self.coord:
            if n in seen or not self.adj[n]:
                continue
            comp, stack = [], [n]
            seen.add(n)
            while stack:
                u = stack.pop()
                comp.append(u)
                for v in self.adj[u]:
                    if v not in seen:
                        seen.add(v)
                        stack.append(v)
            if len(comp) > len(best):
                best = comp
        return set(best)


def street_paths(g, name, keep, lon_range=None):
    """Longest drivable path(s) along one named street, one per connected piece."""
    nodes = set()
    for w in g.ways:
        if w["name"] == name:
            nodes.update(n for n in w["nodes"] if n in keep)
    if lon_range:
        lo, hi = lon_range
        nodes = {n for n in nodes if lo <= g.coord[n][0] <= hi}
    paths, left = [], set(nodes)
    while left:
        start = next(iter(left))
        best, _ = g.dijkstra(start, allowed=nodes)
        comp = set(best)
        left -= comp
        if len(comp) < 2:
            continue
        a = max(best, key=best.get)                 # tree-diameter trick: farthest from any node,
        best_a, _ = g.dijkstra(a, allowed=comp)     # then farthest from that one
        b = max(best_a, key=best_a.get)
        _, prev = g.dijkstra(b, allowed=comp)
        path, u = [a], a
        while u != b:
            u = prev[u]
            path.append(u)
        paths.append(path)
    return paths


def path_len(g, path):
    return sum(dist(g.coord[a], g.coord[b]) for a, b in zip(path, path[1:]))


def split_path(g, path, max_len):
    out, cur, acc = [], [path[0]], 0.0
    for a, b in zip(path, path[1:]):
        cur.append(b)
        acc += dist(g.coord[a], g.coord[b])
        if acc >= max_len:
            out.append(cur)
            cur, acc = [b], 0.0
    if len(cur) > 1:
        if out and acc < max_len * 0.35:
            out[-1].extend(cur[1:])
        else:
            out.append(cur)
    return out


def nearest_node(g, pt, candidates):
    return min(candidates, key=lambda n: dist(g.coord[n], pt))


def centroid(g, nodes):
    pts = [g.coord[n] for n in nodes]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def build_core(g, keep):
    stations, robots, segments = [], [], []
    names = {"ST-W": ("ST-01", "Oxford Depot", "West District"),
             "ST-C": ("ST-02", "Studley Depot", "Central District"),
             "ST-E": ("ST-03", "South Park Depot", "South District")}
    r_no = 0
    for st in STATIONS:
        sid, sname, district = names[st["id"]]
        zone_nodes = []
        for _old_rid, streets in st["robots"].items():
            r_no += 1
            rid = f"R-{r_no:03d}"
            seg_ids = []
            for street in streets:
                paths = street_paths(g, street, keep, CLIP_LON.get(street))
                path = max(paths, key=lambda p: path_len(g, p))
                parts = split_path(g, path, 780) if path_len(g, path) > 1150 else [path]
                for i, part in enumerate(parts):
                    sgid = f"SEG-{len(segments) + 1:03d}"
                    label = street if len(parts) == 1 else f"{street} ({'west' if i == 0 else 'east'})"                         if abs(g.coord[path[0]][0] - g.coord[path[-1]][0]) > abs(g.coord[path[0]][1] - g.coord[path[-1]][1])                         else f"{street} ({'north' if i == 0 else 'south'})"
                    segments.append({"id": sgid, "name": label, "street": street, "nodes": part, "robot": rid,
                                     "station": sid, "district": district})
                    seg_ids.append(sgid)
                    zone_nodes.extend(part)
            robots.append({"id": rid, "station": sid, "segments": seg_ids})
        c = centroid(g, zone_nodes)
        stations.append({"id": sid, "name": sname, "district": district,
                         "node": nearest_node(g, c, zone_nodes), "bays": 4})
    return {"name": "Halifax · South End", "stations": stations, "robots": robots, "segments": segments}


def kmeans(points, k, iters=30):
    pts = sorted(points)
    centers = [pts[int(i * (len(pts) - 1) / (k - 1))] for i in range(k)]
    for _ in range(iters):
        groups = [[] for _ in range(k)]
        for p in points:
            groups[min(range(k), key=lambda i: dist(p, centers[i]))].append(p)
        centers = [(sum(p[0] for p in gr) / len(gr), sum(p[1] for p in gr) / len(gr)) if gr else centers[i]
                   for i, gr in enumerate(groups)]
    return centers


def build_metro(g, keep, n_stations=20, robots_per=5):
    named = sorted({w["name"] for w in g.ways if w["name"] and w["highway"] not in ("primary_link", "secondary_link")})
    raw = []
    for name in named:
        for path in street_paths(g, name, keep):
            if path_len(g, path) < 80:
                continue
            for i, piece in enumerate(split_path(g, path, 420)):
                if path_len(g, piece) >= 60:
                    raw.append((name, piece))
    cents = [centroid(g, p) for _, p in raw]
    centers = kmeans(cents, n_stations)
    groups = defaultdict(list)
    for (name, piece), c in zip(raw, cents):
        groups[min(range(n_stations), key=lambda i: dist(c, centers[i]))].append((name, piece, c))
    stations, robots, segments = [], [], []
    r_no = 0
    for si in sorted(groups, key=lambda i: (-centers[i][1], centers[i][0])):
        members = groups[si]
        sid = f"ST-{len(stations) + 1:02d}"
        all_nodes = [n for _, p, _ in members for n in p]
        node = nearest_node(g, centers[si], all_nodes)
        hub = g.coord[node]
        members.sort(key=lambda m: math.atan2(m[2][1] - hub[1], m[2][0] - hub[0]))
        per = max(1, math.ceil(len(members) / robots_per))
        district = f"District {len(stations) + 1:02d}"
        for k in range(robots_per):
            chunk = members[k * per:(k + 1) * per]
            r_no += 1
            rid = f"R-{r_no:03d}"
            seg_ids = []
            for name, piece, _ in chunk:
                sgid = f"SEG-{len(segments) + 1:04d}"
                segments.append({"id": sgid, "name": name, "street": name, "nodes": piece, "robot": rid, "station": sid,
                                 "district": district})
                seg_ids.append(sgid)
            robots.append({"id": rid, "station": sid, "segments": seg_ids})
        stations.append({"id": sid, "name": f"Depot {len(stations) + 1:02d}", "district": district,
                         "node": node, "bays": 6})
    return {"name": "Halifax · Peninsula (scale preset)", "stations": stations, "robots": robots, "segments": segments}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    args = ap.parse_args()
    data = json.loads(Path(args.cache).read_text(encoding="utf-8")) if args.cache else fetch()
    g = Graph(data)
    keep = g.largest_component()

    core = build_core(g, keep)
    metro = build_metro(g, keep)

    used = set(keep)  # routing needs the whole connected network
    index = {n: i for i, n in enumerate(sorted(used))}
    coords = [list(g.coord[n]) for n in sorted(used)]
    edges = sorted({(min(index[a], index[b]), max(index[a], index[b]))
                    for a in used for b in g.adj[a] if b in used})

    def remap(ds):
        for s in ds["segments"]:
            s["nodes"] = [index[n] for n in s["nodes"]]
            s["length_m"] = round(sum(dist(coords[a], coords[b]) for a, b in zip(s["nodes"], s["nodes"][1:])), 1)
        for st in ds["stations"]:
            st["node"] = index[st["node"]]
        return ds

    OUT.mkdir(parents=True, exist_ok=True)
    attribution = "Street network (c) OpenStreetMap contributors, ODbL"
    (OUT / "graph.json").write_text(json.dumps({"attribution": attribution, "coords": coords,
                                                "edges": [list(e) for e in edges]},
                                               separators=(",", ":")), encoding="utf-8")
    for fname, ds in (("core.json", remap(core)), ("metro.json", remap(metro))):
        ds["attribution"] = attribution
        (OUT / fname).write_text(json.dumps(ds, separators=(",", ":")), encoding="utf-8")
        lens = [s["length_m"] for s in ds["segments"]]
        print(f"{fname}: {len(ds['stations'])} stations, {len(ds['robots'])} robots, {len(lens)} segments, "
              f"{sum(lens) / 1000:.1f} km, segment {min(lens):.0f}-{max(lens):.0f} m")
    print(f"graph.json: {len(coords)} nodes, {len(edges)} edges")


if __name__ == "__main__":
    main()
