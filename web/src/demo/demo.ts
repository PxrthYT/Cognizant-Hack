// Guided "City Operations" demo. Deterministic: it always starts from the same
// seeded state at 09:56 and each scene entry is snapshotted so Previous replays exactly.
import { create } from "zustand";
import { H, type PresetId } from "@/sim/dataset";
import type { Sim } from "@/sim/engine";
import type { Frame } from "@/sim/replay";
import type { SimState } from "@/sim/types";
import { bounds } from "@/components/inspector/Inspector";
import { useSim } from "@/store/sim";
import { useUi, type PageId } from "@/store/ui";
import { toast } from "@/store/toast";

export interface Scene {
  id: string;
  title: string;
  narrative: string;
  minMs: number;                       // minimum time on screen in autoplay
  enter: (sim: Sim) => void;
  ready?: (sim: Sim) => boolean;       // autoplay advances when true (after minMs)
  waitForUser?: (sim: Sim) => boolean; // autoplay holds until this returns true
  onTick?: (sim: Sim, sceneMs: number) => void;
}

const ui = () => useUi.getState();
const simStore = () => useSim.getState();
const fitAll = (sim: Sim) => ui().flyTo({ bounds: bounds(sim.s.segmentOrder.flatMap((id) => sim.s.segments[id].coords)), duration: 1600 });
const r3Case = (sim: Sim) => sim.s.caseOrder.map((c) => sim.s.cases[c]).find((c) => sim.s.incidents[c.incidentId].robotId === "R-003");
const r6Alert = (sim: Sim) => sim.s.alertOrder.map((a) => sim.s.alerts[a]).find((a) => a.robotId === "R-006" && a.ruleId === "battery-low");

