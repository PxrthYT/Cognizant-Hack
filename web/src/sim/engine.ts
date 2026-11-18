import { graph } from "./dataset";
import { cumulative, dist, gaps, intervalTotal, mergeIntervals, pointAt, slice, subtract } from "./geo";
import { nextRandom } from "./rng";
import type {
  AlertRule, CleanTask, EnforcementCase, Incident, LngLat, MaintenanceAlert, Mission, ParkedVehicle,
  Recommendation, Robot, Route, SegmentStatus, SimEvent, SimState, StreetSegment,
} from "./types";

export const DEPARTMENT = "Municipal Parking Enforcement";
export const TRANSIT_SPEED = 1.4;            // m/s
const CHARGE_RATE = 100 / (50 * 60);         // % per second (empty to full in 50 min)
const BATTERY_PER_M = 0.021;                 // % per metre cleaned at 100% battery health
const BATTERY_TRANSIT_PER_S = 0.004;
const BIN_PER_M = 0.018;                     // % per metre at debris 0 (scaled by debris)
const BIN_KG_PER_PCT = 0.25;                 // 25 kg bin
const DOCKED: Robot["status"][] = ["idle", "charging", "maintenance"];
const LEAD = 3 * 60;                         // robots leave the depot this long before their window

export const fmtT = (t: number) => {
  const d = ((t % 86400) + 86400) % 86400;
  return `${String(Math.floor(d / 3600)).padStart(2, "0")}:${String(Math.floor((d % 3600) / 60)).padStart(2, "0")}`;
};

type DockInfo = { docked: boolean; bay: number | null; dockAt?: string; boost?: boolean };
/** Extra per-robot fields kept off the public type to keep it readable. */
type R = Robot & DockInfo;

export class Sim {
  s: SimState;

  constructor(state: SimState) {
    this.s = state;
    const occupied = new Map<string, Set<number>>();
    for (const r of Object.values(this.s.robots) as R[]) {
      if (r.docked === undefined) {
        r.docked = true;
        r.bay = null;
      }
      if (r.bay === null) continue;
      const st = this.station(r);
      const used = occupied.get(st.id) ?? new Set<number>();
      if (r.bay < 1 || r.bay > st.bays - st.baysOutOfService || used.has(r.bay)) {
        r.bay = null;
      } else {
        used.add(r.bay);
        occupied.set(st.id, used);
      }
    }
  }

  // ------------------------------------------------------------------ utils
  private rand() {
    return nextRandom(this.s);
  }

  nextId(prefix: string, width = 4) {
    const n = (this.s.counters[prefix] = (this.s.counters[prefix] ?? 0) + 1);
    return `${prefix}-${String(n).padStart(width, "0")}`;
  }

  emit(ev: Omit<SimEvent, "id" | "t">) {
    const e: SimEvent = { id: this.nextId("EV", 5), t: this.s.t, ...ev };
    this.s.events.push(e);
    if (this.s.events.length > 600) this.s.events.splice(0, this.s.events.length - 600);
    return e;
  }

  robot(id: string) {
    return this.s.robots[id] as R;
  }

  seg(id: string) {
    return this.s.segments[id];
  }

  station(r: Robot) {
    return this.s.stations[(r as R).dockAt ?? r.stationId];
  }

  // ------------------------------------------------------------------ time
  advance(seconds: number) {
    const end = this.s.t + seconds;
    while (this.s.t < end - 1e-6) this.step(Math.min(1, end - this.s.t));
  }

  /** Advance until `pred` is true (checked every sim second) or `max` seconds pass. */
  advanceUntil(pred: (s: SimState) => boolean, max: number) {
    const end = this.s.t + max;
    while (this.s.t < end && !pred(this.s)) this.step(1);
    return pred(this.s);
  }

  step(dt: number) {
    const s = this.s;
    const before = s.t;
    s.t += dt;
    for (const ev of s.scripted) if (!ev.done && s.t >= ev.at) this.runScripted(ev);
    for (const id of s.robotOrder) this.tickRobot(this.robot(id), dt);
    if (Math.floor(s.t / 5) !== Math.floor(before / 5)) this.evaluateRules();
    if (Math.floor(s.t / 30) !== Math.floor(before / 30)) this.evaluateDispatch();
    if (Math.floor(s.t / 60) !== Math.floor(before / 60)) this.minuteTick();
  }

  // ------------------------------------------------------------------ robots
  private tickRobot(r: R, dt: number) {
    const s = this.s;
    const T = r.telemetry;
    const linkDown = r.offlineUntil !== undefined && s.t < r.offlineUntil;
    T.connectivity = linkDown ? 0 : 91 + this.rand() * 7;
    if (r.status === "offline") return; // safe-stopped, no fresh telemetry

    const moving = r.status === "cleaning" || r.status === "navigating" || r.status === "returning";
    const hot = r.faults.some((f) => f.code === "BRUSH_MOTOR_OC");
    const loadTarget = r.status === "cleaning" ? 45 + this.seg(r.route!.segmentId!).debris * 35 + (hot ? 25 : 0)
      : moving ? 22 : 0;
    T.motorLoad += (loadTarget - T.motorLoad) * Math.min(1, 0.2 * dt);
    const tempTarget = 12 + T.motorLoad * 0.6 + (hot && r.status === "cleaning" ? 48 : 0);
    T.motorTemp += (tempTarget - T.motorTemp) * Math.min(1, 0.004 * dt);
    T.localization = Math.min(0.995, Math.max(0.5, T.localization + (0.97 - T.localization) * 0.05 + (this.rand() - 0.5) * 0.004));
    r.lastTelemetryAt = s.t;
    if (moving) r.operatingSecondsToday += dt;

    switch (r.status) {
      case "maintenance":
        if (r.docked && r.bay !== null) T.battery = Math.min(100, T.battery + CHARGE_RATE * dt);
        T.binFill = Math.max(0, T.binFill - 2 * dt);
        return;
      case "paused":
        return;
      case "blocked":
        if (r.holdUntil !== undefined && s.t >= r.holdUntil) {
          r.status = "cleaning";
          r.holdUntil = undefined;
          r.holdReason = undefined;
          this.emit({ kind: "obstruction", severity: "info", robotId: r.id, segmentId: r.currentSegmentId ?? undefined,
            message: `${r.id} bypassing the blocked section and continuing` });
        }
        return;
      case "idle":
      case "charging":
        if (r.docked) this.dockTick(r, dt);
        else this.fieldWaitTick(r);
        return;
      default:
        this.moveTick(r, dt);
    }
  }

  private occupiedBays(stationId: string) {
    const used = new Set<number>();
    for (const r of Object.values(this.s.robots) as R[]) {
      if (r.docked && r.bay !== null && this.station(r).id === stationId) used.add(r.bay);
    }
    return used;
  }

  private nextFreeBay(stationId: string) {
    const st = this.s.stations[stationId];
    const used = this.occupiedBays(stationId);
    for (let bay = 1; bay <= st.bays - st.baysOutOfService; bay++) {
      if (!used.has(bay)) return bay;
    }
    return null;
  }

