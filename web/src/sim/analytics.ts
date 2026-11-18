// Historical operations data. Past days are synthetic but generated from the same
// fleet, segments and schedules as the live simulation; today comes from the live state.
import type { Sim } from "./engine";
import { intervalTotal } from "./geo";
import { seeded } from "./rng";
import { caseVisible } from "./selectors";

export interface DayRecord {
  day: number;                 // 0 = today, -1 = yesterday ...
  date: string;                // YYYY-MM-DD
  robotId: string;
  stationId: string;
  district: string;
  scheduledKm: number;
  cleanedKm: number;
  distanceKm: number;
  wasteKg: number;
  segments: number;
  segmentsCleaned: number;
  segmentsOnTime: number;
  missions: Record<MissionKind, { total: number; completed: number }>;
  activeHours: number;
  availableHours: number;
  chargingHours: number;
  maintenanceIncidents: number;
  obstructions: number;
  enforcementCases: number;
  pendingReviews: number;
  minutesPerStreet: number;
  blockedSegments: string[];
  partial: boolean;            // today, still in progress
}

export type MissionKind = "routine" | "revisit" | "reassignment" | "operator";
const KINDS: MissionKind[] = ["routine", "revisit", "reassignment", "operator"];

function dateOf(day: number) {
  const d = new Date();
  d.setDate(d.getDate() + day);
  return d.toISOString().slice(0, 10);
}

const emptyMissions = () => Object.fromEntries(KINDS.map((k) => [k, { total: 0, completed: 0 }])) as DayRecord["missions"];

export function buildHistory(sim: Sim, days = 30): DayRecord[] {
  const s = sim.s;
  const R = seeded(s.seed * 31 + 7);
  const out: DayRecord[] = [];
  const robotSegs: Record<string, string[]> = {};
  for (const id of s.segmentOrder) (robotSegs[s.segments[id].robotId] ??= []).push(id);
  for (let day = -days; day < 0; day++) {
    const dow = new Date(dateOf(day)).getDay();
    const weekend = dow === 0;
    for (const rid of s.robotOrder) {
      const r = s.robots[rid];
      const segs = (robotSegs[rid] ?? []).map((id) => s.segments[id]).filter(() => !weekend && R.chance(0.82));
      const schedM = segs.reduce((a, g) => a + g.length, 0);
      const reliability = R.range(0.82, 1);
      const down = R.chance(0.04);
      const cleanedFrac = down ? R.range(0.2, 0.6) : Math.min(1, reliability + R.range(0, 0.1));
      const cleanedM = schedM * cleanedFrac;
      const obstructions = segs.length ? (R.chance(0.35) ? R.int(1, 2) : 0) : 0;
      const enf = obstructions ? R.int(0, obstructions) : 0;
      const segmentsCleaned = Math.round(segs.length * cleanedFrac);
      const missions = emptyMissions();
      if (segs.length) {
        missions.routine = { total: 1, completed: cleanedFrac > 0.97 && !obstructions ? 1 : 0 };
        if (obstructions) missions.revisit = { total: obstructions, completed: R.int(0, obstructions) };
        if (down || R.chance(0.08)) missions.reassignment = { total: 1, completed: R.chance(0.8) ? 1 : 0 };
      }
      const activeH = cleanedM / r.speedClean / 3600 + segs.length * 0.06;
      out.push({
        day, date: dateOf(day), robotId: rid, stationId: r.stationId, district: s.stations[r.stationId].district,
        scheduledKm: schedM / 1000, cleanedKm: cleanedM / 1000, distanceKm: (cleanedM / 1000) * R.range(1.25, 1.5),
        wasteKg: (cleanedM / 1000) * R.range(3.2, 6.4) * (dow === 1 ? 1.35 : 1),
        segments: segs.length, segmentsCleaned, segmentsOnTime: Math.max(0, segmentsCleaned - (R.chance(0.2) ? 1 : 0)),
        missions, activeHours: activeH, availableHours: weekend ? 0 : down ? R.range(4, 9) : 16,
        chargingHours: segs.length ? R.range(0.8, 2.2) : 0.3, maintenanceIncidents: down ? 1 : R.chance(0.05) ? 1 : 0,
        obstructions, enforcementCases: enf, pendingReviews: 0,
        minutesPerStreet: segs.length ? (activeH * 60) / Math.max(1, segs.length) : 0,
        blockedSegments: obstructions ? [R.pick(segs).name] : [], partial: false,
      });
    }
  }
  return out;
}

