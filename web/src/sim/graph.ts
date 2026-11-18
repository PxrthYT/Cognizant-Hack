import type { LngLat } from "./types";
import { dist } from "./geo";

/** Road network from OpenStreetMap. Robots route along it between depots and streets. */
export class RoadGraph {
  coords: LngLat[];
  adj: { to: number; w: number }[][];

  constructor(coords: LngLat[], edges: [number, number][]) {
    this.coords = coords;
    this.adj = coords.map(() => []);
    for (const [a, b] of edges) {
      const w = dist(coords[a], coords[b]);
      this.adj[a].push({ to: b, w });
      this.adj[b].push({ to: a, w });
    }
  }

  nearest(p: LngLat, candidates?: number[]): number {
    let best = -1;
    let bd = Infinity;
    const list = candidates ?? this.coords.map((_, i) => i);
    for (const i of list) {
      const d = dist(p, this.coords[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Shortest path between two nodes (A* with straight-line heuristic). Returns node ids. */
  path(src: number, dst: number): number[] {
    if (src === dst) return [src];
    const n = this.coords.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const target = this.coords[dst];
    const heap: [number, number][] = [];
    const push = (f: number, v: number) => {
      heap.push([f, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    g[src] = 0;
    push(dist(this.coords[src], target), src);
    while (heap.length) {
      const [, u] = pop();
      if (closed[u]) continue;
      if (u === dst) break;
      closed[u] = 1;
      for (const { to, w } of this.adj[u]) {
        const nd = g[u] + w;
        if (nd < g[to]) {
          g[to] = nd;
          prev[to] = u;
          push(nd + dist(this.coords[to], target), to);
        }
      }
    }
    if (prev[dst] === -1) return [src, dst];
    const out = [dst];
    let u = dst;
    while (u !== src) {
      u = prev[u];
      out.push(u);
    }
    return out.reverse();
  }

  pathCoords(nodes: number[]): LngLat[] {
    return nodes.map((i) => this.coords[i]);
  }
}