  freeBays(stationId: string) {
    const st = this.s.stations[stationId];
    return st.bays - st.baysOutOfService - this.occupiedBays(stationId).size;
  }

  private dockTick(r: R, dt: number) {
    const s = this.s;
    const T = r.telemetry;
    const st = this.station(r);
    if (r.bay === null) {
      r.bay = this.nextFreeBay(st.id);
      r.holdReason = r.bay === null ? "Waiting for a free charging bay" : undefined;
    }
    const chargerOk = !(r.chargeFaultUntil && s.t < r.chargeFaultUntil);
    if (r.bay !== null) {
      if (!chargerOk) {
        r.status = "idle";
        r.holdReason = `Bay charger fault until ${fmtT(r.chargeFaultUntil!)}`;
      } else if (T.battery < 99.5) {
        T.battery = Math.min(100, T.battery + CHARGE_RATE * dt);
        r.status = "charging";
      } else r.status = "idle";
      T.binFill = Math.max(0, T.binFill - 2 * dt);
    }
    this.activateMissions(r);
    if (!r.queue.length) return;
    const lowBatteryReturn = (r.returnReason ?? "").toLowerCase().includes("battery");
    const need = lowBatteryReturn ? 90 : 35;
    const critical = r.faults.some((f) => f.severity === "critical");
    const nextSeg = this.seg(r.queue[0].segmentId);
    const windowOpen = s.t >= nextSeg.window.start - LEAD;
    if (T.battery >= need && T.binFill < 30 && !critical && !r.maintenanceFlag && windowOpen) {
      r.bay = null;
      r.docked = false;
      r.dockAt = undefined;
      r.returnReason = undefined;
      this.startNextTask(r);
    }
  }

  private fieldWaitTick(r: R) {
    const task = r.queue[0];
    if (!task) return this.returnToStation(r.id, "No remaining work");
    const seg = this.seg(task.segmentId);
    if (this.s.t >= seg.window.start) {
      r.holdReason = undefined;
      this.beginCleaning(r, task);
    }
  }

  private activateMissions(r: R) {
    const s = this.s;
    for (const mid of s.missionOrder) {
      const m = s.missions[mid];
      if (m.robotId !== r.id || m.status !== "scheduled") continue;
      if (s.t < m.window.start - LEAD || s.t >= m.window.end) continue;
      m.status = "active";
      const tasks = this.tasksFor(m);
      for (const tk of tasks) if (!r.queue.some((q) => q.segmentId === tk.segmentId && q.revisit === tk.revisit)) r.queue.push(tk);
      this.emit({ kind: "mission", severity: "info", robotId: r.id, missionId: m.id,
        message: `${m.name} activated · ${tasks.length} task${tasks.length === 1 ? "" : "s"}` });
      if (!tasks.length) {
        m.status = "completed";
        m.completedAt = s.t;
      }
    }
  }

  private tasksFor(m: Mission): CleanTask[] {
    const out: CleanTask[] = [];
    for (const sid of m.segmentIds) {
      const seg = this.seg(sid);
      if (seg.robotId !== m.robotId) continue;
      if (m.kind === "revisit") {
        for (const b of seg.blocked.filter((x) => !x.resolved)) {
          out.push({ segmentId: sid, from: Math.max(0, b.from - 3), to: Math.min(seg.length, b.to + 3), missionId: m.id, revisit: true });
        }
        continue;
      }
      const cover = mergeIntervals([...seg.cleaned, ...seg.blocked]);
      const open = gaps(cover, seg.length);
      if (!open.length || seg.cleanedAt !== null) continue;
      out.push({ segmentId: sid, from: open[0].from, to: open[open.length - 1].to, missionId: m.id });
    }
    return out;
  }

  private makeRoute(coords: LngLat[], kind: Route["kind"], dest: Route["dest"], extra: Partial<Route> = {}): Route {
    const clean: LngLat[] = [];
    for (const c of coords) {
      const last = clean[clean.length - 1];
      if (!last || dist(last, c) > 0.05) clean.push(c);
    }
    if (clean.length === 1) clean.push(clean[0]);
    const cum = cumulative(clean);
    return { kind, dest, coords: clean, cum, length: cum[cum.length - 1], progress: 0, cursor: 0, ...extra };
  }

  /** Road-following path between two points. */
  transitPath(from: LngLat, to: LngLat, fromCandidates?: number[], toCandidates?: number[]) {
    const a = graph.nearest(from, fromCandidates);
    const b = graph.nearest(to, toCandidates);
    return [from, ...graph.pathCoords(graph.path(a, b)), to];
  }

  private startNextTask(r: R) {
    while (r.queue.length) {
      const tk = r.queue[0];
      const seg = this.seg(tk.segmentId);
      if (seg.robotId !== r.id) {
        r.queue.shift();
        continue;
      }
      break;
    }
    const task = r.queue[0];
    if (!task) return this.returnToStation(r.id, "Route complete");
    const seg = this.seg(task.segmentId);
    if (!task.revisit && task.from === 0 && Math.abs(task.to - seg.length) < 0.01) {
      const a = pointAt(seg.coords, seg.cum, 0).p;
      const b = pointAt(seg.coords, seg.cum, seg.length).p;
      if (dist(r.pos, b) < dist(r.pos, a)) [task.from, task.to] = [task.to, task.from];
    }
    const start = pointAt(seg.coords, seg.cum, task.from).p;
    const fromCands = r.currentSegmentId ? this.seg(r.currentSegmentId).nodes : undefined;
    const path = this.transitPath(r.pos, start, fromCands, seg.nodes);
    r.route = this.makeRoute(path, "transit", "segment", { segmentId: seg.id });
    r.status = "navigating";
    r.currentSegmentId = seg.id;
    r.missionId = task.missionId;
    if (r.route.length < 2) this.arrive(r);
    else this.emit({ kind: "navigation", severity: "info", robotId: r.id, segmentId: seg.id,
      message: `${r.id} navigating to ${seg.name} (${(r.route.length / 1000).toFixed(1)} km)` });
  }

  private beginCleaning(r: R, task: CleanTask) {
    const s = this.s;
    const seg = this.seg(task.segmentId);
    if (task.revisit) {
      const present = s.parked.find((v) => v.segmentId === seg.id && s.t >= v.arrives && s.t < v.leaves
        && v.alongM >= Math.min(task.from, task.to) && v.alongM <= Math.max(task.from, task.to));
      if (present) {
        r.queue.shift();
        const mid = this.createRevisit(seg, r.id, s.t + 45 * 60, "Vehicle still present on first revisit");
        this.emit({ kind: "obstruction", severity: "warning", robotId: r.id, segmentId: seg.id, missionId: mid,
          message: `Vehicle still parked on ${seg.name}; revisit rescheduled for ${fmtT(s.t + 45 * 60)}` });
        return this.startNextTask(r);
      }
      for (const b of seg.blocked) {
        if (!b.resolved && b.to >= Math.min(task.from, task.to) && b.from <= Math.max(task.from, task.to)) {
          b.resolved = true;
          const inc = s.incidents[b.incidentId];
          if (inc) inc.resolved = true;
        }
      }
    }
    const lo = Math.min(task.from, task.to);
    const hi = Math.max(task.from, task.to);
    let coords = slice(seg.coords, seg.cum, lo, hi);
    if (task.from > task.to) coords = coords.reverse();
    r.route = this.makeRoute(coords, "clean", "segment", { segmentId: seg.id, segFrom: task.from, segTo: task.to });
    r.status = "cleaning";
    r.currentSegmentId = seg.id;
    r.missionId = task.missionId;
    r.holdReason = undefined;
    if (seg.cleaningStartedAt === null) seg.cleaningStartedAt = s.t;
    this.emit({ kind: "cleaning", severity: "info", robotId: r.id, segmentId: seg.id, missionId: task.missionId,
      message: `${r.id} ${task.revisit ? "revisiting" : "cleaning"} ${seg.name}` });
  }