export const SCENES: Scene[] = [
  {
    id: "wake", title: "City wakes up", minMs: 9000,
    narrative: "It is 09:56 in Halifax's South End. Early routes (R-001, R-002, R-004) already ran. At 10:00 four more cleaning windows open: watch R-003, R-005, R-006 and R-007 leave their docking stations and drive real streets to their first segments.",
    enter(sim) {
      ui().navigate("command");
      ui().select(null);
      ui().follow(null);
      simStore().setSpeed(1);
      simStore().setRunning(true);
      fitAll(sim);
    },
    ready: (sim) => sim.s.t >= H(10, 4),
  },
  {
    id: "clean", title: "Intelligent cleaning", minMs: 13000,
    narrative: "Each robot sweeps the curb lane one segment at a time. The part of the street behind it turns green, the rest stays cyan, and coverage, waste collected and battery all update from the same simulation state.",
    enter() {
      simStore().setSpeed(1);
      ui().select({ kind: "robot", id: "R-005" });
    },
    ready: (sim) => sim.s.t >= H(10, 20),
  },
  {
    id: "obstacle", title: "Obstacle detected", minMs: 7000,
    narrative: "10:24: R-003 meets a parked car on Pepperell Street during the street's 10:00-12:00 cleaning window. It stops, captures camera evidence, reads the synthetic test plate and checks the posted parking restriction for that block.",
    enter(sim) {
      simStore().setSpeed(1);
      ui().select({ kind: "robot", id: "R-003" });
      ui().follow("R-003");
      ui().flyTo({ center: sim.s.robots["R-003"].pos, zoom: 16.4, duration: 1400 });
    },
    onTick(sim) {
      const c = r3Case(sim);
      if (c && sim.s.t >= (c.stages[4] ?? Infinity) && ui().selection?.kind !== "incident") {
        ui().select({ kind: "incident", id: c.incidentId });
      }
    },
    ready: (sim) => {
      const c = r3Case(sim);
      return !!c && sim.s.t >= (c.stages[4] ?? Infinity) + 20;
    },
  },
  {
    id: "enforce", title: "Enforcement review", minMs: 4000,
    narrative: "CIVIC created a review case, not a ticket. A parked car is only a referral if a posted restriction applies, and a person decides. Review the evidence, correct the plate if needed, then approve and route it to Municipal Parking Enforcement (simulated: nothing leaves this app). The demo waits for your decision.",
    enter(sim) {
      simStore().setRunning(false);
      ui().follow(null);
      ui().select(null);
      const c = r3Case(sim);
      if (c) ui().navigate("incidents", c.id);
    },
    waitForUser: (sim) => {
      const c = r3Case(sim);
      return !!c && c.status !== "awaiting_review" && c.status !== "approved";
    },
    onTick(sim) {
      const c = r3Case(sim);
      if (c && ["forwarded", "acknowledged", "rejected", "insufficient_evidence"].includes(c.status) && !simStore().running) simStore().setRunning(true);
    },
  },
  {
    id: "recover", title: "Autonomous recovery", minMs: 12000,
    narrative: "R-003 went around the car and kept cleaning. The 18 m it could not reach is red and kept separate from cleaned road, and the dispatch engine scheduled a revisit for when the car has likely moved. Every recommendation states its reason.",
    enter(sim) {
      ui().navigate("command");
      simStore().setRunning(true);
      simStore().setSpeed(1);
      const c = r3Case(sim);
      if (c) ui().select({ kind: "segment", id: sim.s.incidents[c.incidentId].segmentId });
      ui().flyTo({ center: sim.s.robots["R-003"].pos, zoom: 15.6, duration: 1400 });
    },
  },
  {
    id: "maint", title: "Fleet maintenance", minMs: 16000,
    narrative: "R-006 started the day on a faulty charger. When its battery crosses the configurable 20% rule, CIVIC raises a warning, sends it back to its station and recommends a robot with enough charge to take over its remaining streets.",
    enter(sim) {
      ui().navigate("command");
      ui().select({ kind: "robot", id: "R-006" });
      simStore().setSpeed(r6Alert(sim) ? 1 : 5);
      ui().flyTo({ center: sim.s.robots["R-006"].pos, zoom: 15.4, duration: 1400 });
    },
    onTick(sim, ms) {
      if (r6Alert(sim) && simStore().speed !== 1) {
        simStore().setSpeed(1);
        ui().follow("R-006");
      }
      const rec = sim.s.recOrder.map((r) => sim.s.recommendations[r]).find((r) => r.type === "low_battery_handoff" && r.robotId === "R-006");
      if (rec && rec.status === "open" && ms > 5000 && sim.s.t >= rec.createdAt + 90) {
        simStore().act((x) => x.acceptRecommendation(rec.id));
        toast("Dispatch recommendation accepted (demo)", `${rec.targetRobotId} takes over ${rec.segmentIds?.length} segment(s); R-006 returns to charge`, "success");
      }
    },
    ready: (sim) => {
      const rec = sim.s.recOrder.map((r) => sim.s.recommendations[r]).find((r) => r.type === "low_battery_handoff" && r.robotId === "R-006");
      return !!rec && rec.status === "accepted";
    },
  },
  {
    id: "impact", title: "Citywide impact", minMs: 26000,
    narrative: "One operator, nine robots, 36 street segments on real Halifax streets. Every number here comes from the same simulation that moved the robots.",
    enter(sim) {
      ui().navigate("command");
      ui().select(null);
      ui().follow(null);
      simStore().setSpeed(2);
      fitAll(sim);
    },
  },
];

interface DemoStore {
  active: boolean;
  finished: boolean;
  scene: number;
  autoplay: boolean;
  sceneStart: number;
  snapshots: (SimState | null)[];
  pre: {
    state: SimState; frames: Frame[]; preset: PresetId;
    running: boolean; speed: 1 | 2 | 5; page: PageId; param: string | null;
  } | null;
  start: () => Promise<void>;
  stop: () => void;
  goto: (i: number, opts?: { restore?: boolean }) => void;
  next: () => void;
  prev: () => void;
  restart: () => Promise<void>;
  setAutoplay: (v: boolean) => void;
  skipTo: (id: "enforce" | "maint") => Promise<void>;
}

const setDemoFlag = (v: boolean) => ((window as unknown as { __civicDemo?: boolean }).__civicDemo = v);

