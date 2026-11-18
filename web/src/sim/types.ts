// Core data model for the CIVIC simulation. Everything here is plain data so the
// whole state can be cloned (demo scenes, replay) and persisted (localStorage).

export type LngLat = [number, number];

/** Seconds since local midnight of the operational day. Negative = previous days. */
export type SimTime = number;

export type RobotStatus =
  | "cleaning"
  | "navigating"
  | "idle"
  | "charging"
  | "returning"
  | "blocked"
  | "paused"
  | "maintenance"
  | "offline";

export type SegmentStatus = "inactive" | "scheduled" | "cleaning" | "cleaned" | "blocked";

export type Severity = "info" | "warning" | "critical";

export interface Telemetry {
  battery: number;          // %
  batteryHealth: number;    // % of original capacity
  binFill: number;          // %
  brushWear: number;        // %
  motorTemp: number;        // °C
  motorLoad: number;        // %
  connectivity: number;     // % link quality
  localization: number;     // 0..1 confidence
  sensorHealth: number;     // %
}

export interface TelemetrySample {
  t: SimTime;
  battery: number;
  binFill: number;
  motorTemp: number;
  motorLoad: number;
  connectivity: number;
}

/** A path the robot is currently driving. */
export interface Route {
  kind: "transit" | "clean";
  coords: LngLat[];
  cum: number[];            // cumulative metres at each coord
  length: number;
  progress: number;         // metres driven along this route
  cursor: number;           // index hint for fast interpolation
  segmentId?: string;       // clean: segment being cleaned; transit: destination segment
  /** clean only: segment position (m along the segment's own geometry) at route start/end */
  segFrom?: number;
  segTo?: number;
  dest: "segment" | "station";
  stationId?: string;
}

export interface Fault {
  code: string;
  text: string;
  severity: Severity;
  t: SimTime;
}

export interface Robot {
  id: string;
  model: string;
  stationId: string;
  zoneId: string;
  status: RobotStatus;
  prevStatus?: RobotStatus;        // to resume after pause / offline
  pos: LngLat;
  heading: number;                 // degrees, 0 = north
  route: Route | null;
  queue: CleanTask[];              // remaining work, in order
  missionId: string | null;
  currentSegmentId: string | null;
  telemetry: Telemetry;
  lastTelemetryAt: SimTime;        // telemetry is stale while offline
  history: TelemetrySample[];
  faults: Fault[];
  holdUntil?: SimTime;             // blocked / evidence capture / bin emptying
  chargeFaultUntil?: SimTime;      // its charging bay is faulty until then
  holdReason?: string;
  offlineUntil?: SimTime;
  returnReason?: string;
  maintenanceFlag?: string;        // operator-flagged
  distanceTodayM: number;
  cleanedTodayM: number;
  wasteTodayKg: number;
  operatingSecondsToday: number;
  odometerKm: number;
  operatingHoursTotal: number;
  lastMaintenance: SimTime;
  nextService: SimTime;
  speedClean: number;              // m/s
  dataSource: "simulated" | "live";
}

/** One unit of cleaning work: drive segment from `from` to `to` metres along its geometry. */
export interface CleanTask {
  segmentId: string;
  from: number;
  to: number;
  missionId: string;
  revisit?: boolean;
}

export interface Interval {
  from: number;
  to: number;
}

export interface BlockedRange extends Interval {
  incidentId: string;
  resolved: boolean;
}

export interface ParkingRestriction {
  signed: boolean;                 // sign posted at the location
  label: string;                   // e.g. "No parking Tue 10:00-12:00 (street cleaning)"
  start: SimTime;
  end: SimTime;
}

export interface StreetSegment {
  id: string;
  name: string;
  street: string;
  nodes: number[];
  coords: LngLat[];
  cum: number[];
  length: number;
  robotId: string;
  stationId: string;
  zoneId: string;
  district: string;
  scheduled: boolean;              // scheduled for today
  window: { start: SimTime; end: SimTime };
  cleaned: Interval[];             // merged, metres along geometry
  blocked: BlockedRange[];
  cleaningStartedAt: SimTime | null;
  cleanedAt: SimTime | null;       // fully done today
  lastCleanedAt: SimTime;          // most recent completed clean (may be previous days)
  nextCleaning: SimTime;
  debris: number;                  // estimated debris load 0..1 (1 = heavy)
  priority: "routine" | "priority";
  incidentIds: string[];
  restriction: ParkingRestriction;
}

export interface CleaningZone {
  id: string;
  name: string;
  robotId: string;
  stationId: string;
  district: string;
  polygon: LngLat[];
}

export interface Station {
  id: string;
  name: string;
  district: string;
  node: number;
  pos: LngLat;
  bays: number;
  baysOutOfService: number;
  power: "normal" | "solar-assist" | "degraded";
  warnings: string[];
  zoneIds: string[];
}

export type MissionStatus = "scheduled" | "active" | "paused" | "completed" | "partial" | "cancelled";

export interface Mission {
  id: string;
  name: string;
  kind: "routine" | "revisit" | "reassignment" | "operator";
  robotId: string;
  stationId: string;
  segmentIds: string[];
  window: { start: SimTime; end: SimTime };
  priority: "routine" | "priority";
  status: MissionStatus;
  createdBy: string;
  createdAt: SimTime;
  completedAt?: SimTime;
  note?: string;
}

