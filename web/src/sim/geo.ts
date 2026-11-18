import type { Interval, LngLat } from "./types";

const M_PER_DEG = 111320;

export function dist(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * M_PER_DEG * Math.cos((a[1] * Math.PI) / 180);
  const dy = (b[1] - a[1]) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

export function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function cumulative(coords: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  return cum;
}

/** Point at distance d along a polyline. `hint` speeds up sequential lookups. */
export function pointAt(coords: LngLat[], cum: number[], d: number, hint = 0): { p: LngLat; i: number; heading: number } {
  const L = cum[cum.length - 1];
  const x = Math.max(0, Math.min(d, L));
  let i = Math.max(0, Math.min(hint, cum.length - 2));
  if (cum[i] > x) i = 0;
  while (i < cum.length - 2 && cum[i + 1] < x) i++;
  const span = cum[i + 1] - cum[i];
  const f = span <= 0 ? 0 : (x - cum[i]) / span;
  const a = coords[i];
  const b = coords[i + 1];
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i, heading: bearing(a, b) };
}

/** Sub-polyline between distances a and b (a < b). */
export function slice(coords: LngLat[], cum: number[], a: number, b: number): LngLat[] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(cum[cum.length - 1], Math.max(a, b));
  if (hi - lo < 0.01) return [];
  const out: LngLat[] = [pointAt(coords, cum, lo).p];
  for (let i = 0; i < coords.length; i++) if (cum[i] > lo && cum[i] < hi) out.push(coords[i]);
  out.push(pointAt(coords, cum, hi).p);
  return out;
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .map((iv) => ({ from: Math.min(iv.from, iv.to), to: Math.max(iv.from, iv.to) }))
    .filter((iv) => iv.to - iv.from > 0.01)
    .sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.from <= last.to + 0.5) last.to = Math.max(last.to, iv.to);
    else out.push({ ...iv });
  }
  return out;
}

export function intervalTotal(list: Interval[]): number {
  return list.reduce((s, iv) => s + (iv.to - iv.from), 0);
}

/** Parts of [0, length] not covered by `cover`. */
export function gaps(cover: Interval[], length: number): Interval[] {
  const merged = mergeIntervals(cover);
  const out: Interval[] = [];
  let x = 0;
  for (const iv of merged) {
    if (iv.from > x + 0.5) out.push({ from: x, to: iv.from });
    x = Math.max(x, iv.to);
  }
  if (length - x > 0.5) out.push({ from: x, to: length });
  return out;
}

export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let result = mergeIntervals(a);
  for (const cut of mergeIntervals(b)) {
    const next: Interval[] = [];
    for (const iv of result) {
      if (cut.to <= iv.from || cut.from >= iv.to) next.push(iv);
      else {
        if (cut.from > iv.from) next.push({ from: iv.from, to: cut.from });
        if (cut.to < iv.to) next.push({ from: cut.to, to: iv.to });
      }
    }
    result = next;
  }
  return result;
}

export function convexHull(points: LngLat[]): LngLat[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LngLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Push hull vertices outward from the centroid by `pad` metres. */
export function padPolygon(poly: LngLat[], pad: number): LngLat[] {
  if (!poly.length) return poly;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map((p) => {
    const d = dist(p, [cx, cy]) || 1;
    const f = 1 + pad / d;
    return [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f] as LngLat;
  });
}