  private segPos(route: Route, progress: number) {
    const dir = (route.segTo ?? 0) >= (route.segFrom ?? 0) ? 1 : -1;
    return (route.segFrom ?? 0) + dir * progress;
  }

  private moveTick(r: R, dt: number) {
    const s = this.s;
    const route = r.route;
    const T = r.telemetry;
    if (!route) {
      r.status = "idle";
      return;
    }
    const cleaning = route.kind === "clean";
    const speed = cleaning ? r.speedClean * (r.boost ? 14 : 1) : r.status === "returning" ? 1.5 : TRANSIT_SPEED;
    const prev = route.progress;
    route.progress = Math.min(route.length, prev + speed * dt);
    let moved = route.progress - prev;

    if (cleaning) {
      const seg = this.seg(route.segmentId!);
      const s0 = this.segPos(route, prev);
      let s1 = this.segPos(route, route.progress);
      const fwd = s1 >= s0;
      const hit = s.parked.find((v) => v.segmentId === seg.id && !v.detected && s.t >= v.arrives && s.t < v.leaves
        && (fwd ? v.alongM > s0 && v.alongM <= s1 + 5 : v.alongM < s0 && v.alongM >= s1 - 5));
      if (hit) {
        route.progress = prev;
        moved = 0;
        s1 = s0;
        this.detectVehicle(r, seg, hit);
      }
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      if (hi - lo > 0) {
        const unresolved = seg.blocked.filter((b) => !b.resolved);
        const done = subtract([{ from: lo, to: hi }], unresolved);
        const len = intervalTotal(done);
        if (len > 0) {
          seg.cleaned = mergeIntervals([...seg.cleaned, ...done]);
          r.cleanedTodayM += len;
          const bin = len * BIN_PER_M * (0.5 + seg.debris);
          T.binFill = Math.min(100, T.binFill + bin);
          r.wasteTodayKg += bin * BIN_KG_PER_PCT;
          T.brushWear = Math.min(100, T.brushWear + len * 0.0006);
          T.battery -= (r.boost ? 0.2 : 1) * len * BATTERY_PER_M * (100 / Math.max(50, T.batteryHealth));
        } else {
          T.battery -= BATTERY_TRANSIT_PER_S * dt;
        }
      }
    } else {
      T.battery -= BATTERY_TRANSIT_PER_S * dt * (100 / Math.max(50, T.batteryHealth));
    }
    T.battery = Math.max(0, T.battery);
    r.distanceTodayM += moved;
    r.odometerKm += moved / 1000;

    const at = pointAt(route.coords, route.cum, route.progress, route.cursor);
    r.pos = at.p;
    route.cursor = at.i;
    if (moved > 0) r.heading = at.heading;

    if (r.status === "blocked") return;
    if (route.progress >= route.length - 1e-6) return this.arrive(r);

    if (r.status !== "returning") {
      if (T.battery < 12) return this.returnToStation(r.id, "Battery critical - autonomous return");
      if (T.binFill >= 97) return this.returnToStation(r.id, "Waste bin full - autonomous return");
      if (T.motorTemp > 90) {
        r.maintenanceFlag = "Thermal protection tripped on brush motor";
        return this.returnToStation(r.id, "Thermal protection - autonomous return");
      }
    }
  }

  private arrive(r: R) {
    const s = this.s;
    const route = r.route!;
    if (route.dest === "station") return this.dock(r);
    if (route.kind === "transit") {
      const task = r.queue[0];
      if (!task) return this.returnToStation(r.id, "Route complete");
      const seg = this.seg(task.segmentId);
      if (s.t < seg.window.start) {
        r.status = "idle";
        r.route = null;
        r.holdReason = `Waiting for cleaning window ${fmtT(seg.window.start)}`;
        return;
      }
      return this.beginCleaning(r, task);
    }
    this.finishTask(r);
  }

  private finishTask(r: R) {
    const s = this.s;
    const task = r.queue.shift();
    r.boost = false;
    if (task) {
      const seg = this.seg(task.segmentId);
      const cover = mergeIntervals([...seg.cleaned, ...seg.blocked.filter((b) => !b.resolved)]);
      const remaining = intervalTotal(gaps(cover, seg.length));
      const blockedM = intervalTotal(seg.blocked.filter((b) => !b.resolved));
      if (remaining < 2) {
        if (blockedM > 0) {
          this.emit({ kind: "cleaning", severity: "warning", robotId: r.id, segmentId: seg.id,
            message: `${seg.name} cleaned except ${Math.round(blockedM)} m blocked by a parked vehicle (revisit scheduled)` });
        } else {
          seg.cleanedAt = s.t;
          seg.lastCleanedAt = s.t;
          seg.debris = 0.05;
          seg.nextCleaning = 7 * 86400 + seg.window.start;
          this.emit({ kind: "cleaning", severity: "success", robotId: r.id, segmentId: seg.id,
            message: `${seg.name} cleaned (${Math.round(seg.length)} m)` });
        }
      }
    }
    r.route = null;
    r.currentSegmentId = null;
    this.activateMissions(r);
    if (r.queue.length) this.startNextTask(r);
    else this.returnToStation(r.id, "Route complete");
  }

  returnToStation(robotId: string, reason: string, stationId?: string) {
    const r = this.robot(robotId);
    if (r.status === "offline") return;
    if (stationId) r.dockAt = stationId === r.stationId ? undefined : stationId;
    const st = this.station(r);
    if (r.docked) {
      if (r.maintenanceFlag) r.status = "maintenance";
      return;
    }
    // Remember where the current clean stopped so the task resumes from there.
    if (r.route?.kind === "clean" && r.queue[0]) {
      r.queue[0].from = this.segPos(r.route, r.route.progress);
    }
    const fromCands = r.currentSegmentId ? this.seg(r.currentSegmentId).nodes : undefined;
    r.route = this.makeRoute(this.transitPath(r.pos, st.pos, fromCands, [st.node]), "transit", "station", { stationId: st.id });
    r.status = "returning";
    r.returnReason = reason;
    r.currentSegmentId = null;
    r.holdReason = undefined;
    r.boost = false;
    this.emit({ kind: "navigation", severity: reason.includes("autonomous") || reason.includes("Low") ? "warning" : "info",
      robotId: r.id, stationId: st.id, message: `${r.id} returning to ${st.name}: ${reason}` });
  }

