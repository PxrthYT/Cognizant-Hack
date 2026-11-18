// Time machine: snapshots of the shared simulation, one per simulated minute.
// Frames up to "now" are recorded from the live run (including operator actions);
// frames after "now" are a projection made by running a clone of the current state forward.
import { bayOf, dockStationOf, isDocked, Sim } from "./engine";
import { intervalTotal } from "./geo";
import { caseVisible } from "./selectors";
import type { Interval, LngLat, Mission, RobotStatus, SegmentStatus, SimEvent, SimState } from "./types";

export interface FrameRobot {
  pos: LngLat;
  status: RobotStatus;
  battery: number;
  heading: number;
  docked: boolean;
  stationId: string;
  bay?: number | null;
}

export interface FrameSegment {
  status: SegmentStatus;
  cleaned: Interval[];
  blocked: Interval[];
}

export interface Frame {
  t: number;
  projected: boolean;
  robots: FrameRobot[];
  segs: FrameSegment[];
  kpi: { coverage: number; cleanedKm: number; streetsCleaned: number; scheduled: number; wasteKg: number; active: number; openCases: number; openAlerts: number };
  stationOcc: Record<string, number>;
  missions?: Partial<Record<Mission["status"], number>>;
  obstructions?: { id: string; pos: LngLat; street: string }[];
}

export function captureFrame(sim: Sim, projected = false): Frame {
  const s = sim.s;
  const robots = s.robotOrder.map((id) => {
    const r = s.robots[id];
    return { pos: [r.pos[0], r.pos[1]] as LngLat, status: r.status, battery: Math.round(r.telemetry.battery * 10) / 10,
      heading: Math.round(r.heading), docked: isDocked(r), stationId: dockStationOf(r), bay: bayOf(r) };
  });
  let schedM = 0;
  let cleanM = 0;
  let cleanedCount = 0;
  let scheduled = 0;
  const segs = s.segmentOrder.map((id) => {
    const g = s.segments[id];
    const status = sim.segmentStatus(g);
    if (g.scheduled) {
      scheduled++;
      schedM += g.length;
      cleanM += Math.min(g.length, intervalTotal(g.cleaned));
      if (status === "cleaned") cleanedCount++;
    }
    return { status, cleaned: g.cleaned.map((iv) => ({ ...iv })), blocked: g.blocked.filter((b) => !b.resolved).map((b) => ({ from: b.from, to: b.to })) };
  });
  const stationOcc: Record<string, number> = {};
  for (const r of robots) {
    if (r.docked && r.bay !== null) stationOcc[r.stationId] = (stationOcc[r.stationId] ?? 0) + 1;
  }
  const missions: Frame["missions"] = {};
  for (const id of s.missionOrder) {
    const { status } = s.missions[id];
    missions[status] = (missions[status] ?? 0) + 1;
  }
  const obstructions = s.incidentOrder.map((id) => s.incidents[id])
    .filter((inc) => !inc.resolved)
    .map((inc) => ({ id: inc.id, pos: inc.pos, street: s.segments[inc.segmentId].name }));
  return {
    t: s.t, projected, robots, segs, stationOcc, missions, obstructions,
    kpi: {
      coverage: schedM ? cleanM / schedM : 0, cleanedKm: cleanM / 1000, streetsCleaned: cleanedCount, scheduled,
      wasteKg: s.robotOrder.reduce((a, id) => a + s.robots[id].wasteTodayKg, 0),
      active: robots.filter((r) => ["cleaning", "navigating", "returning", "blocked"].includes(r.status)).length,
      openCases: s.caseOrder.filter((id) => s.cases[id].status === "awaiting_review" && caseVisible(s, s.cases[id])).length,
      openAlerts: s.alertOrder.filter((a) => s.alerts[a].resolvedAt === null).length,
    },
  };
}

export class Recorder {
  frames: Frame[] = [];

  record(sim: Sim, immediate = false) {
    const minute = Math.floor(sim.s.t / 60) * 60;
    const last = this.frames[this.frames.length - 1];
    if (!immediate && last && last.t >= minute) return;
    const f = captureFrame(sim);
    if (!immediate) f.t = minute;
    if (last?.t === f.t) this.frames[this.frames.length - 1] = f;
    else this.frames.push(f);
  }

  clear() {
    this.frames = [];
  }

  toJSON(step = 2) {
    return this.frames.filter((f, i) => f.t % 60 !== 0 || i % step === 0 || i === this.frames.length - 1);
  }
}

export interface Projection {
  frames: Frame[];
  events: SimEvent[];
  builtAt: number;
}

/** Run a clone of the live state to the end of the day. Chunked so the UI stays responsive. */
export async function buildProjection(state: SimState, onProgress?: (p: number) => void): Promise<Projection> {
  const clone = new Sim(structuredClone(state));
  const start = clone.s.t;
  const end = clone.s.dayEnd;
  const frames: Frame[] = [];
  const firstEvent = clone.s.events.length ? clone.s.events[clone.s.events.length - 1].id : "";
  const stride = clone.s.robotOrder.length > 30 ? 120 : 60;
  while (clone.s.t < end) {
    const chunkEnd = Math.min(end, clone.s.t + 3600);
    while (clone.s.t < chunkEnd) {
      clone.advance(Math.min(stride, chunkEnd - clone.s.t));
      frames.push(captureFrame(clone, true));
    }
    onProgress?.((clone.s.t - start) / Math.max(1, end - start));
    await new Promise((r) => setTimeout(r, 0));
  }
  const idx = clone.s.events.findIndex((e) => e.id === firstEvent);
  return { frames, events: clone.s.events.slice(idx + 1), builtAt: start };
}

export function frameAt(frames: Frame[], t: number): Frame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  if (t <= frames[0].t) return frames[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}
