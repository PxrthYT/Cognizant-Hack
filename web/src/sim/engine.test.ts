import { describe, expect, it } from "vitest";
import coreJson from "@/data/core.json";
import { buildInitialState, DEMO_START, H, type PresetJson } from "./dataset";
import { Sim } from "./engine";
import { dist } from "./geo";
import { intervalTotal } from "./geo";

const fresh = () => new Sim(buildInitialState(coreJson as unknown as PresetJson, "core"));

describe("simulation engine", () => {
  it("is deterministic for the same seed", () => {
    const a = fresh();
    const b = fresh();
    a.advance(H(11) - a.s.t);
    b.advance(H(11) - b.s.t);
    expect(JSON.stringify(a.s.robots)).toEqual(JSON.stringify(b.s.robots));
    expect(a.s.events.length).toEqual(b.s.events.length);
  });

  it("robots start docked and leave for their first segment when the window opens", () => {
    const sim = fresh();
    const r3 = sim.s.robots["R-003"];
    expect(r3.status).toBe("idle");
    sim.advance(DEMO_START - sim.s.t);
    expect(["idle", "charging"]).toContain(sim.s.robots["R-003"].status);
    sim.advance(5 * 60);
    expect(["navigating", "cleaning"]).toContain(sim.s.robots["R-003"].status);
  });

  it("moves robots continuously (no teleporting) while navigating and cleaning", () => {
    const sim = fresh();
    sim.advance(H(10, 5) - sim.s.t);
    const r = sim.s.robots["R-005"];
    let prev = [...r.pos] as [number, number];
    let maxJump = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(1);
      if (["navigating", "cleaning", "returning"].includes(r.status)) maxJump = Math.max(maxJump, dist(prev, r.pos));
      prev = [...r.pos] as [number, number];
    }
    expect(maxJump).toBeLessThan(5); // 1 s of travel at ≤1.5 m/s, plus rounding at path joins
  });

  it("fills the first free charging bay without assigning two robots to one bay", () => {
    const sim = fresh();
    const robots = sim.s.robotOrder.map((id) => sim.robot(id));
    const stationId = robots[0].stationId;
    const [leaving, parked, arriving] = robots.filter((r) => r.stationId === stationId);
    leaving.docked = false;
    leaving.status = "paused";
    parked.bay = 2;
    sim.step(1);
    expect(parked.bay).toBe(2);
    expect(arriving.bay).toBe(1);
  });

  it("cleans segments progressively and drains battery and fills the bin", () => {
    const sim = fresh();
    sim.advance(H(9) - sim.s.t);
    const r = sim.s.robots["R-004"];
    const b0 = r.telemetry.battery;
    const seg = sim.s.segments[r.currentSegmentId ?? sim.s.segmentOrder.find((id) => sim.s.segments[id].robotId === "R-004")!];
    const c0 = intervalTotal(seg.cleaned);
    sim.advance(20 * 60);
    expect(r.telemetry.battery).toBeLessThan(b0);
    expect(r.wasteTodayKg).toBeGreaterThan(0);
    expect(intervalTotal(sim.s.segments[seg.id].cleaned) + r.cleanedTodayM).toBeGreaterThan(c0);
  });

  it("R-003 meets a parked car at 10:24 and opens an enforcement case awaiting human review", () => {
    const sim = fresh();
    const ok = sim.advanceUntil((s) => s.caseOrder.some((c) => s.incidents[s.cases[c].incidentId].robotId === "R-003"), H(11) - sim.s.t);
    expect(ok).toBe(true);
    const c = Object.values(sim.s.cases).find((x) => sim.s.incidents[x.incidentId].robotId === "R-003")!;
    const inc = sim.s.incidents[c.incidentId];
    expect(Math.abs(inc.t - H(10, 24))).toBeLessThan(120);
    expect(c.status).toBe("awaiting_review");
    expect(c.check.applies).toBe(true);
    expect(sim.s.robots["R-003"].status).toBe("blocked");
    const seg = sim.s.segments[inc.segmentId];
    expect(seg.blocked.some((b) => !b.resolved)).toBe(true);
    expect(sim.s.missions[inc.revisitMissionId!].kind).toBe("revisit");
    // robot bypasses and keeps going
    sim.advance(120);
    expect(sim.s.robots["R-003"].status).toBe("cleaning");
    // nothing is forwarded without approval
    sim.advance(30 * 60);
    expect(sim.s.cases[c.id].status).toBe("awaiting_review");
  });

  it("enforcement workflow: review, correct OCR, approve, forward, acknowledgement in the audit log", () => {
    const sim = fresh();
    sim.advanceUntil((s) => s.caseOrder.length > 0 && Object.values(s.cases).some((c) => c.status === "awaiting_review"), H(13) - sim.s.t);
    const c = Object.values(sim.s.cases).find((x) => x.status === "awaiting_review")!;
    sim.advance(30);
    sim.reviewEvidence(c.id);
    sim.correctPlate(c.id, "tzz 123");
    expect(sim.s.cases[c.id].plate).toBe("TZZ 123");
    sim.forwardCase(c.id); // not approved yet: must be ignored
    expect(sim.s.cases[c.id].status).toBe("awaiting_review");
    sim.decideCase(c.id, "approved");
    sim.forwardCase(c.id);
    expect(sim.s.cases[c.id].status).toBe("forwarded");
    sim.advance(5 * 60);
    expect(sim.s.cases[c.id].status).toBe("acknowledged");
    const actions = sim.s.cases[c.id].audit.map((a) => a.action);
    expect(actions).toContain("Referral approved");
    expect(actions).toContain("Plate corrected");
    expect(actions.some((a) => a.startsWith("Referred to"))).toBe(true);
  });

  it("a car where no restriction is posted is logged without an enforcement referral", () => {
    const sim = fresh();
    sim.advance(H(14) - sim.s.t);
    const noViolation = Object.values(sim.s.cases).filter((c) => c.status === "no_violation");
    expect(noViolation.length).toBeGreaterThan(0);
    expect(noViolation.every((c) => !c.check.applies)).toBe(true);
  });

  it("rejecting a case closes it", () => {
    const sim = fresh();
    sim.advanceUntil((s) => Object.values(s.cases).some((c) => c.status === "awaiting_review"), H(13) - sim.s.t);
    const c = Object.values(sim.s.cases).find((x) => x.status === "awaiting_review")!;
    sim.advance(30);
    sim.decideCase(c.id, "rejected", "Vehicle had a valid permit");
    expect(sim.s.cases[c.id].status).toBe("rejected");
    sim.forwardCase(c.id);
    expect(sim.s.cases[c.id].status).toBe("rejected");
  });

  it("requires a visible case and reviewed evidence before approving a referral", () => {
    const sim = fresh();
    sim.advanceUntil((s) => Object.values(s.cases).some((c) => c.status === "awaiting_review"), H(13) - sim.s.t);
    const c = Object.values(sim.s.cases).find((x) => x.status === "awaiting_review")!;
    sim.decideCase(c.id, "rejected");
    expect(c.status).toBe("awaiting_review");
    sim.advance(30);
    sim.decideCase(c.id, "approved");
    expect(c.status).toBe("awaiting_review");
    sim.reviewEvidence(c.id);
    sim.decideCase(c.id, "approved");
    expect(c.status).toBe("approved");
  });

  it("low battery raises a rule-based alert and a hand-off recommendation", () => {
    const sim = fresh();
    sim.advanceUntil((s) => Object.values(s.alerts).some((a) => a.ruleId === "battery-low" && a.robotId === "R-006"), H(13) - sim.s.t);
    const alert = Object.values(sim.s.alerts).find((a) => a.ruleId === "battery-low" && a.robotId === "R-006");
    expect(alert).toBeTruthy();
    sim.advance(60);
    const rec = Object.values(sim.s.recommendations).find((r) => r.type === "low_battery_handoff" && r.robotId === "R-006");
    expect(rec?.reason).toMatch(/battery/);
    sim.acceptRecommendation(rec!.id);
    const target = sim.s.robots[rec!.targetRobotId!];
    expect(rec!.segmentIds!.every((id) => sim.s.segments[id].robotId === target.id)).toBe(true);
    expect(sim.s.robots["R-006"].status).toBe("returning");
  });

  it("configurable rules: disabling a rule stops its alerts", () => {
    const sim = fresh();
    sim.s.rules.find((r) => r.id === "battery-low")!.enabled = false;
    sim.triggerLowBattery("R-001");
    sim.advance(30);
    expect(Object.values(sim.s.alerts).some((a) => a.ruleId === "battery-low" && a.resolvedAt === null)).toBe(false);
  });

  it("connectivity loss marks the robot offline and freezes telemetry, then recovers", () => {
    const sim = fresh();
    sim.advance(H(12, 41) - sim.s.t);
    const r = sim.s.robots["R-008"];
    expect(r.status).toBe("offline");
    const frozen = r.lastTelemetryAt;
    sim.advance(120);
    expect(r.lastTelemetryAt).toBe(frozen);
    sim.advance(10 * 60);
    expect(r.status).not.toBe("offline");
  });

  it("pause / resume and reassignment change shared state", () => {
    const sim = fresh();
    sim.advance(H(10, 15) - sim.s.t);
    sim.pause("R-005");
    expect(sim.s.robots["R-005"].status).toBe("paused");
    const pos = [...sim.s.robots["R-005"].pos];
    sim.advance(60);
    expect(sim.s.robots["R-005"].pos).toEqual(pos);
    sim.resume("R-005");
    expect(sim.s.robots["R-005"].status).not.toBe("paused");
    const seg = sim.s.segmentOrder.find((id) => sim.s.segments[id].robotId === "R-005" && sim.s.segments[id].cleanedAt === null && sim.s.robots["R-005"].currentSegmentId !== id)!;
    const mid = sim.reassign([seg], "R-004");
    expect(mid).toBeTruthy();
    expect(sim.s.segments[seg].robotId).toBe("R-004");
    expect(sim.s.segments[seg].stationId).toBe(sim.s.robots["R-004"].stationId);
  });

  it("scheduling a street transfers future work without erasing cleaning progress", () => {
    const sim = fresh();
    const segment = sim.s.segmentOrder.map((id) => sim.s.segments[id])
      .find((seg) => seg.robotId === "R-001" && seg.scheduled)!;
    segment.cleaned = [{ from: 0, to: 25 }];
    const original = sim.s.missionOrder.map((id) => sim.s.missions[id]).find((m) => m.segmentIds.includes(segment.id))!;
    const options = { robotId: "R-004", segmentIds: [segment.id], start: H(11), end: H(13), priority: "priority" as const };
    const id = sim.createMission(options)!;
    expect(sim.s.missions[id].segmentIds).toEqual([segment.id]);
    expect(original.segmentIds).not.toContain(segment.id);
    expect(segment.stationId).toBe(sim.s.robots["R-004"].stationId);
    expect(segment.cleaned).toEqual([{ from: 0, to: 25 }]);
    expect(segment.nextCleaning).toBe(H(11));
    segment.cleanedAt = H(10);
    expect(sim.createMission(options)).toBeNull();
  });

  it("runs a full day without errors and cleans most scheduled streets", () => {
    const sim = fresh();
    sim.advance(H(22) - sim.s.t);
    const sched = Object.values(sim.s.segments).filter((s) => s.scheduled);
    const cleaned = sched.filter((s) => s.cleanedAt !== null).length;
    expect(cleaned / sched.length).toBeGreaterThan(0.6);
  });
});