  private dock(r: R) {
    const st = this.station(r);
    r.route = null;
    r.docked = true;
    r.bay = null;
    r.pos = st.pos;
    r.currentSegmentId = null;
    const critical = r.faults.some((f) => f.severity === "critical");
    r.status = r.maintenanceFlag || critical ? "maintenance" : "charging";
    r.bay = this.nextFreeBay(st.id);
    if (r.bay === null) r.holdReason = "Waiting for a free charging bay";
    const emptied = r.telemetry.binFill > 5 ? ` · emptying ${Math.round(r.telemetry.binFill * BIN_KG_PER_PCT)} kg` : "";
    this.emit({ kind: "charging", severity: "info", robotId: r.id, stationId: st.id,
      message: `${r.id} docked at ${st.name}${emptied}${r.status === "maintenance" ? " · held for maintenance" : ""}` });
  }

  // ------------------------------------------------------------------ obstruction → case
  private detectVehicle(r: R, seg: StreetSegment, v: ParkedVehicle, manual = false) {
    const s = this.s;
    v.detected = true;
    const pos = pointAt(seg.coords, seg.cum, v.alongM).p;
    const incId = this.nextId("INC");
    const caseId = this.nextId("CASE");
    const t = s.t;
    const within = seg.scheduled && t >= seg.restriction.start && t < seg.restriction.end;
    const applies = seg.restriction.signed && within;
    const reason = !seg.restriction.signed
      ? "No cleaning restriction is posted at this location, so parking here is permitted. Logged as an obstruction only."
      : !within
        ? `Detected at ${fmtT(t)}, outside the posted window ${fmtT(seg.restriction.start)}-${fmtT(seg.restriction.end)}.`
        : `Detected at ${fmtT(t)} inside the posted window ${fmtT(seg.restriction.start)}-${fmtT(seg.restriction.end)}. Restriction sign recorded for this block.`;
    const range = { from: Math.max(0, v.alongM - 9), to: Math.min(seg.length, v.alongM + 9) };
    seg.blocked.push({ ...range, incidentId: incId, resolved: false });
    seg.incidentIds.push(incId);
    const revisitId = this.createRevisit(seg, r.id, t + 60 * 60, `Blocked by vehicle (${incId})`);
    const inc: Incident = {
      id: incId, type: "parked_vehicle", t, robotId: r.id, segmentId: seg.id, pos, alongM: v.alongM,
      vehicle: { ...v.vehicle, plate: v.ocrPlate }, vehicleConfidence: v.vehicleConfidence, ocrConfidence: v.ocrConfidence,
      evidence: {
        image: "/assets/evidence.jpg", source: "simulated",
        note: "Synthetic demonstration image", syntheticPlate: v.vehicle.plate,
      },
      plateSource: "ocr-simulated", caseId, revisitMissionId: revisitId, resolved: false,
    };
    s.incidents[incId] = inc;
    s.incidentOrder.push(incId);
    const c: EnforcementCase = {
      id: caseId, incidentId: incId, status: applies ? "awaiting_review" : "no_violation",
      plate: v.ocrPlate, originalPlate: v.ocrPlate, department: DEPARTMENT,
      check: { restriction: seg.restriction.label, signed: seg.restriction.signed, withinWindow: within, applies, reason },
      stages: [t, t + 4, t + 9, t + 13, t + 16, null, null, applies ? null : t + 17],
      evidenceReviewed: false, createdAt: t,
      audit: [
        { t, actor: r.id, action: "Obstruction detected", detail: `${v.vehicle.color} ${v.vehicle.body} blocking curb lane (${Math.round(v.vehicleConfidence * 100)}% confidence)` },
        { t: t + 4, actor: r.id, action: "Evidence captured", detail: "3 frames + GPS fix (simulated)" },
        { t: t + 9, actor: "OCR (simulated)", action: "Plate read", detail: `${v.ocrPlate} at ${Math.round(v.ocrConfidence * 100)}% confidence` },
        { t: t + 13, actor: "Rules engine", action: applies ? "Restriction applies" : "Restriction does not apply", detail: reason },
        { t: t + 16, actor: "CIVIC", action: applies ? "Enforcement review case created" : "Obstruction logged - no enforcement case",
          detail: applies ? "Awaiting human review. Nothing is sent without operator approval." : undefined },
      ],
    };
    s.cases[caseId] = c;
    s.caseOrder.push(caseId);
    if (!manual) {
      r.status = "blocked";
      r.holdUntil = t + 60;
      r.holdReason = "Capturing evidence at obstruction";
    }
    this.emit({ kind: "obstruction", severity: "warning", robotId: manual ? undefined : r.id, segmentId: seg.id, incidentId: incId,
      message: manual ? `Test incident from hardware prototype on ${seg.name}` : `${r.id} blocked by a parked ${v.vehicle.body} on ${seg.name}` });
    this.emit({ kind: "enforcement", severity: applies ? "warning" : "info", caseId, incidentId: incId, segmentId: seg.id,
      message: applies ? `${caseId} created - awaiting operator review` : `${incId} logged: no posted restriction, no enforcement case` });
    this.addRec({
      type: "blocked_defer", robotId: r.id, segmentIds: [seg.id], status: "applied",
      title: `Deferred ${Math.round(range.to - range.from)} m of ${seg.name}`,
      reason: `A parked vehicle blocks the curb at ${Math.round(v.alongM)} m. ${r.id} skips that section and keeps cleaning the rest of its route. A revisit is scheduled for ${fmtT(t + 3600)}, when the vehicle may have moved.`,
    });
  }

  createRevisit(seg: StreetSegment, robotId: string, at: number, note: string) {
    const id = this.nextId("M-RV", 3);
    const r = this.robot(robotId);
    const m: Mission = {
      id, name: `Revisit · ${seg.name}`, kind: "revisit", robotId, stationId: r.stationId, segmentIds: [seg.id],
      window: { start: at, end: Math.max(at + 3 * 3600, seg.window.end) }, priority: "priority", status: "scheduled",
      createdBy: "Dispatch engine", createdAt: this.s.t, note,
    };
    this.s.missions[id] = m;
    this.s.missionOrder.push(id);
    if (r.docked) this.activateMissions(r);
    return id;
  }

  // ------------------------------------------------------------------ scripted demo events
  private runScripted(ev: SimState["scripted"][number]) {
    const s = this.s;
    const r = this.robot(ev.robotId);
    if (ev.kind === "obstacle_ahead") {
      if (r.status !== "cleaning" || !r.route) return; // wait until the robot is cleaning
      ev.done = true;
      this.placeObstacle(r, 0.94, 40 * 60);
    } else if (ev.kind === "motor_fault") {
      ev.done = true;
      r.faults.push({ code: "BRUSH_MOTOR_OC", text: "Main brush motor drawing over-current", severity: "critical", t: s.t });
      this.emit({ kind: "maintenance", severity: "warning", robotId: r.id, message: `${r.id} reports brush motor over-current; temperature rising` });
    } else if (ev.kind === "connectivity_drop") {
      ev.done = true;
      r.offlineUntil = s.t + Number(ev.params?.minutes ?? 5) * 60;
    }
  }