export function todayRecords(sim: Sim): DayRecord[] {
  const s = sim.s;
  return s.robotOrder.map((rid) => {
    const r = s.robots[rid];
    const segs = s.segmentOrder.map((id) => s.segments[id]).filter((g) => g.robotId === rid && g.scheduled);
    const missions = emptyMissions();
    for (const mid of s.missionOrder) {
      const m = s.missions[mid];
      if (m.robotId !== rid) continue;
      missions[m.kind].total++;
      if (m.status === "completed") missions[m.kind].completed++;
    }
    const incidents = s.incidentOrder.map((i) => s.incidents[i]).filter((i) => i.robotId === rid);
    const cleaned = segs.filter((g) => sim.segmentStatus(g) === "cleaned");
    const elapsedH = Math.max(0, (s.t - s.dayStart) / 3600);
    const chargingH = r.history.filter((h, i) => i > 0 && h.battery > r.history[i - 1].battery + 0.05).length / 60;
    return {
      day: 0, date: dateOf(0), robotId: rid, stationId: r.stationId, district: s.stations[r.stationId].district,
      scheduledKm: segs.reduce((a, g) => a + g.length, 0) / 1000,
      cleanedKm: segs.reduce((a, g) => a + Math.min(g.length, intervalTotal(g.cleaned)), 0) / 1000,
      distanceKm: r.distanceTodayM / 1000, wasteKg: r.wasteTodayKg, segments: segs.length,
      segmentsCleaned: cleaned.length,
      segmentsOnTime: cleaned.filter((g) => (g.cleanedAt ?? 0) <= g.window.end).length,
      missions, activeHours: r.operatingSecondsToday / 3600,
      availableHours: r.status === "maintenance" || r.status === "offline" ? Math.max(0, elapsedH - 1) : elapsedH,
      chargingHours: chargingH,
      maintenanceIncidents: s.alertOrder.filter((a) => s.alerts[a].robotId === rid && s.alerts[a].severity === "critical").length,
      obstructions: incidents.length,
      enforcementCases: incidents.filter((i) => i.caseId && s.cases[i.caseId].status !== "no_violation").length,
      pendingReviews: incidents.filter((i) => i.caseId && s.cases[i.caseId].status === "awaiting_review" && caseVisible(s, s.cases[i.caseId])).length,
      minutesPerStreet: cleaned.length
        ? cleaned.reduce((a, g) => a + ((g.cleanedAt ?? 0) - (g.cleaningStartedAt ?? 0)) / 60, 0) / cleaned.length : 0,
      blockedSegments: segs.filter((g) => g.blocked.some((b) => !b.resolved)).map((g) => g.name),
      partial: s.t < s.dayEnd,
    };
  });
}

export interface Filters {
  days: number;
  district: string;
  stationId: string;
  robotId: string;
  mission: MissionKind | "all";
}

export interface DaySummary {
  date: string;
  label: string;
  day: number;
  coverage: number;
  scheduledKm: number;
  cleanedKm: number;
  distanceKm: number;
  wasteKg: number;
  utilization: number;
  activeHours: number;
  missionRate: number;
  adherence: number;
  minutesPerStreet: number;
  chargingHours: number;
  maintenance: number;
  obstructions: number;
  enforcement: number;
  pending: number;
  partial: boolean;
}

export function summarize(records: DayRecord[], f: Filters): DaySummary[] {
  const rows = records.filter((r) => r.day > -f.days - 1 && r.day >= -f.days
    && (f.district === "all" || r.district === f.district)
    && (f.stationId === "all" || r.stationId === f.stationId)
    && (f.robotId === "all" || r.robotId === f.robotId));
  const byDay = new Map<number, DayRecord[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, rs]): DaySummary => {
    const sum = (k: keyof DayRecord) => rs.reduce((a, r) => a + (r[k] as number), 0);
    const kinds = f.mission === "all" ? KINDS : [f.mission];
    const mTot = rs.reduce((a, r) => a + kinds.reduce((b, k) => b + r.missions[k].total, 0), 0);
    const mDone = rs.reduce((a, r) => a + kinds.reduce((b, k) => b + r.missions[k].completed, 0), 0);
    const cleanedSegs = sum("segmentsCleaned");
    const d = new Date(rs[0].date);
    return {
      date: rs[0].date, day,
      label: day === 0 ? "Today" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      coverage: sum("scheduledKm") ? sum("cleanedKm") / sum("scheduledKm") : 0,
      scheduledKm: sum("scheduledKm"), cleanedKm: sum("cleanedKm"), distanceKm: sum("distanceKm"), wasteKg: sum("wasteKg"),
      utilization: sum("availableHours") ? sum("activeHours") / sum("availableHours") : 0, activeHours: sum("activeHours"),
      missionRate: mTot ? mDone / mTot : 0,
      adherence: cleanedSegs ? sum("segmentsOnTime") / cleanedSegs : 0,
      minutesPerStreet: cleanedSegs ? rs.reduce((a, r) => a + r.minutesPerStreet * r.segmentsCleaned, 0) / cleanedSegs : 0,
      chargingHours: sum("chargingHours"), maintenance: sum("maintenanceIncidents"), obstructions: sum("obstructions"),
      enforcement: sum("enforcementCases"), pending: sum("pendingReviews"), partial: rs.some((r) => r.partial),
    };
  });
}

export function toCsv(rows: DaySummary[]) {
  const cols: (keyof DaySummary)[] = ["date", "scheduledKm", "cleanedKm", "coverage", "distanceKm", "wasteKg", "utilization",
    "missionRate", "adherence", "minutesPerStreet", "chargingHours", "maintenance", "obstructions", "enforcement", "pending", "partial"];
  const fmt = (v: unknown) => (typeof v === "number" ? (Math.round(v * 1000) / 1000).toString() : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(","))].join("\n");
}

/** Planning assumption, not a measurement: crew-hours a manual crew would need for the same kilometres. */
export const ASSUMPTION_KM_PER_CREW_HOUR = 1.2;
