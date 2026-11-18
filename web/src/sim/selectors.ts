// Everything the UI shows is derived here from one SimState, so numbers always agree.
import type { Sim } from "./engine";
import { fmtT } from "./engine";
import { intervalTotal } from "./geo";
import type { EnforcementCase, Robot, RobotStatus, SegmentStatus, SimState } from "./types";

export const ACTIVE_STATUSES: RobotStatus[] = ["cleaning", "navigating", "returning", "blocked"];

export interface Kpis {
  activeRobots: number;
  totalRobots: number;
  availability: number;
  streetsCleaned: number;
  streetsScheduled: number;
  segmentsRemaining: number;
  coverage: number;            // cleaned metres / scheduled metres
  cleanedKm: number;
  scheduledKm: number;
  wasteKg: number;
  activeAlerts: number;
  criticalAlerts: number;
  pendingReviews: number;
  eta: number | null;          // estimated completion of today's schedule
  latestWindowEnd: number;
  online: number;
  blockedSegments: number;
}

export function caseVisible(s: SimState, c: EnforcementCase) {
  return c.stages[4] !== null && s.t >= c.stages[4]!;
}

export function kpis(sim: Sim, filter?: (r: Robot) => boolean): Kpis {
  const s = sim.s;
  const robots = s.robotOrder.map((id) => s.robots[id]).filter((r) => !filter || filter(r));
  const ids = new Set(robots.map((r) => r.id));
  const segs = s.segmentOrder.map((id) => s.segments[id]).filter((g) => ids.has(g.robotId) && g.scheduled);
  const scheduledM = segs.reduce((a, g) => a + g.length, 0);
  const cleanedM = segs.reduce((a, g) => a + Math.min(g.length, intervalTotal(g.cleaned)), 0);
  const cleaned = segs.filter((g) => sim.segmentStatus(g) === "cleaned").length;
  const open = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.resolvedAt === null && ids.has(a.robotId));
  const etas = robots.map((r) => sim.robotEta(r)).filter((x): x is number => x !== null);
  return {
    activeRobots: robots.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
    totalRobots: robots.length,
    availability: robots.length ? robots.filter((r) => r.status !== "maintenance" && r.status !== "offline").length / robots.length : 0,
    streetsCleaned: cleaned,
    streetsScheduled: segs.length,
    segmentsRemaining: segs.length - cleaned,
    coverage: scheduledM ? cleanedM / scheduledM : 0,
    cleanedKm: cleanedM / 1000,
    scheduledKm: scheduledM / 1000,
    wasteKg: robots.reduce((a, r) => a + r.wasteTodayKg, 0),
    activeAlerts: open.length,
    criticalAlerts: open.filter((a) => a.severity === "critical").length,
    pendingReviews: s.caseOrder.filter((c) => s.cases[c].status === "awaiting_review" && caseVisible(s, s.cases[c])).length,
    eta: etas.length ? Math.max(...etas) : null,
    latestWindowEnd: Math.max(...segs.map((g) => g.window.end), 0),
    online: robots.filter((r) => r.status !== "offline").length,
    blockedSegments: segs.filter((g) => sim.segmentStatus(g) === "blocked").length,
  };
}

export const STATUS_LABEL: Record<RobotStatus, string> = {
  cleaning: "Cleaning",
  navigating: "Navigating",
  idle: "Idle",
  charging: "Charging",
  returning: "Returning to station",
  blocked: "Blocked",
  paused: "Paused",
  maintenance: "Maintenance required",
  offline: "Offline",
};

export const SEGMENT_LABEL: Record<SegmentStatus, string> = {
  cleaned: "Cleaned",
  cleaning: "Cleaning in progress",
  scheduled: "Scheduled",
  blocked: "Blocked / intervention",
  inactive: "Not scheduled today",
};

export const CASE_LABEL: Record<EnforcementCase["status"], string> = {
  awaiting_review: "Awaiting review",
  approved: "Approved - ready to route",
  forwarded: "Routed (simulated)",
  acknowledged: "Acknowledged (simulated)",
  rejected: "Rejected",
  insufficient_evidence: "Insufficient evidence",
  no_violation: "No violation - logged only",
};

export function robotLocation(sim: Sim, r: Robot): string {
  const s = sim.s;
  if (r.status === "offline") return `Last known near ${r.currentSegmentId ? s.segments[r.currentSegmentId].name : s.stations[r.stationId].name}`;
  if (r.currentSegmentId) return s.segments[r.currentSegmentId].name;
  if (r.route?.dest === "station") return `En route to ${s.stations[r.route.stationId ?? r.stationId].name}`;
  return s.stations[r.stationId].name;
}

export function robotRouteProgress(sim: Sim, r: Robot) {
  const s = sim.s;
  const mine = s.segmentOrder.map((id) => s.segments[id]).filter((g) => g.robotId === r.id && g.scheduled);
  const total = mine.reduce((a, g) => a + g.length, 0);
  const done = mine.reduce((a, g) => a + Math.min(g.length, intervalTotal(g.cleaned)), 0);
  return { total, done, pct: total ? done / total : 1, segments: mine };
}

export function staleSeconds(s: SimState, r: Robot) {
  return s.t - r.lastTelemetryAt;
}

export function fmtDayTime(t: number) {
  const day = Math.floor(t / 86400);
  if (day === 0) return `Today ${fmtT(t)}`;
  if (day === -1) return `Yesterday ${fmtT(t)}`;
  if (day === 1) return `Tomorrow ${fmtT(t)}`;
  const d = new Date();
  d.setDate(d.getDate() + day);
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtT(t)}`;
}

/** Simple explainable health score: 100 minus weighted penalties. Not a prediction. */
export function healthScore(r: Robot) {
  const T = r.telemetry;
  let s = 100;
  s -= Math.max(0, 90 - T.batteryHealth) * 1.0;
  s -= Math.max(0, T.brushWear - 60) * 0.8;
  s -= Math.max(0, T.motorTemp - 60) * 1.4;
  s -= Math.max(0, 95 - T.sensorHealth) * 0.8;
  s -= Math.max(0, 0.9 - T.localization) * 60;
  s -= r.faults.filter((f) => f.severity === "critical").length * 35;
  if (r.status === "offline") s -= 25;
  if (r.maintenanceFlag) s -= 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function healthColor(score: number) {
  return score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
}