  private placeObstacle(r: R, ocr: number, staySeconds: number) {
    const s = this.s;
    const route = r.route!;
    const seg = this.seg(route.segmentId!);
    const along = this.segPos(route, Math.min(route.length, route.progress + 6));
    const R2 = () => this.rand();
    const L = "ABCDEFGHJKLMNPRSTVWXYZ";
    const plate = `T${L[Math.floor(R2() * L.length)]}${L[Math.floor(R2() * L.length)]} ${Math.floor(R2() * 900 + 100)}`;
    s.parked.push({
      id: `PV-${s.parked.length + 1}`, segmentId: seg.id, alongM: along,
      vehicle: { plate, color: "Dark grey", body: "sedan" }, arrives: s.t - 3600, leaves: s.t + staySeconds,
      detected: false, vehicleConfidence: 0.97, ocrConfidence: ocr, ocrPlate: plate,
    });
  }

  // ------------------------------------------------------------------ rules → alerts
  ruleValue(r: Robot, rule: AlertRule) {
    return r.telemetry[rule.metric];
  }

  private evaluateRules() {
    const s = this.s;
    const open = new Map<string, string>();
    for (const aid of s.alertOrder) {
      const a = s.alerts[aid];
      if (a.resolvedAt === null) open.set(`${a.ruleId}:${a.robotId}`, aid);
    }
    for (const id of s.robotOrder) {
      const r = this.robot(id);
      for (const rule of s.rules) {
        const key = `${rule.id}:${r.id}`;
        const openId = open.get(key);
        if (!rule.enabled) {
          if (openId) s.alerts[openId].resolvedAt = s.t;
          continue;
        }
        if (r.status === "offline" && rule.metric !== "connectivity") continue; // stale telemetry: don't judge it
        const v = this.ruleValue(r, rule);
        const trig = rule.op === "<" ? v < rule.threshold : v > rule.threshold;
        const clear = rule.op === "<" ? v >= rule.threshold + rule.clearMargin : v <= rule.threshold - rule.clearMargin;
        if (trig && !openId) {
          const shown = rule.metric === "localization" ? v.toFixed(2) : Math.round(v).toString();
          const a: MaintenanceAlert = {
            id: this.nextId("AL"), ruleId: rule.id, robotId: r.id, severity: rule.severity,
            message: rule.message.replace("{robot}", r.id).replace("{value}", shown).replace("{threshold}", String(rule.threshold)),
            recommendation: rule.recommendation, action: rule.action, value: v, openedAt: s.t, resolvedAt: null, acknowledged: false,
          };
          s.alerts[a.id] = a;
          s.alertOrder.push(a.id);
          this.emit({ kind: "alert", severity: rule.severity, robotId: r.id, message: a.message });
          if (rule.action === "mark_offline" && r.status !== "offline") {
            r.prevStatus = r.status;
            r.status = "offline";
            this.emit({ kind: "system", severity: "critical", robotId: r.id, message: `${r.id} marked OFFLINE - holding position, telemetry frozen at ${fmtT(r.lastTelemetryAt)}` });
          }
        } else if (openId && clear) {
          s.alerts[openId].resolvedAt = s.t;
          if (rule.action === "mark_offline" && r.status === "offline") {
            r.status = r.prevStatus && r.prevStatus !== "offline" ? r.prevStatus : "idle";
            r.prevStatus = undefined;
            r.offlineUntil = undefined;
            this.emit({ kind: "system", severity: "success", robotId: r.id, message: `${r.id} link restored - telemetry fresh, resuming ${r.status}` });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ dispatch recommendations (rules, not ML)
  private addRec(rec: Omit<Recommendation, "id" | "createdAt" | "status"> & { status?: Recommendation["status"] }) {
    const s = this.s;
    const dup = s.recOrder.some((id) => {
      const x = s.recommendations[id];
      return x.status === "open" && x.type === rec.type && x.robotId === rec.robotId;
    });
    if (dup) return null;
    const r: Recommendation = { id: this.nextId("REC"), createdAt: s.t, status: rec.status ?? "open", ...rec } as Recommendation;
    s.recommendations[r.id] = r;
    s.recOrder.push(r.id);
    if (r.status === "open") this.emit({ kind: "dispatch", severity: "info", robotId: r.robotId, message: `Recommendation: ${r.title}` });
    return r;
  }

  private remCache: Map<string, string[]> | null = null;

  remainingSegments(r: Robot) {
    const hit = this.remCache?.get(r.id);
    if (hit) return hit;
    const ids = new Set<string>();
    for (const q of r.queue) if (!q.revisit) ids.add(q.segmentId);
    for (const mid of this.s.missionOrder) {
      const m = this.s.missions[mid];
      if (m.robotId === r.id && (m.status === "scheduled" || m.status === "active") && m.kind !== "revisit") {
        for (const sid of m.segmentIds) {
          const seg = this.seg(sid);
          if (seg.robotId === r.id && seg.scheduled && seg.cleanedAt === null && !seg.blocked.some((b) => !b.resolved)) ids.add(sid);
        }
      }
    }
    const out = [...ids];
    this.remCache?.set(r.id, out);
    return out;
  }

  private remainingMeters(segIds: string[]) {
    return segIds.reduce((sum, id) => {
      const seg = this.seg(id);
      return sum + intervalTotal(gaps(mergeIntervals([...seg.cleaned, ...seg.blocked]), seg.length));
    }, 0);
  }

  private evaluateDispatch() {
    this.remCache = new Map();
    try {
      this.dispatchRules();
    } finally {
      this.remCache = null;
    }
  }

  private dispatchRules() {
    const s = this.s;
    const robots = s.robotOrder.map((id) => this.robot(id));
    const available = (o: R) => o.status !== "offline" && o.status !== "maintenance" && !o.maintenanceFlag
      && !o.faults.some((f) => f.severity === "critical");

    // 1. Low battery hand-off
    for (const r of robots) {
      const lowAlert = s.alertOrder.some((a) => s.alerts[a].robotId === r.id && s.alerts[a].ruleId === "battery-low" && s.alerts[a].resolvedAt === null);
      if (!lowAlert) continue;
      const rem = this.remainingSegments(r);
      if (!rem.length) continue;
      const first = this.seg(rem[0]);
      const cands = robots.filter((o) => o.id !== r.id && available(o) && o.telemetry.battery >= 50
        && (o.status === "idle" || o.status === "charging" || (this.remainingSegments(o).length === 0 && o.status !== "returning")));
      cands.sort((a, b) => (a.stationId === r.stationId ? 0 : 1) - (b.stationId === r.stationId ? 0 : 1)
        || dist(a.pos, first.coords[0]) - dist(b.pos, first.coords[0]));
      const c = cands[0];
      if (!c) continue;
      const km = (this.remainingMeters(rem) / 1000).toFixed(1);
      this.addRec({
        type: "low_battery_handoff", robotId: r.id, targetRobotId: c.id, segmentIds: rem,
        title: `Hand ${rem.length} segment${rem.length > 1 ? "s" : ""} from ${r.id} to ${c.id}`,
        reason: `${r.id} battery is ${Math.round(r.telemetry.battery)}% with ${rem.length} segment${rem.length > 1 ? "s" : ""} (${km} km) left. ${c.id} is ${c.status === "cleaning" ? "finishing its route" : c.status} ${c.stationId === r.stationId ? "at the same station" : `at ${this.s.stations[c.stationId].name}`} with ${Math.round(c.telemetry.battery)}% battery, ${(dist(c.pos, first.coords[0]) / 1000).toFixed(1)} km from ${first.name}.`,
      });
    }

    // 2. Robot finished early → nearby unfinished work
    for (const r of robots) {
      if (!r.docked || !available(r) || r.telemetry.battery < 60 || r.queue.length) continue;
      const mine = s.missionOrder.map((m) => s.missions[m]).filter((m) => m.robotId === r.id && m.kind === "routine");
      if (!mine.length || !mine.every((m) => m.status === "completed" || m.status === "partial")) continue;
      const windowEnd = Math.max(...mine.map((m) => m.window.end));
      if (s.t > windowEnd - 20 * 60) continue;
      const st = this.station(r);
      const pending = s.segmentOrder.map((id) => this.seg(id)).filter((seg) => {
        if (!seg.scheduled || seg.cleanedAt !== null || seg.robotId === r.id) return false;
        if (seg.window.start > s.t + 30 * 60 || seg.blocked.some((b) => !b.resolved)) return false;
        const owner = this.robot(seg.robotId);
        if (owner.currentSegmentId === seg.id) return false;
        const ownerDown = !available(owner) || owner.telemetry.battery < 25;
        return ownerDown || this.remainingSegments(owner).length >= 2;
      }).filter((seg) => dist(st.pos, seg.coords[0]) < 1800);
      if (!pending.length) continue;
      pending.sort((a, b) => dist(st.pos, a.coords[0]) - dist(st.pos, b.coords[0]));
      const pick = pending[0];
      const owner = this.robot(pick.robotId);
      const pct = Math.round((100 * intervalTotal(pick.cleaned)) / pick.length);
      const minutes = Math.round((windowEnd - s.t) / 60);
      this.addRec({
        type: "early_finish", robotId: owner.id, targetRobotId: r.id, segmentIds: [pick.id],
        title: `${r.id} can take ${pick.name}`,
        reason: `${r.id} finished its route with ${minutes} min left in its window and ${Math.round(r.telemetry.battery)}% battery. ${pick.name} (${owner.id}, ${pct}% done${!available(owner) ? `, robot ${owner.status}` : `, ${this.remainingSegments(owner).length} segments still queued`}) is ${(dist(st.pos, pick.coords[0]) / 1000).toFixed(1)} km from ${st.name}.`,
      });
    }

    // 3. Station at charging capacity
    for (const r of robots) {
      if (r.status !== "returning") continue;
      const st = this.station(r);
      if (this.freeBays(st.id) > 0 || !r.route) continue;
      const remaining = r.route.length - r.route.progress;
      if (remaining > 900) continue;
      const others = Object.values(s.stations).filter((o) => o.id !== st.id && this.freeBays(o.id) > 0)
        .sort((a, b) => dist(r.pos, a.pos) - dist(r.pos, b.pos));
      const alt = others[0];
      if (!alt) continue;
      this.addRec({
        type: "station_capacity", robotId: r.id, stationId: alt.id,
        title: `Send ${r.id} to ${alt.name} to charge`,
        reason: `${st.name} has ${st.bays - st.baysOutOfService} working bays and all are in use${st.baysOutOfService ? ` (${st.baysOutOfService} out of service)` : ""}. ${alt.name} has ${this.freeBays(alt.id)} free bay${this.freeBays(alt.id) > 1 ? "s" : ""}, ${(dist(r.pos, alt.pos) / 1000).toFixed(1)} km away.`,
      });
    }

    // Expire recommendations that no longer apply
    for (const id of s.recOrder) {
      const rec = s.recommendations[id];
      if (rec.status !== "open") continue;
      const r = this.robot(rec.robotId);
      if (rec.type === "low_battery_handoff" && (r.telemetry.battery > 35 || !this.remainingSegments(r).length)) rec.status = "dismissed";
      if (rec.type === "station_capacity" && r.status !== "returning") rec.status = "dismissed";
      if (rec.type === "early_finish" && rec.segmentIds?.every((sid) => this.seg(sid).cleanedAt !== null)) rec.status = "dismissed";
    }
  }

  // ------------------------------------------------------------------ minute housekeeping
  private minuteTick() {
    const s = this.s;
    for (const id of s.robotOrder) {
      const r = this.robot(id);
      if (r.status !== "offline") {
        r.history.push({ t: s.t, battery: r.telemetry.battery, binFill: r.telemetry.binFill, motorTemp: r.telemetry.motorTemp,
          motorLoad: r.telemetry.motorLoad, connectivity: r.telemetry.connectivity });
        if (r.history.length > 960) r.history.shift();
      }
    }
    for (const mid of s.missionOrder) {
      const m = s.missions[mid];
      if (m.status !== "active" && m.status !== "paused") continue;
      const r = this.robot(m.robotId);
      if (r.queue.some((q) => q.missionId === m.id)) continue;
      const segs = m.segmentIds.map((x) => this.seg(x)).filter((x) => x.robotId === m.robotId);
      if (m.kind === "revisit") {
        const open = segs.some((x) => x.blocked.some((b) => !b.resolved));
        m.status = open ? "partial" : "completed";
      } else {
        const blocked = segs.some((x) => x.blocked.some((b) => !b.resolved));
        const done = segs.every((x) => x.cleanedAt !== null || x.blocked.some((b) => !b.resolved));
        if (!done && r.queue.length) continue;
        m.status = blocked || !done ? "partial" : "completed";
      }
      m.completedAt = s.t;
      this.emit({ kind: "mission", severity: m.status === "completed" ? "success" : "warning", robotId: m.robotId, missionId: m.id,
        message: `${m.name} ${m.status === "completed" ? "completed" : "finished with sections deferred"}` });
    }
    for (const cid of s.caseOrder) {
      const c = s.cases[cid];
      if (c.status === "forwarded" && c.stages[6] !== null && s.t >= c.stages[6]! + 180 && c.stages[7] === null) {
        c.status = "acknowledged";
        c.stages[7] = s.t;
        c.audit.push({ t: s.t, actor: `${c.department} (simulated)`, action: "Referral received",
          detail: "Simulated acknowledgement. No data left this application." });
        this.emit({ kind: "enforcement", severity: "success", caseId: c.id, message: `${c.id} acknowledged by ${c.department} (simulated)` });
      }
    }
  }

  // ------------------------------------------------------------------ operator actions
  private log(action: string, detail: string, extra: Partial<SimEvent> = {}) {
    this.emit({ kind: "operator", severity: "info", message: `${this.s.operator}: ${action}${detail ? ` - ${detail}` : ""}`, ...extra });
  }

  pause(robotId: string) {
    const r = this.robot(robotId);
    if (["paused", "offline", "maintenance"].includes(r.status) || r.docked) return;
    r.prevStatus = r.status;
    r.status = "paused";
    if (r.missionId && this.s.missions[r.missionId]) this.s.missions[r.missionId].status = "paused";
    this.log("Paused", robotId, { robotId });
  }

  resume(robotId: string) {
    const r = this.robot(robotId);
    if (r.status !== "paused") return;
    r.status = r.prevStatus ?? "navigating";
    r.prevStatus = undefined;
    if (r.missionId && this.s.missions[r.missionId]?.status === "paused") this.s.missions[r.missionId].status = "active";
    this.log("Resumed", robotId, { robotId });
  }

  operatorReturn(robotId: string, reason = "Operator dispatch") {
    const r = this.robot(robotId);
    if (r.status === "paused") r.status = r.prevStatus ?? "navigating";
    this.returnToStation(robotId, reason);
    this.log("Sent to station", robotId, { robotId });
  }

  flagMaintenance(robotId: string, note: string) {
    const r = this.robot(robotId);
    r.maintenanceFlag = note || "Flagged by operator";
    if (r.docked) r.status = "maintenance";
    else this.returnToStation(robotId, "Flagged for maintenance");
    this.log("Flagged maintenance", `${robotId}: ${r.maintenanceFlag}`, { robotId });
  }

  completeService(robotId: string) {
    const r = this.robot(robotId);
    const T = r.telemetry;
    T.brushWear = 2;
    T.sensorHealth = 100;
    T.motorTemp = 20;
    if (T.batteryHealth < 82) T.batteryHealth = 100;
    r.faults = [];
    r.maintenanceFlag = undefined;
    r.lastMaintenance = this.s.t;
    r.nextService = this.s.t + 30 * 86400;
    if (r.status === "maintenance") r.status = "charging";
    this.log("Service completed", robotId, { robotId });
  }

  reassign(segmentIds: string[], toId: string, reason = "Operator reassignment") {
    const s = this.s;
    const to = this.robot(toId);
    const moved: string[] = [];
    for (const sid of segmentIds) {
      const seg = this.seg(sid);
      if (seg.robotId === toId) continue;
      const from = this.robot(seg.robotId);
      from.queue = from.queue.filter((q) => q.segmentId !== sid);
      if (from.currentSegmentId === sid && (from.status === "cleaning" || from.status === "navigating" || from.status === "idle")) {
        from.route = null;
        from.currentSegmentId = null;
        if (from.queue.length) this.startNextTask(from);
        else if (!from.docked) this.returnToStation(from.id, "Segment handed to another robot");
      }
      seg.robotId = toId;
      seg.stationId = to.stationId;
      seg.scheduled = true;
      moved.push(sid);
    }
    if (!moved.length) return null;
    const id = this.nextId("M-RA", 3);
    const m: Mission = {
      id, name: `Reassigned · ${moved.length} segment${moved.length > 1 ? "s" : ""} → ${toId}`, kind: "reassignment",
      robotId: toId, stationId: to.stationId, segmentIds: moved, window: { start: s.t, end: s.t + 4 * 3600 },
      priority: "priority", status: "scheduled", createdBy: s.operator, createdAt: s.t, note: reason,
    };
    s.missions[id] = m;
    s.missionOrder.push(id);
    this.activateMissions(to);
    if (!to.docked && to.status !== "offline" && !to.route && to.queue.length) this.startNextTask(to);
    if (to.docked) this.activateMissions(to);
    else if (to.status !== "cleaning" && to.status !== "navigating" && to.status !== "returning" && to.queue.length && !to.route) this.startNextTask(to);
    this.log("Reassigned", `${moved.map((x) => this.seg(x).name).join(", ")} → ${toId}`, { robotId: toId, missionId: id });
    return id;
  }

  canScheduleSegment(seg: StreetSegment) {
    return seg.cleanedAt === null && !seg.blocked.some((b) => !b.resolved)
      && this.robot(seg.robotId).currentSegmentId !== seg.id;
  }

  /** While a robot is out it picks up new tasks when its current one ends. */
  createMission(p: { robotId: string; segmentIds: string[]; start: number; end: number; priority: "routine" | "priority"; name?: string }) {
    const s = this.s;
    const r = this.robot(p.robotId);
    const segments = [...new Set(p.segmentIds)].map((sid) => this.seg(sid));
    if (!r || !segments.length || p.start < s.dayStart || !(p.end > Math.max(s.t, p.start)) || p.end > s.dayEnd
      || segments.some((seg) => !seg || !this.canScheduleSegment(seg))) return null;
    for (const seg of segments) {
      const previous = this.robot(seg.robotId);
      previous.queue = previous.queue.filter((task) => task.segmentId !== seg.id);
      seg.robotId = p.robotId;
      seg.stationId = r.stationId;
      seg.scheduled = true;
      seg.window = { start: p.start, end: p.end };
      seg.nextCleaning = p.start;
      seg.priority = p.priority;
    }
    const segmentIds = segments.map((seg) => seg.id);
    for (const mid of s.missionOrder) {
      const m = s.missions[mid];
      if (!["scheduled", "active", "paused"].includes(m.status) || m.kind === "revisit") continue;
      m.segmentIds = m.segmentIds.filter((sid) => !segmentIds.includes(sid));
      if (!m.segmentIds.length) m.status = "cancelled";
    }
    const id = this.nextId("M-OP", 3);
    s.missions[id] = {
      id, name: p.name || `Operator assignment · ${segmentIds.length} segment${segmentIds.length > 1 ? "s" : ""}`,
      kind: "operator", robotId: p.robotId, stationId: r.stationId, segmentIds,
      window: { start: p.start, end: p.end }, priority: p.priority, status: "scheduled", createdBy: s.operator, createdAt: s.t,
    };
    s.missionOrder.push(id);
    this.activateMissions(r);
    if (!r.docked && !r.route && r.queue.length && r.status !== "offline" && r.status !== "paused" && r.status !== "maintenance") {
      this.startNextTask(r);
    }
    this.log("Created mission", `${id} for ${p.robotId}`, { robotId: p.robotId, missionId: id });
    return id;
  }

  scheduleRevisit(segmentId: string, robotId: string, at: number) {
    const seg = this.seg(segmentId);
    seg.robotId = robotId;
    seg.stationId = this.robot(robotId).stationId;
    const id = this.createRevisit(seg, robotId, at, "Scheduled by operator");
    this.log("Scheduled revisit", `${seg.name} at ${fmtT(at)} by ${robotId}`, { robotId, missionId: id });
    return id;
  }

  acceptRecommendation(id: string) {
    const s = this.s;
    const rec = s.recommendations[id];
    if (!rec || rec.status !== "open") return;
    rec.status = "accepted";
    if (rec.type === "low_battery_handoff" && rec.targetRobotId && rec.segmentIds) {
      this.reassign(rec.segmentIds, rec.targetRobotId, `Low battery hand-off from ${rec.robotId}`);
      if (!this.robot(rec.robotId).docked) this.returnToStation(rec.robotId, "Low battery - work handed off");
    } else if (rec.type === "early_finish" && rec.targetRobotId && rec.segmentIds) {
      this.reassign(rec.segmentIds, rec.targetRobotId, `Early finish pick-up`);
    } else if (rec.type === "station_capacity" && rec.stationId) {
      this.returnToStation(rec.robotId, `Rerouted to ${s.stations[rec.stationId].name} (bays free)`, rec.stationId);
    }
    this.log("Accepted recommendation", rec.title, { robotId: rec.robotId });
  }

  dismissRecommendation(id: string) {
    const rec = this.s.recommendations[id];
    if (rec && rec.status === "open") rec.status = "dismissed";
  }

  acknowledgeAlert(id: string) {
    const a = this.s.alerts[id];
    if (a) a.acknowledged = true;
  }

  // Cases --------------------------------------------------------------
  private caseAudit(c: EnforcementCase, action: string, detail?: string) {
    c.audit.push({ t: this.s.t, actor: this.s.operator, action, detail });
  }

  reviewEvidence(caseId: string) {
    const c = this.s.cases[caseId];
    if (!c || c.evidenceReviewed) return;
    c.evidenceReviewed = true;
    this.caseAudit(c, "Evidence reviewed", "Frames, timestamp, location and restriction checked");
  }

  correctPlate(caseId: string, plate: string) {
    const c = this.s.cases[caseId];
    const p = plate.trim().toUpperCase();
    if (!c || !p || p === c.plate) return;
    this.caseAudit(c, "Plate corrected", `${c.plate} → ${p}`);
    c.plate = p;
    const inc = this.s.incidents[c.incidentId];
    if (inc) inc.vehicle.plate = p;
  }

  decideCase(caseId: string, decision: "approved" | "rejected" | "insufficient_evidence", note = "") {
    const c = this.s.cases[caseId];
    if (!c || c.status !== "awaiting_review" || this.s.t < (c.stages[4] ?? Infinity)) return;
    if (decision === "approved" && (!c.check.applies || !c.evidenceReviewed || !c.plate.trim())) return;
    c.status = decision;
    c.stages[5] = this.s.t;
    if (decision !== "approved") c.stages[7] = this.s.t;
    const label = decision === "approved" ? "Referral approved" : decision === "rejected" ? "Case rejected" : "Marked insufficient evidence";
    this.caseAudit(c, label, note || undefined);
    this.emit({ kind: "enforcement", severity: decision === "approved" ? "success" : "info", caseId, message: `${caseId}: ${label.toLowerCase()} by ${this.s.operator}` });
  }

  forwardCase(caseId: string) {
    const c = this.s.cases[caseId];
    if (!c || c.status !== "approved") return;
    c.status = "forwarded";
    c.stages[6] = this.s.t;
    this.caseAudit(c, `Referred to ${c.department} (simulated)`, "Simulation only - no data transmitted to any agency");
    this.emit({ kind: "enforcement", severity: "info", caseId, message: `${caseId} routed to ${c.department} (simulated)` });
  }

  /** Test incident from the hardware page: real snapshot, manually typed plate. */
  manualIncident(p: { segmentId: string; plate: string; image: string; note: string; vehicleConfidence: number }) {
    const s = this.s;
    const seg = this.seg(p.segmentId);
    const fake: ParkedVehicle = {
      id: `PV-M${s.parked.length + 1}`, segmentId: seg.id, alongM: seg.length / 2,
      vehicle: { plate: p.plate.toUpperCase(), color: "Unknown", body: "vehicle" }, arrives: s.t - 60, leaves: s.t + 1800,
      detected: false, vehicleConfidence: p.vehicleConfidence, ocrConfidence: 1, ocrPlate: p.plate.toUpperCase(),
    };
    s.parked.push(fake);
    this.detectVehicle(this.robot(seg.robotId), seg, fake, true);
    const incId = s.incidentOrder[s.incidentOrder.length - 1];
    const inc = s.incidents[incId];
    inc.robotId = "HW-PROTO";
    inc.evidence = { image: p.image, source: "camera", note: p.note };
    inc.plateSource = "manual";
    inc.ocrConfidence = 1;
    const c = s.cases[inc.caseId!];
    c.audit[0] = { ...c.audit[0], actor: "Hardware prototype", detail: "Test incident from the prototype camera" };
    c.audit[2] = { ...c.audit[2], actor: s.operator, action: "Plate entered manually" };
    return incId;
  }

  // Demo / test triggers ---------------------------------------------
  triggerObstacle(robotId: string) {
    const r = this.robot(robotId);
    if (r.status !== "cleaning" || !r.route) return false;
    this.placeObstacle(r, 0.93, 35 * 60);
    this.log("Injected obstacle", robotId, { robotId });
    return true;
  }

  triggerLowBattery(robotId: string) {
    this.robot(robotId).telemetry.battery = 18.5;
    this.log("Injected low battery", robotId, { robotId });
  }

  triggerFullBin(robotId: string) {
    this.robot(robotId).telemetry.binFill = 88;
    this.log("Injected full bin", robotId, { robotId });
  }

  triggerFault(robotId: string) {
    const r = this.robot(robotId);
    if (!r.faults.some((f) => f.code === "BRUSH_MOTOR_OC")) {
      r.faults.push({ code: "BRUSH_MOTOR_OC", text: "Main brush motor drawing over-current", severity: "critical", t: this.s.t });
    }
    r.telemetry.motorTemp = Math.max(r.telemetry.motorTemp, 78);
    this.log("Injected maintenance fault", robotId, { robotId });
  }

  completeCurrentSegment(robotId: string) {
    const r = this.robot(robotId);
    if (!r.route || r.route.kind !== "clean") return false;
    r.boost = true;
    this.log("Fast-forwarded current segment", robotId, { robotId });
    return true;
  }

  // ------------------------------------------------------------------ derived
  segmentStatus(seg: StreetSegment): SegmentStatus {
    const unresolved = seg.blocked.some((b) => !b.resolved);
    if (!seg.scheduled) return "inactive";
    if (seg.cleanedAt !== null && !unresolved) return "cleaned";
    const r = this.robot(seg.robotId);
    if (r.route?.kind === "clean" && r.route.segmentId === seg.id && ["cleaning", "blocked", "paused"].includes(r.status)) return "cleaning";
    if (unresolved) return "blocked";
    const down = r.status === "maintenance" || r.status === "offline" || !!r.maintenanceFlag;
    if (down && this.s.t >= seg.window.start) return "blocked";
    return "scheduled";
  }

  segmentProgress(seg: StreetSegment) {
    return Math.min(1, intervalTotal(seg.cleaned) / seg.length);
  }

  /** Estimated time this robot finishes its remaining work today. */
  robotEta(r: Robot): number | null {
    const segs = this.remainingSegments(r);
    if (!segs.length && !r.queue.length) return null;
    const meters = this.remainingMeters(segs);
    const start = Math.max(this.s.t, ...segs.map((id) => this.seg(id).window.start - 10 * 60));
    let secs = meters / r.speedClean + segs.length * 150;
    const needPct = meters * BATTERY_PER_M * (100 / Math.max(50, r.telemetry.batteryHealth));
    if (needPct > r.telemetry.battery - 15) secs += 50 * 60;
    return start + secs;
  }
}

export function isDocked(r: Robot) {
  return (r as R).docked === true;
}

export function bayOf(r: Robot) {
  return (r as R).bay ?? null;
}

export function dockStationOf(r: Robot) {
  return (r as R).dockAt ?? r.stationId;
}

export { DOCKED };
