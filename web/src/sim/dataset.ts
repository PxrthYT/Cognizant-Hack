import graphJson from "@/data/graph.json";
import coreJson from "@/data/core.json";
import { RoadGraph } from "./graph";
import { convexHull, cumulative, padPolygon } from "./geo";
import { seeded, syntheticPlate } from "./rng";
import type {
  AlertRule, CleaningZone, LngLat, Mission, ParkedVehicle, Robot, ScriptedEvent, SimState, Station, StreetSegment,
} from "./types";

export interface PresetJson {
  name: string;
  attribution: string;
  stations: { id: string; name: string; district: string; node: number; bays: number }[];
  robots: { id: string; station: string; segments: string[] }[];
  segments: { id: string; name: string; street: string; nodes: number[]; robot: string; station: string; district: string; length_m: number }[];
}

export const PRESETS = {
  core: { id: "core", label: "Halifax · South End", detail: "3 stations · 9 robots · 36 segments" },
  metro: { id: "metro", label: "Halifax · Peninsula (scale)", detail: "20 stations · 100 robots · 428 segments" },
} as const;
export type PresetId = keyof typeof PRESETS;

const g = graphJson as unknown as { attribution: string; coords: LngLat[]; edges: [number, number][] };
export const graph = new RoadGraph(g.coords, g.edges);
export const MAP_ATTRIBUTION = g.attribution;

export const LOCAL_STREETS: GeoJSON.Feature<GeoJSON.MultiLineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "MultiLineString", coordinates: g.edges.map(([a, b]) => [g.coords[a], g.coords[b]]) },
};

export async function loadPreset(id: PresetId): Promise<PresetJson> {
  if (id === "core") return coreJson as unknown as PresetJson;
  const mod = await import("@/data/metro.json");
  return mod.default as unknown as PresetJson;
}

export const H = (h: number, m = 0) => h * 3600 + m * 60;
export const DAY_START = H(6);
export const DAY_END = H(22);
export const DEMO_START = H(9, 56);

export const DEFAULT_RULES: AlertRule[] = [
  { id: "battery-low", name: "Low battery", metric: "battery", op: "<", threshold: 20, clearMargin: 15, severity: "warning",
    message: "{robot} battery at {value}% (threshold {threshold}%)", recommendation: "Return to station to charge; hand remaining segments to an available robot",
    action: "return_to_station", enabled: true },
  { id: "bin-full", name: "Waste bin nearly full", metric: "binFill", op: ">", threshold: 85, clearMargin: 25, severity: "warning",
    message: "{robot} waste bin at {value}% (threshold {threshold}%)", recommendation: "Return to station to empty the bin",
    action: "return_to_station", enabled: true },
  { id: "brush-wear", name: "Brush wear high", metric: "brushWear", op: ">", threshold: 80, clearMargin: 20, severity: "warning",
    message: "{robot} main brush worn {value}% (threshold {threshold}%)", recommendation: "Schedule brush replacement at next dock",
    action: "schedule_maintenance", enabled: true },
  { id: "motor-temp", name: "Motor temperature high", metric: "motorTemp", op: ">", threshold: 75, clearMargin: 10, severity: "critical",
    message: "{robot} brush motor at {value} °C (threshold {threshold} °C)", recommendation: "Pause cleaning so the motor can cool; inspect if it recurs",
    action: "pause", enabled: true },
  { id: "link-lost", name: "Connectivity lost", metric: "connectivity", op: "<", threshold: 15, clearMargin: 40, severity: "critical",
    message: "{robot} link quality {value}% - telemetry is stale", recommendation: "Robot marked offline and holds position until the link recovers",
    action: "mark_offline", enabled: true },
  { id: "battery-health", name: "Battery health degraded", metric: "batteryHealth", op: "<", threshold: 80, clearMargin: 5, severity: "info",
    message: "{robot} battery holds {value}% of original capacity", recommendation: "Plan battery pack replacement",
    action: "schedule_maintenance", enabled: true },
  { id: "localization", name: "Localization confidence low", metric: "localization", op: "<", threshold: 0.6, clearMargin: 0.15, severity: "warning",
    message: "{robot} localization confidence {value}", recommendation: "Reduce speed and verify position against the map",
    action: "none", enabled: true },
];

interface RobotProfile {
  window: [number, number];
  battery?: number;
  batteryHealth?: number;
  brushWear?: number;
  binFill?: number;
}

// Hand-tuned conditions for the 9-robot demo so each tells a story.
const CORE_PROFILES: Record<string, RobotProfile> = {
  "R-001": { window: [H(6, 30), H(10, 30)] },
  "R-002": { window: [H(7), H(11)], brushWear: 78 },
  "R-003": { window: [H(10), H(14)] },
  "R-004": { window: [H(8), H(12)], batteryHealth: 77 },
  "R-005": { window: [H(10), H(13)] },
  "R-006": { window: [H(10), H(14)], battery: 41 },
  "R-007": { window: [H(10), H(14)] },
  "R-008": { window: [H(12), H(16)] },
  "R-009": { window: [H(18, 30), H(22)], binFill: 12 },
};
const CORE_INACTIVE = new Set(["Lilac Street", "Jennings Street", "Bliss Street", "Lucknow Street"]);
const CORE_UNSIGNED = new Set(["Carlton Street", "Brenton Street"]);
const METRO_SLOTS: [number, number][] = [[H(7), H(11)], [H(9), H(13)], [H(10), H(14)], [H(12), H(16)], [H(18), H(22)]];