export const useDemo = create<DemoStore>((set, get) => ({
  active: false,
  finished: false,
  scene: 0,
  autoplay: true,
  sceneStart: 0,
  snapshots: [],
  pre: null,

  async start() {
    const st = simStore();
    if (st.sim) {
      const { page, param } = ui();
      set({ pre: {
        state: structuredClone(st.sim.s), frames: st.recorder.frames.slice(), preset: st.presetId,
        running: st.running, speed: st.speed, page, param,
      } });
    }
    setDemoFlag(true);
    await st.init("core", { fresh: true });
    set({ active: true, snapshots: [], autoplay: true });
    get().goto(0);
  },

  stop() {
    const pre = get().pre;
    set({ active: false, pre: null, snapshots: [] });
    setDemoFlag(false);
    ui().follow(null);
    ui().select(null);
    if (pre) {
      simStore().replaceState(pre.state, pre.frames, pre.preset);
      simStore().setSpeed(pre.speed);
      simStore().setRunning(pre.running);
      ui().navigate(pre.page, pre.param);
    }
  },

  goto(i, opts = {}) {
    const sim = simStore().sim;
    if (!sim || i < 0 || i >= SCENES.length) return;
    const snaps = get().snapshots.slice();
    if (opts.restore && snaps[i]) {
      useSim.getState().replaceState(snaps[i]!, useSim.getState().recorder.frames);
    } else {
      snaps[i] = structuredClone(sim.s);
    }
    set({ scene: i, sceneStart: performance.now(), snapshots: snaps, finished: false });
    SCENES[i].enter(simStore().sim!);
  },

  next() {
    const i = get().scene;
    const sim = simStore().sim;
    const scene = SCENES[i];
    if (!sim || (scene.waitForUser && !scene.waitForUser(sim))) return;
    if (scene.id === "obstacle" && !scene.ready?.(sim)) return;
    if (i < SCENES.length - 1) get().goto(i + 1);
  },

  prev() {
    const i = get().scene;
    if (i > 0 && get().snapshots[i - 1]) get().goto(i - 1, { restore: true });
  },

  async restart() {
    await simStore().init("core", { fresh: true });
    set({ snapshots: [], autoplay: true });
    get().goto(0);
  },

  setAutoplay: (autoplay) => set({ autoplay }),

  async skipTo(id) {
    await simStore().init("core", { fresh: true });
    const sim = simStore().sim!;
    set({ snapshots: [] });
    if (id === "enforce") {
      const pred = (s: SimState) => {
        const c = s.caseOrder.map((x) => s.cases[x]).find((x) => s.incidents[x.incidentId].robotId === "R-003");
        return !!c && s.t >= (c.stages[4] ?? Infinity) + 10;
      };
      while (!pred(sim.s) && sim.s.t < H(12)) simStore().fastForward(30);
      get().goto(SCENES.findIndex((s) => s.id === "enforce"));
    } else {
      const pred = (s: SimState) => s.alertOrder.some((a) => s.alerts[a].robotId === "R-006" && s.alerts[a].ruleId === "battery-low");
      while (!pred(sim.s) && sim.s.t < H(13)) simStore().fastForward(30);
      get().goto(SCENES.findIndex((s) => s.id === "maint"));
    }
  },
}));

// Autoplay driver
if (typeof window !== "undefined") {
  window.setInterval(() => {
    const d = useDemo.getState();
    const sim = simStore().sim;
    if (!d.active || d.finished || !sim) return;
    const scene = SCENES[d.scene];
    const ms = performance.now() - d.sceneStart;
    scene.onTick?.(sim, ms);
    if (!d.autoplay) return;
    if (scene.waitForUser && !scene.waitForUser(sim)) return;
    if (ms < scene.minMs) return;
    if (scene.ready && !scene.ready(sim)) return;
    if (d.scene < SCENES.length - 1) d.next();
    else {
      simStore().setRunning(false);
      useDemo.setState({ finished: true });
    }
  }, 400);
}