export interface Vehicle {
  plate: string;                   // synthetic test plate
  color: string;
  body: string;
}

export interface Evidence {
  image: string;                   // asset path or data URL
  source: "simulated" | "camera";
  note: string;
  syntheticPlate?: string;
}

export interface Incident {
  id: string;
  type: "parked_vehicle";
  t: SimTime;
  robotId: string;
  segmentId: string;
  pos: LngLat;
  alongM: number;
  vehicle: Vehicle;
  vehicleConfidence: number;
  ocrConfidence: number;
  evidence: Evidence;
  plateSource: "ocr-simulated" | "manual";
  caseId: string | null;
  revisitMissionId: string | null;
  resolved: boolean;
}

export type CaseStatus =
  | "awaiting_review"
  | "approved"
  | "forwarded"
  | "acknowledged"
  | "rejected"
  | "insufficient_evidence"
  | "no_violation";

export interface AuditEntry {
  t: SimTime;
  actor: string;
  action: string;
  detail?: string;
}

export interface RestrictionCheck {
  restriction: string;
  signed: boolean;
  withinWindow: boolean;
  applies: boolean;
  reason: string;
}

export interface EnforcementCase {
  id: string;
  incidentId: string;
  status: CaseStatus;
  plate: string;
  originalPlate: string;
  department: string;
  check: RestrictionCheck;
  /** sim time each workflow stage completed (index = WORKFLOW_STAGES); null = not yet */
  stages: (SimTime | null)[];
  evidenceReviewed: boolean;
  audit: AuditEntry[];
  createdAt: SimTime;
}

export type Metric = keyof Telemetry;

export interface AlertRule {
  id: string;
  name: string;
  metric: Metric;
  op: "<" | ">";
  threshold: number;
  clearMargin: number;             // hysteresis before the alert clears
  severity: Severity;
  message: string;                 // template: {robot} {value} {threshold}
  recommendation: string;
  action: "return_to_station" | "pause" | "schedule_maintenance" | "mark_offline" | "none";
  enabled: boolean;
}

export interface MaintenanceAlert {
  id: string;
  ruleId: string;
  robotId: string;
  severity: Severity;
  message: string;
  recommendation: string;
  action: AlertRule["action"];
  value: number;
  openedAt: SimTime;
  resolvedAt: SimTime | null;
  acknowledged: boolean;
}

export type RecommendationType = "low_battery_handoff" | "blocked_defer" | "early_finish" | "station_capacity";

export interface Recommendation {
  id: string;
  type: RecommendationType;
  title: string;
  reason: string;
  robotId: string;
  targetRobotId?: string;
  segmentIds?: string[];
  stationId?: string;
  createdAt: SimTime;
  status: "open" | "accepted" | "dismissed" | "applied";
}

export type EventKind =
  | "mission" | "cleaning" | "navigation" | "charging" | "alert"
  | "obstruction" | "enforcement" | "dispatch" | "maintenance" | "operator" | "system";

export interface SimEvent {
  id: string;
  t: SimTime;
  kind: EventKind;
  severity: Severity | "success";
  message: string;
  robotId?: string;
  segmentId?: string;
  stationId?: string;
  incidentId?: string;
  caseId?: string;
  missionId?: string;
}

/** Hidden ground truth: cars parked along the curb that robots may meet. */
export interface ParkedVehicle {
  id: string;
  segmentId: string;
  alongM: number;
  vehicle: Vehicle;
  arrives: SimTime;
  leaves: SimTime;
  detected: boolean;
  vehicleConfidence: number;
  ocrConfidence: number;
  ocrPlate: string;                // what the camera reads (may contain an error)
}

export interface ScriptedEvent {
  id: string;
  at: SimTime;
  kind: "obstacle_ahead" | "connectivity_drop" | "motor_fault";
  robotId: string;
  params?: Record<string, number | string>;
  done: boolean;
}

export interface Counters {
  [prefix: string]: number;
}

export interface SimState {
  version: number;
  presetId: string;
  presetName: string;
  seed: number;
  dayStart: SimTime;
  dayEnd: SimTime;
  t: SimTime;
  rng: number;                     // PRNG state
  robots: Record<string, Robot>;
  robotOrder: string[];
  stations: Record<string, Station>;
  segments: Record<string, StreetSegment>;
  segmentOrder: string[];
  zones: Record<string, CleaningZone>;
  missions: Record<string, Mission>;
  missionOrder: string[];
  incidents: Record<string, Incident>;
  incidentOrder: string[];
  cases: Record<string, EnforcementCase>;
  caseOrder: string[];
  alerts: Record<string, MaintenanceAlert>;
  alertOrder: string[];
  recommendations: Record<string, Recommendation>;
  recOrder: string[];
  rules: AlertRule[];
  events: SimEvent[];
  parked: ParkedVehicle[];
  scripted: ScriptedEvent[];
  counters: Counters;
  lastRuleEval: SimTime;
  lastDispatchEval: SimTime;
  lastSample: SimTime;
  operator: string;
}

export const WORKFLOW_STAGES = [
  "Obstruction detected",
  "Camera evidence captured",
  "Licence plate recognized",
  "Restriction validation",
  "Case created",
  "Human review",
  "Department routing",
  "Case status updated",
] as const;
