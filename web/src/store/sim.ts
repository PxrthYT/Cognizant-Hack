// One live simulation shared by every page. The engine is mutable; React re-renders
// on a throttled `tick`, and the map subscribes to every animation frame.
import { create } from "zustand";
import { buildInitialState, DEMO_START, loadPreset, type PresetId } from "@/sim/dataset";
import { Sim } from "@/sim/engine";
import { Recorder, type Frame } from "@/sim/replay";
import type { SimState } from "@/sim/types";

export const SIM_SECONDS_PER_REAL = 60; // 1× = one simulated minute per real second
const SAVE_KEY = "civic.sim.v3";
const FRAMES_KEY = "civic.frames.v3";

type FrameListener = () => void;
const frameListeners = new Set<FrameListener>();
export function onSimFrame(cb: FrameListener) {
  frameListeners.add(cb);
  return () => frameListeners.delete(cb);
}

interface SimStore {
  sim: Sim | null;
  presetId: PresetId;
  loading: boolean;
  running: boolean;
  speed: 1 | 2 | 5;
  tick: number;
  recorder: Recorder;
  restoredFromStorage: boolean;
  init: (presetId?: PresetId, opts?: { fresh?: boolean; startAt?: number }) => Promise<void>;
  setRunning: (v: boolean) => void;
  setSpeed: (v: 1 | 2 | 5) => void;
  /** Run an operator action against the engine and refresh the UI. */
  act: <T>(fn: (sim: Sim) => T) => T | undefined;
  bump: () => void;
  replaceState: (state: SimState, frames?: Frame[], presetId?: PresetId) => void;
  fastForward: (seconds: number) => void;
}

function fastForwardWithFrames(sim: Sim, rec: Recorder, until: number) {
  rec.record(sim);
  while (sim.s.t < until) {
    sim.advance(Math.min(60, until - sim.s.t));
    rec.record(sim);
  }
}

export const useSim = create<SimStore>((set, get) => ({
  sim: null,
  presetId: "core",
  loading: true,
  running: true,
  speed: 1,
  tick: 0,
  recorder: new Recorder(),
  restoredFromStorage: false,

  async init(presetId = get().presetId, opts = {}) {
    set({ loading: true });
    const preset = await loadPreset(presetId);
    const rec = new Recorder();
    let restored = false;
    let sim: Sim | null = null;
    if (!opts.fresh && presetId === "core") {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { presetId: string; state: SimState };
          if (saved.presetId === presetId && saved.state?.version === 1) {
            sim = new Sim(saved.state);
            const frames = JSON.parse(localStorage.getItem(FRAMES_KEY) ?? "[]") as Frame[];
            rec.frames = frames;
            restored = true;
          }
        }
      } catch {
        sim = null;
      }
    }
    if (!sim) {
      sim = new Sim(buildInitialState(preset, presetId));
      fastForwardWithFrames(sim, rec, opts.startAt ?? DEMO_START);
    }
    set({ sim, presetId, recorder: rec, loading: false, restoredFromStorage: restored, tick: get().tick + 1 });
  },

  setRunning: (running) => set({ running }),
  setSpeed: (speed) => set({ speed }),

  act(fn) {
    const sim = get().sim;
    if (!sim) return undefined;
    const out = fn(sim);
    get().recorder.record(sim, true);
    set({ tick: get().tick + 1 });
    saveSoon();
    return out;
  },

  bump: () => set({ tick: get().tick + 1 }),

  replaceState(state, frames, presetId = get().presetId) {
    const sim = new Sim(structuredClone(state));
    const rec = new Recorder();
    if (frames) rec.frames = frames.filter((f) => f.t <= state.t);
    rec.record(sim, true);
    set({ sim, presetId, recorder: rec, tick: get().tick + 1 });
  },

  fastForward(seconds) {
    const { sim, recorder } = get();
    if (!sim) return;
    fastForwardWithFrames(sim, recorder, sim.s.t + seconds);
    set({ tick: get().tick + 1 });
  },
}));

// ---------------------------------------------------------------- loop
let last = performance.now();
let lastUi = 0;
let lastSave = 0;
let clockSim: Sim | null = null;
let secondsDue = 0;
function loop(now: number) {
  const dtReal = Math.min(1, (now - last) / 1000);
  last = now;
  const st = useSim.getState();
  const sim = st.sim;
  if (sim !== clockSim) {
    clockSim = sim;
    secondsDue = 0;
  }
  if (sim && st.running && !st.loading && sim.s.t < sim.s.dayEnd) {
    secondsDue += dtReal * SIM_SECONDS_PER_REAL * st.speed;
    const seconds = Math.min(Math.floor(secondsDue), sim.s.dayEnd - sim.s.t);
    if (seconds > 0) {
      secondsDue -= seconds;
      sim.advance(seconds);
      st.recorder.record(sim);
      frameListeners.forEach((cb) => cb());
    }
    if (now - lastUi > 200) {
      lastUi = now;
      useSim.setState({ tick: st.tick + 1 });
    }
    if (now - lastSave > 8000) {
      lastSave = now;
      save();
    }
  } else if (sim && sim.s.t >= sim.s.dayEnd && st.running) {
    useSim.setState({ running: false });
  }
  requestAnimationFrame(loop);
}
if (typeof window !== "undefined") {
  requestAnimationFrame(loop);
  window.addEventListener("pagehide", save);
}

let saveTimer: number | undefined;
function saveSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 500);
}

export function save() {
  const { sim, presetId, recorder } = useSim.getState();
  if (!sim || presetId !== "core") return;
  if ((window as unknown as { __civicDemo?: boolean }).__civicDemo) return; // demo runs aren't persisted
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ presetId, state: sim.s }));
    localStorage.setItem(FRAMES_KEY, JSON.stringify(recorder.toJSON(2)));
  } catch {
    /* storage full or blocked: the app keeps running without persistence */
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(FRAMES_KEY);
  } catch {
    /* ignore */
  }
}

/** Re-render a component on every UI tick and return the engine. */
export function useEngine(): Sim {
  useSim((s) => s.tick);
  return useSim.getState().sim!;
}
