import { AnimatePresence, motion } from "motion/react";
import {
  Battery, Crosshair, ExternalLink, Gauge as GaugeIcon, MapPin, Pause, Play, Route as RouteIcon, Undo2, Wrench, X,
} from "lucide-react";
import { useState } from "react";
import { bayOf, dockStationOf, fmtT, isDocked } from "@/sim/engine";
import { dist, intervalTotal } from "@/sim/geo";
import { CASE_LABEL, fmtDayTime, robotLocation, robotRouteProgress, staleSeconds } from "@/sim/selectors";
import type { Robot, StreetSegment } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { toast } from "@/store/toast";
import { Button, Dialog, Gauge, KV, Pill, Progress, Tag } from "@/components/ui";
import { CaseStatusPill, RobotStatusPill, SegmentStatusPill, SeverityIcon } from "@/components/common/status";
import { ROBOT_COLOR, SEGMENT_COLOR, maskPlate, pct } from "@/lib/utils";

export function Inspector() {
  const sel = useUi((s) => s.selection);
  const select = useUi((s) => s.select);
  return (
    <AnimatePresence>
      {sel && (
        <motion.aside key={`${sel.kind}:${sel.id}`}
          initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ duration: 0.18 }}
          className="no-print absolute bottom-3 right-3 top-3 z-40 flex w-[372px] flex-col overflow-hidden rounded-xl border border-line-2 bg-panel shadow-[0_20px_60px_-10px_rgba(0,0,0,0.75)]">
          <button type="button" onClick={() => select(null)} className="absolute right-2.5 top-2.5 z-10 rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink" aria-label="Close">
            <X size={15} />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sel.kind === "robot" && <RobotPanel id={sel.id} />}
            {sel.kind === "segment" && <SegmentPanel id={sel.id} />}
            {sel.kind === "station" && <StationPanel id={sel.id} />}
            {sel.kind === "incident" && <IncidentPanel id={sel.id} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Head({ kind, title, sub, right }: { kind: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 pb-3 pt-3.5">
      <div className="label">{kind}</div>
      <div className="mt-0.5 flex items-center gap-2 pr-6">
        <h2 className="truncate text-[16px] font-semibold tracking-tight">{title}</h2>
        {right}
      </div>
      {sub && <div className="mt-1 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="border-b border-line px-4 py-3 last:border-0">
    <div className="mb-1.5 flex items-center"><span className="label">{title}</span><span className="ml-auto">{action}</span></div>
    {children}
  </div>
);

// ------------------------------------------------------------------ robot
export function ReassignDialog({ open, onOpenChange, segmentIds, fromRobot }: { open: boolean; onOpenChange: (v: boolean) => void; segmentIds: string[]; fromRobot?: string }) {
  const sim = useEngine();
  const act = useSim((s) => s.act);
  const s = sim.s;
  const first = segmentIds.length ? s.segments[segmentIds[0]] : null;
  const cands = s.robotOrder.map((id) => s.robots[id]).filter((r) => r.id !== fromRobot)
    .map((r) => ({ r, d: first ? dist(r.pos, first.coords[0]) : 0 }))
    .sort((a, b) => (a.r.stationId === s.robots[fromRobot ?? ""]?.stationId ? -1 : 0) - (b.r.stationId === s.robots[fromRobot ?? ""]?.stationId ? -1 : 0) || a.d - b.d)
    .slice(0, 12);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Reassign route" description={`${segmentIds.length} segment${segmentIds.length === 1 ? "" : "s"}: ${segmentIds.map((id) => s.segments[id].name).join(", ") || "none remaining"}`}>
      <div className="space-y-1.5">
        {cands.map(({ r, d }) => {
          const unavailable = r.status === "offline" || r.status === "maintenance";
          return (
            <button key={r.id} type="button" disabled={unavailable || !segmentIds.length}
              onClick={() => {
                act((x) => x.reassign(segmentIds, r.id));
                toast("Route reassigned", `${segmentIds.length} segment(s) → ${r.id}`, "success");
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left hover:border-accent/50 hover:bg-elevated disabled:opacity-40">
              <span className="mono w-14 text-[12px] font-semibold">{r.id}</span>
              <RobotStatusPill status={r.status} />
              <span className="flex-1 text-[11.5px] text-ink-3">{s.stations[r.stationId].name}</span>
              <span className="num text-[11.5px] text-ink-2">{Math.round(r.telemetry.battery)}%</span>
              <span className="num w-14 text-right text-[11.5px] text-ink-3">{(d / 1000).toFixed(1)} km</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-3">Sorted by same station first, then distance to the first segment. The receiving robot gets a new reassignment mission.</p>
    </Dialog>
  );
}

function RobotPanel({ id }: { id: string }) {
  const sim = useEngine();
  const act = useSim((s) => s.act);
  const { follow, navigate, followRobotId, select } = useUi();
  const [reassign, setReassign] = useState(false);
  const r = sim.s.robots[id];
  if (!r) return null;
  const s = sim.s;
  const T = r.telemetry;
  const stale = r.status === "offline";
  const prog = robotRouteProgress(sim, r);
  const eta = sim.robotEta(r);
  const alerts = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.robotId === id && a.resolvedAt === null);
  const remaining = sim.remainingSegments(r);
  const mission = r.missionId ? s.missions[r.missionId] : s.missionOrder.map((m) => s.missions[m]).find((m) => m.robotId === id && m.status !== "completed");
  return (
    <>
      <Head kind="Robot" title={<span className="mono">{r.id}</span>} right={<RobotStatusPill status={r.status} />}
        sub={<>{r.model} · {s.stations[r.stationId].name}{r.dataSource === "simulated" && <> · <Tag tone="sim">Simulated telemetry</Tag></>}</>} />
      <img src="/assets/robot.jpg" alt="CIVIC CS-2 curbside cleaning robot concept" className="h-32 w-full border-b border-line object-cover" />
      <div className="grid grid-cols-4 gap-1 border-b border-line px-2 py-3">
        <Gauge value={T.battery} label="Battery" color={T.battery < 20 ? "#ef4444" : T.battery < 40 ? "#f59e0b" : "#10b981"} stale={stale} size={78} />
        <Gauge value={T.binFill} label="Bin" color={T.binFill > 85 ? "#f59e0b" : "#22d3ee"} stale={stale} size={78} />
        <Gauge value={T.motorTemp} max={110} unit="°C" label="Motor" color={T.motorTemp > 75 ? "#ef4444" : "#7dd3fc"} stale={stale} size={78} />
        <Gauge value={T.connectivity} label="Link" color={T.connectivity < 15 ? "#ef4444" : "#10b981"} size={78} />
      </div>
      {stale && (
        <div className="mx-4 mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[11.5px] text-[#fca5a5]">
          Offline for {Math.round(staleSeconds(s, r) / 60)} min. Values shown are the last telemetry received at {fmtT(r.lastTelemetryAt)}.
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
        <Button size="xs" variant={followRobotId === id ? "primary" : "secondary"} onClick={() => follow(followRobotId === id ? null : id)}><Crosshair size={12} />{followRobotId === id ? "Following" : "Follow"}</Button>
        {r.status === "paused"
          ? <Button size="xs" variant="success" onClick={() => act((x) => x.resume(id))}><Play size={12} />Resume</Button>
          : <Button size="xs" disabled={isDocked(r) || stale || r.status === "maintenance"} onClick={() => act((x) => x.pause(id))}><Pause size={12} />Pause</Button>}
        <Button size="xs" disabled={isDocked(r) || stale} onClick={() => act((x) => x.operatorReturn(id))}><Undo2 size={12} />Return to station</Button>
        <Button size="xs" disabled={!remaining.length} onClick={() => setReassign(true)}><RouteIcon size={12} />Reassign route</Button>
        <Button size="xs" variant="warn" disabled={!!r.maintenanceFlag} onClick={() => act((x) => x.flagMaintenance(id, "Operator inspection requested"))}><Wrench size={12} />Flag maintenance</Button>
        <Button size="xs" variant="ghost" onClick={() => { navigate("fleet", id); select(null); }}><GaugeIcon size={12} />Diagnostics<ExternalLink size={11} /></Button>
      </div>
      {alerts.length > 0 && (
        <Section title={`Open alerts (${alerts.length})`}>
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <div key={a.id} className="rounded-md border border-line bg-panel-2 px-2.5 py-2">
                <div className="flex items-start gap-2 text-[12px]"><SeverityIcon severity={a.severity} />{a.message}</div>
                <div className="mt-1 pl-6 text-[11px] text-ink-3">Recommended: {a.recommendation}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Operations">
        <KV k="Location" v={robotLocation(sim, r)} />
        <KV k="Mission" v={mission ? mission.name : "None"} />
        <KV k="Current segment" v={r.currentSegmentId ? s.segments[r.currentSegmentId].name : "-"} />
        {r.holdReason && <KV k="Holding" v={r.holdReason} />}
        {r.returnReason && r.status === "returning" && <KV k="Returning because" v={r.returnReason} />}
        <div className="py-2">
          <div className="mb-1 flex justify-between text-[11.5px]"><span className="text-ink-3">Route completion</span><span className="num">{pct(prog.pct)} · {(prog.done / 1000).toFixed(2)} / {(prog.total / 1000).toFixed(2)} km</span></div>
          <Progress value={prog.pct} color="#10b981" />
        </div>
        <KV k="Est. mission completion" v={eta ? fmtT(eta) : "Done for today"} />
        <KV k="Distance today" v={`${(r.distanceTodayM / 1000).toFixed(2)} km`} />
        <KV k="Waste collected today" v={`${r.wasteTodayKg.toFixed(1)} kg`} />
        <KV k="Operating hours (total)" v={`${Math.round(r.operatingHoursTotal + r.operatingSecondsToday / 3600)} h`} />
      </Section>
      <Section title={`Assigned segments (${prog.segments.length})`}>
        <div className="space-y-1">
          {prog.segments.map((g) => {
            const st = sim.segmentStatus(g);
            return (
              <button key={g.id} type="button" onClick={() => select({ kind: "segment", id: g.id })} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated">
                <span className="h-2 w-2 rounded-full" style={{ background: SEGMENT_COLOR[st] }} />
                <span className="flex-1 truncate text-[12px]">{g.name}</span>
                <span className="num text-[11px] text-ink-3">{pct(sim.segmentProgress(g))}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <ReassignDialog open={reassign} onOpenChange={setReassign} segmentIds={remaining} fromRobot={id} />
    </>
  );
}

// ------------------------------------------------------------------ segment
function SegmentPanel({ id }: { id: string }) {
  const sim = useEngine();
  const act = useSim((s) => s.act);
  const select = useUi((s) => s.select);
  const flyTo = useUi((s) => s.flyTo);
  const masked = useUi((s) => s.settings.maskPlates);
  const [reassign, setReassign] = useState(false);
  const seg: StreetSegment | undefined = sim.s.segments[id];
  if (!seg) return null;
  const s = sim.s;
  const status = sim.segmentStatus(seg);
  const blockedOpen = seg.blocked.filter((b) => !b.resolved);
  const revisit = s.missionOrder.map((m) => s.missions[m]).find((m) => m.kind === "revisit" && m.segmentIds.includes(id) && (m.status === "scheduled" || m.status === "active"));
  return (
    <>
      <Head kind="Street segment" title={seg.name} right={<SegmentStatusPill status={status} />} sub={<><span className="mono">{seg.id}</span> · {seg.district}</>} />
      <div className="px-4 py-3">
        <div className="mb-1 flex justify-between text-[11.5px]"><span className="text-ink-3">Cleaning completion</span><span className="num">{pct(sim.segmentProgress(seg))}</span></div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
          {segmentBar(seg).map((b, i) => <div key={i} style={{ width: `${b.w * 100}%`, background: b.c }} />)}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button size="xs" onClick={() => flyTo({ bounds: bounds(seg.coords) })}><MapPin size={12} />Zoom to</Button>
          <Button size="xs" onClick={() => setReassign(true)} disabled={status === "cleaned"}><RouteIcon size={12} />Reassign</Button>
          {blockedOpen.length > 0 && !revisit && (
            <Button size="xs" variant="warn" onClick={() => { act((x) => x.scheduleRevisit(id, seg.robotId, x.s.t + 1800)); toast("Revisit scheduled", `${seg.name} in 30 min`, "success"); }}>Schedule revisit</Button>
          )}
        </div>
      </div>
      <Section title="Details">
        <KV k="Length" v={`${Math.round(seg.length)} m`} />
        <KV k="Assigned robot" v={<button type="button" className="mono text-accent hover:underline" onClick={() => select({ kind: "robot", id: seg.robotId })}>{seg.robotId}</button>} />
        <KV k="Station" v={s.stations[seg.stationId].name} />
        <KV k="Scheduled window" v={seg.scheduled ? `${fmtT(seg.window.start)} - ${fmtT(seg.window.end)}` : "Not scheduled today"} />
        <KV k="Last cleaned" v={fmtDayTime(seg.lastCleanedAt)} />
        <KV k="Next cleaning" v={seg.cleanedAt !== null ? fmtDayTime(seg.nextCleaning) : seg.scheduled ? `Today ${fmtT(seg.window.start)}` : fmtDayTime(seg.nextCleaning)} />
        <KV k="Debris estimate" v={<span className="inline-flex items-center gap-2"><Progress value={seg.debris} className="w-16" color={seg.debris > 0.7 ? "#f59e0b" : "#7dd3fc"} />{seg.debris > 0.7 ? "Heavy" : seg.debris > 0.4 ? "Moderate" : "Light"}</span>} />
        <KV k="Parking restriction" v={<span className="whitespace-normal">{seg.restriction.label}</span>} />
        <KV k="Priority" v={seg.priority === "priority" ? <Tag tone="warn">Priority</Tag> : "Routine"} />
        {revisit && <KV k="Revisit" v={`${revisit.status} · ${fmtT(revisit.window.start)} · ${revisit.robotId}`} />}
      </Section>
      <Section title={`Incident history (${seg.incidentIds.length})`}>
        {seg.incidentIds.length === 0 && <div className="text-[12px] text-ink-3">No incidents today.</div>}
        <div className="space-y-1">
          {seg.incidentIds.map((iid) => {
            const inc = s.incidents[iid];
            const c = inc.caseId ? s.cases[inc.caseId] : null;
            return (
              <button key={iid} type="button" onClick={() => select({ kind: "incident", id: iid })} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated">
                <span className="mono text-[11px] text-ink-3">{fmtT(inc.t)}</span>
                <span className="flex-1 truncate text-[12px]">Parked {inc.vehicle.body} · <span className="mono">{maskPlate(inc.vehicle.plate, masked)}</span></span>
                {c && <span className="text-[10.5px] text-ink-3">{CASE_LABEL[c.status]}</span>}
              </button>
            );
          })}
        </div>
      </Section>
      <ReassignDialog open={reassign} onOpenChange={setReassign} segmentIds={[id]} fromRobot={seg.robotId} />
    </>
  );
}

function segmentBar(seg: StreetSegment) {
  const out: { w: number; c: string }[] = [];
  const cleaned = intervalTotal(seg.cleaned) / seg.length;
  const blocked = intervalTotal(seg.blocked.filter((b) => !b.resolved)) / seg.length;
  out.push({ w: cleaned, c: SEGMENT_COLOR.cleaned });
  out.push({ w: blocked, c: SEGMENT_COLOR.blocked });
  return out;
}

export function bounds(coords: [number, number][]): [[number, number], [number, number]] {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

// ------------------------------------------------------------------ station
function StationPanel({ id }: { id: string }) {
  const sim = useEngine();
  const { navigate, select } = useUi();
  const st = sim.s.stations[id];
  if (!st) return null;
  const s = sim.s;
  const assigned = s.robotOrder.map((r) => s.robots[r]).filter((r) => r.stationId === id);
  const here = s.robotOrder.map((r) => s.robots[r]).filter((r) => isDocked(r) && dockStationOf(r) === id);
  const inBay = here.filter((r) => bayOf(r) !== null);
  const working = st.bays - st.baysOutOfService;
  return (
    <>
      <img src="/assets/station.jpg" alt="Docking station concept render" className="h-36 w-full object-cover" />
      <Head kind="Docking station" title={st.name} right={<Tag tone={st.power === "degraded" ? "warn" : "ok"}>{st.power === "solar-assist" ? "Grid + solar" : st.power === "degraded" ? "Degraded" : "Grid normal"}</Tag>}
        sub={<><span className="mono">{st.id}</span> · {st.district}</>} />
      <Section title="Capacity">
        <div className="flex gap-1.5">
          {Array.from({ length: st.bays }, (_, i) => {
            const r = inBay.find((robot) => bayOf(robot) === i + 1);
            const out = i >= working;
            return (
              <div key={i} className="flex-1 rounded-md border border-line bg-panel-2 p-2 text-center">
                <div className="label">Bay {i + 1}</div>
                {out ? <div className="mt-1 text-[11px] text-crit">Out of service</div> : r ? (
                  <>
                    <div className="mono mt-1 text-[12px] font-semibold">{r.id}</div>
                    <Progress value={r.telemetry.battery / 100} color={r.status === "charging" ? "#22d3ee" : "#10b981"} striped={r.status === "charging"} className="mt-1" />
                    <div className="num mt-0.5 text-[10.5px] text-ink-3">{Math.round(r.telemetry.battery)}%</div>
                  </>
                ) : <div className="mt-1 text-[11px] text-ink-3">Free</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-2"><KV k="Available bays" v={`${Math.max(0, working - inBay.length)} of ${working}`} /></div>
      </Section>
      <Section title="Robots">
        <KV k="Assigned" v={assigned.length} />
        <KV k="Docked now" v={here.length} />
        <KV k="Charging sessions" v={here.filter((r) => r.status === "charging").length} />
        <KV k="Coverage zones" v={st.zoneIds.length} />
        <div className="mt-2 space-y-1">
          {assigned.map((r: Robot) => (
            <button key={r.id} type="button" onClick={() => select({ kind: "robot", id: r.id })} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated">
              <span className="mono w-12 text-[12px]">{r.id}</span>
              <Pill color={ROBOT_COLOR[r.status]}>{r.status}</Pill>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-3"><Battery size={12} />{Math.round(r.telemetry.battery)}%</span>
            </button>
          ))}
        </div>
      </Section>
      {st.warnings.length > 0 && (
        <Section title="Station warnings">
          {st.warnings.map((w) => <div key={w} className="flex gap-2 text-[12px] text-[#fcd34d]"><SeverityIcon severity="warning" />{w}</div>)}
        </Section>
      )}
      <div className="p-4"><Button size="sm" className="w-full" onClick={() => { navigate("stations"); select(null); }}>Open station operations</Button></div>
    </>
  );
}

// ------------------------------------------------------------------ incident
function IncidentPanel({ id }: { id: string }) {
  const sim = useEngine();
  const { navigate, select } = useUi();
  const masked = useUi((s) => s.settings.maskPlates);
  const inc = sim.s.incidents[id];
  if (!inc) return null;
  const s = sim.s;
  const c = inc.caseId ? s.cases[inc.caseId] : null;
  const seg = s.segments[inc.segmentId];
  return (
    <>
      <div className="relative">
        <img src={inc.evidence.image} alt="Obstruction evidence" className="h-40 w-full object-cover" />
        <span className="absolute left-2 top-2"><Tag tone={inc.evidence.source === "camera" ? "real" : "sim"}>{inc.evidence.source === "camera" ? "Camera snapshot" : "Simulated evidence"}</Tag></span>
      </div>
      <Head kind="Obstruction incident" title={<span className="mono">{inc.id}</span>} right={c && <CaseStatusPill status={c.status} />}
        sub={`${fmtT(inc.t)} · ${seg.name} · ${inc.robotId}`} />
      <Section title="Detection">
        <KV k="Vehicle" v={`${inc.vehicle.color} ${inc.vehicle.body}`} />
        <KV k="Plate (synthetic)" v={<span className="mono">{maskPlate(inc.vehicle.plate, masked)}</span>} />
        <KV k="Vehicle confidence" v={pct(inc.vehicleConfidence)} />
        <KV k="OCR confidence" v={inc.plateSource === "manual" ? "Manual entry" : pct(inc.ocrConfidence)} />
        <KV k="Section" v={`${Math.round(inc.alongM)} m along · ${inc.resolved ? "cleared on revisit" : "awaiting revisit"}`} />
        {c && <KV k="Restriction" v={c.check.applies ? "Applies" : "Does not apply"} />}
      </Section>
      <div className="p-4">
        {c && <Button variant="primary" size="sm" className="w-full" onClick={() => { navigate("incidents", c.id); select(null); }}>Open case {c.id}</Button>}
      </div>
    </>
  );
}