function fmtHM(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function buildInitialState(preset: PresetJson, presetId: PresetId, seed = 2026): SimState {
  const R = seeded(seed);
  const isCore = presetId === "core";
  const segments: Record<string, StreetSegment> = {};
  const robots: Record<string, Robot> = {};
  const stations: Record<string, Station> = {};
  const zones: Record<string, CleaningZone> = {};
  const missions: Record<string, Mission> = {};

  const robotWindow: Record<string, [number, number]> = {};
  for (const r of preset.robots) {
    robotWindow[r.id] = isCore ? CORE_PROFILES[r.id]?.window ?? [H(9), H(13)] : R.pick(METRO_SLOTS);
  }

  for (const s of preset.segments) {
    const coords = s.nodes.map((n) => graph.coords[n]);
    const cum = cumulative(coords);
    const scheduled = isCore ? !CORE_INACTIVE.has(s.street) : R.chance(0.86);
    let win = robotWindow[s.robot];
    if (isCore && s.robot === "R-003") {
      win = s.street === "Pepperell Street" || s.street === "Shirley Street" ? [H(10), H(12)] : [H(11), H(14)];
    }
    const lastDays = scheduled ? 7 : R.int(1, 6);
    const signed = isCore ? !CORE_UNSIGNED.has(s.street) : R.chance(0.9);
    segments[s.id] = {
      id: s.id, name: s.name, street: s.street, nodes: s.nodes, coords, cum, length: cum[cum.length - 1],
      robotId: s.robot, stationId: s.station, zoneId: `Z-${s.robot.slice(2)}`, district: s.district,
      scheduled, window: { start: win[0], end: win[1] }, cleaned: [], blocked: [],
      cleaningStartedAt: null, cleanedAt: null,
      lastCleanedAt: -lastDays * 86400 + win[0] + R.int(20, 160) * 60,
      nextCleaning: scheduled ? win[0] : (7 - lastDays) * 86400 + win[0],
      debris: s.street === "Spring Garden Road" ? 0.92 : Math.round(R.range(0.25, 0.85) * 100) / 100,
      priority: s.street === "Spring Garden Road" || s.street === "Quinpool Road" ? "priority" : "routine",
      incidentIds: [],
      restriction: {
        signed, start: win[0], end: win[1],
        label: signed ? `No parking ${fmtHM(win[0])}-${fmtHM(win[1])} on cleaning days` : "No posted cleaning restriction",
      },
    };
  }

  for (const st of preset.stations) {
    const pos = graph.coords[st.node];
    stations[st.id] = {
      id: st.id, name: st.name, district: st.district, node: st.node, pos, bays: st.bays,
      baysOutOfService: 0, power: "normal", warnings: [], zoneIds: [],
    };
  }
  if (isCore) {
    stations["ST-02"].power = "solar-assist";
    stations["ST-02"].warnings = ["Bay 2 charger fault since 04:10 - R-006 left on partial charge; electrician ETA 11:00"];
    stations["ST-03"].bays = 3;
    stations["ST-03"].baysOutOfService = 1;
    stations["ST-03"].power = "degraded";
    stations["ST-03"].warnings = ["Bay 3 charger offline - technician booked 15:00"];
  } else {
    for (const st of Object.values(stations)) if (R.chance(0.15)) {
      st.baysOutOfService = 1;
      st.warnings = ["One charger offline - work order open"];
    }
  }

  const t0 = DAY_START;
  for (const r of preset.robots) {
    const prof: RobotProfile = isCore ? CORE_PROFILES[r.id] : { window: robotWindow[r.id] };
    const st = stations[r.station];
    const zoneId = `Z-${r.id.slice(2)}`;
    st.zoneIds.push(zoneId);
    const pts = r.segments.flatMap((sid) => segments[sid].coords);
    zones[zoneId] = {
      id: zoneId, name: `${r.id} zone`, robotId: r.id, stationId: r.station, district: st.district,
      polygon: padPolygon(convexHull(pts), 28),
    };
    robots[r.id] = {
      id: r.id, model: "CIVIC CS-2 curbside unit", stationId: r.station, zoneId,
      status: "idle", pos: st.pos, heading: 0, route: null, queue: [], missionId: null, currentSegmentId: null,
      telemetry: {
        battery: prof.battery ?? 100,
        batteryHealth: prof.batteryHealth ?? Math.round(R.range(86, 98)),
        binFill: prof.binFill ?? 0,
        brushWear: prof.brushWear ?? Math.round(R.range(12, 55)),
        motorTemp: 18,
        motorLoad: 0,
        connectivity: 94,
        localization: 0.97,
        sensorHealth: Math.round(R.range(94, 100)),
      },
      lastTelemetryAt: t0, history: [], faults: [],
      distanceTodayM: 0, cleanedTodayM: 0, wasteTodayKg: 0, operatingSecondsToday: 0,
      odometerKm: Math.round(R.range(600, 2400)), operatingHoursTotal: Math.round(R.range(300, 1300)),
      lastMaintenance: -R.int(4, 26) * 86400, nextService: R.int(4, 24) * 86400,
      speedClean: Math.round(R.range(0.33, 0.38) * 100) / 100, dataSource: "simulated",
    };
    const segIds = r.segments.filter((sid) => segments[sid].scheduled);
    if (segIds.length) {
      const start = Math.min(...segIds.map((s) => segments[s].window.start));
      const end = Math.max(...segIds.map((s) => segments[s].window.end));
      const mid = `M-${r.id.slice(2)}01`;
      missions[mid] = {
        id: mid, name: `${st.district} routine · ${r.id}`, kind: "routine", robotId: r.id, stationId: r.station,
        segmentIds: segIds, window: { start, end }, priority: segIds.some((s) => segments[s].priority === "priority") ? "priority" : "routine",
        status: "scheduled", createdBy: "Scheduler", createdAt: -86400 + H(16),
      };
    }
  }
  if (isCore) {
    robots["R-006"].chargeFaultUntil = H(11);
    robots["R-004"].lastMaintenance = -41 * 86400;
    robots["R-004"].nextService = -3 * 86400;
  }

  // Cars parked along the curb (ground truth the robots may or may not meet)
  const parked: ParkedVehicle[] = [];
  const colors = ["Grey", "Black", "White", "Silver", "Blue", "Red", "Green"];
  const bodies = ["sedan", "SUV", "hatchback", "pickup", "minivan"];
  const addCar = (segId: string, frac: number, arrives: number, leaves: number, ocr = R.range(0.86, 0.97)) => {
    const seg = segments[segId];
    const plate = syntheticPlate(R.next);
    let ocrPlate = plate;
    if (ocr < 0.8) ocrPlate = plate.slice(0, 5) + (plate[5] === "8" ? "3" : "8") + plate.slice(6); // a misread digit
    parked.push({
      id: `PV-${parked.length + 1}`, segmentId: segId, alongM: seg.length * frac,
      vehicle: { plate, color: R.pick(colors), body: R.pick(bodies) },
      arrives, leaves, detected: false, vehicleConfidence: Math.round(R.range(0.9, 0.99) * 100) / 100,
      ocrConfidence: Math.round(ocr * 100) / 100, ocrPlate,
    });
  };
  const byName = (name: string) => Object.values(segments).find((s) => s.name === name)?.id;
  if (isCore) {
    const carlton = byName("Carlton Street");
    const tower = byName("Tower Road (north)");
    const college = byName("College Street");
    const henry = byName("Henry Street");
    const morris = byName("Morris Street");
    if (carlton) addCar(carlton, 0.55, H(7), H(15));                    // no posted restriction: obstruction only
    if (tower) addCar(tower, 0.4, H(9), H(13, 30), 0.71);              // misread plate: needs OCR correction
    if (college) addCar(college, 0.5, H(8), H(12, 15));
    if (henry) addCar(henry, 0.35, H(6, 30), H(9, 10));
    if (morris) addCar(morris, 0.62, H(11), H(17));
  } else {
    const ids = Object.keys(segments).filter((s) => segments[s].scheduled);
    for (let i = 0; i < 45; i++) addCar(R.pick(ids), R.range(0.2, 0.8), H(R.int(6, 12)), H(R.int(13, 21)), R.range(0.7, 0.97));
  }

  const scripted: ScriptedEvent[] = isCore
    ? [
        { id: "SC-1", at: H(10, 24), kind: "obstacle_ahead", robotId: "R-003", done: false },
        { id: "SC-2", at: H(12, 10), kind: "motor_fault", robotId: "R-007", done: false },
        { id: "SC-3", at: H(12, 40), kind: "connectivity_drop", robotId: "R-008", params: { minutes: 7 }, done: false },
      ]
    : [];

  const robotOrder = preset.robots.map((r) => r.id);
  const missionOrder = Object.keys(missions);
  return {
    version: 1, presetId, presetName: preset.name, seed, dayStart: DAY_START, dayEnd: DAY_END, t: t0, rng: seed * 7919,
    robots, robotOrder, stations, segments, segmentOrder: preset.segments.map((s) => s.id), zones,
    missions, missionOrder, incidents: {}, incidentOrder: [], cases: {}, caseOrder: [],
    alerts: {}, alertOrder: [], recommendations: {}, recOrder: [], rules: DEFAULT_RULES.map((r) => ({ ...r })),
    events: [], parked, scripted, counters: {}, lastRuleEval: 0, lastDispatchEval: 0, lastSample: 0,
    operator: "Duty Supervisor",
  };
}
