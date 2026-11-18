import { ArrowLeft, Battery, Crosshair, Gauge as GaugeIcon, LayoutGrid, List, Pause, Play, Route as RouteIcon, Search, Undo2, Wrench } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ReassignDialog } from "@/components/inspector/Inspector";
import { EventRow, RobotStatusPill, SegmentStatusPill, SeverityIcon } from "@/components/common/status";
import { Button, Gauge, KV, Panel, Progress, Segmented, Sparkline, Tag, Tip, inputCls } from "@/components/ui";
import { fmtT, isDocked } from "@/sim/engine";
import { STATUS_LABEL, fmtDayTime, healthColor, healthScore, robotLocation, robotRouteProgress } from "@/sim/selectors";
import type { Robot, RobotStatus } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { ROBOT_COLOR, cn, pct } from "@/lib/utils";

const STATUSES: RobotStatus[] = ["cleaning", "navigating", "idle", "charging", "returning", "blocked", "paused", "maintenance", "offline"];

export default function Fleet() {
  const param = useUi((s) => s.param);
  const sim = useEngine();
  if (param && sim.s.robots[param]) return <RobotConsole id={param} />;
  return <FleetList />;
}

function FleetList() {
  const sim = useEngine();
  const navigate = useUi((s) => s.navigate);
  const s = sim.s;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RobotStatus | "all">("all");
  const [station, setStation] = useState("all");
  const [view, setView] = useState<"table" | "cards">("table");
  const robots = s.robotOrder.map((id) => s.robots[id]);
  const counts = Object.fromEntries(STATUSES.map((st) => [st, robots.filter((r) => r.status === st).length]));
  const shown = robots.filter((r) => (status === "all" || r.status === status) && (station === "all" || r.stationId === station)
    && (!q || `${r.id} ${robotLocation(sim, r)} ${s.stations[r.stationId].name}`.toLowerCase().includes(q.toLowerCase())));
  const open = (id: string) => navigate("fleet", id);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Fleet Management</h1>
          <p className="text-[11.5px] text-ink-3">{robots.length} robots · {Object.keys(s.stations).length} stations · telemetry simulated, refreshed every second of simulation time</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-ink-3" />
            <input className={cn(inputCls, "w-56 pl-8")} placeholder="Search robot, street, station" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className={cn(inputCls, "w-44")} value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="all">All stations</option>
            {Object.values(s.stations).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
          <Segmented value={view} onChange={setView} options={[{ value: "table", label: <List size={13} /> }, { value: "cards", label: <LayoutGrid size={13} /> }]} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={status === "all"} onClick={() => setStatus("all")} label="All" count={robots.length} color="#a9b5c5" />
        {STATUSES.map((st) => <FilterChip key={st} active={status === st} onClick={() => setStatus(st)} label={STATUS_LABEL[st]} count={counts[st]} color={ROBOT_COLOR[st]} />)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "table" ? (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[86px_150px_minmax(140px,1fr)_150px_110px_90px_90px_80px_70px] items-center gap-3 border-b border-line bg-panel-2 px-3 py-2">
              {["Robot", "Status", "Location / mission", "Route completion", "Battery", "Bin", "Brush", "Health", "Alerts"].map((h) => <span key={h} className="label">{h}</span>)}
            </div>
            {shown.map((r) => <FleetRow key={r.id} r={r} onOpen={() => open(r.id)} />)}
            {!shown.length && <div className="px-3 py-8 text-center text-xs text-ink-3">No robots match.</div>}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
            {shown.map((r) => <FleetCard key={r.id} r={r} onOpen={() => open(r.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors", active ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-line-2")}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
      <span className="num text-ink-3">{count}</span>
    </button>
  );
}

function FleetRow({ r, onOpen }: { r: Robot; onOpen: () => void }) {
  const sim = useEngine();
  const p = robotRouteProgress(sim, r);
  const h = healthScore(r);
  const alerts = sim.s.alertOrder.filter((a) => sim.s.alerts[a].robotId === r.id && sim.s.alerts[a].resolvedAt === null).length;
  const stale = r.status === "offline";
  const T = r.telemetry;
  return (
    <button type="button" onClick={onOpen} className="grid w-full grid-cols-[86px_150px_minmax(140px,1fr)_150px_110px_90px_90px_80px_70px] items-center gap-3 border-b border-line/70 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-panel-2">
      <div><div className="mono text-[13px] font-semibold">{r.id}</div><div className="text-[10.5px] text-ink-3">{sim.s.stations[r.stationId].name}</div></div>
      <div><RobotStatusPill status={r.status} /></div>
      <div className="min-w-0"><div className="truncate text-[12.5px]">{robotLocation(sim, r)}</div><div className="truncate text-[10.5px] text-ink-3">{r.holdReason ?? (r.status === "returning" ? r.returnReason : r.missionId ? sim.s.missions[r.missionId]?.name : "No active mission")}</div></div>
      <div><div className="num mb-1 flex justify-between text-[11px]"><span>{pct(p.pct)}</span><span className="text-ink-3">{(p.total / 1000).toFixed(1)} km</span></div><Progress value={p.pct} color="#10b981" /></div>
      <Meter v={T.battery} stale={stale} color={T.battery < 20 ? "#ef4444" : T.battery < 40 ? "#f59e0b" : "#10b981"} striped={r.status === "charging"} />
      <Meter v={T.binFill} stale={stale} color={T.binFill > 85 ? "#f59e0b" : "#7dd3fc"} />
      <Meter v={100 - T.brushWear} stale={stale} color={T.brushWear > 80 ? "#f59e0b" : "#a78bfa"} />
      <div className="num text-[13px] font-semibold" style={{ color: healthColor(h) }}>{h}</div>
      <div>{alerts ? <Tag tone="warn">{alerts}</Tag> : <span className="text-[11px] text-ink-3">-</span>}</div>
    </button>
  );
}

function Meter({ v, color, stale, striped }: { v: number; color: string; stale?: boolean; striped?: boolean }) {
  return (
    <div className={cn(stale && "opacity-40")}>
      <div className="num mb-1 text-[11px]">{Math.round(v)}%</div>
      <Progress value={v / 100} color={color} striped={striped} />
    </div>
  );
}

function FleetCard({ r, onOpen }: { r: Robot; onOpen: () => void }) {
  const sim = useEngine();
  const p = robotRouteProgress(sim, r);
  const h = healthScore(r);
  return (
    <button type="button" onClick={onOpen} className="panel p-3 text-left transition-colors hover:border-line-2">
      <div className="flex items-center gap-2"><span className="mono text-[14px] font-semibold">{r.id}</span><RobotStatusPill status={r.status} /><span className="num ml-auto text-[13px] font-semibold" style={{ color: healthColor(h) }}>{h}</span></div>
      <div className="mt-1 truncate text-[11.5px] text-ink-3">{robotLocation(sim, r)}</div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Meter v={r.telemetry.battery} color="#10b981" stale={r.status === "offline"} />
        <Meter v={r.telemetry.binFill} color="#7dd3fc" stale={r.status === "offline"} />
        <Meter v={p.pct * 100} color="#22d3ee" />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-ink-3"><span>Battery</span><span>Bin</span><span>Route</span></div>
    </button>
  );
}

// ---------------------------------------------------------------- robot console
const HOTSPOTS: { id: string; label: string; x: number; y: number }[] = [
  { id: "lidar", label: "Lidar & sensor mast", x: 48, y: 8 },
  { id: "camera", label: "Front camera", x: 27, y: 31 },
  { id: "bin", label: "Debris bin", x: 60, y: 36 },
  { id: "battery", label: "Battery pack", x: 57, y: 66 },
  { id: "brush", label: "Side brushes & brush motor", x: 22, y: 75 },
  { id: "drive", label: "Drive motors", x: 75, y: 66 },
];

function RobotConsole({ id }: { id: string }) {
  const sim = useEngine();
  const act = useSim((s) => s.act);
  const { navigate, follow, select } = useUi();
  const [reassign, setReassign] = useState(false);
  const diagRef = useRef<HTMLDivElement>(null);
  const r = sim.s.robots[id];
  const s = sim.s;
  const T = r.telemetry;
  const stale = r.status === "offline";
  const p = robotRouteProgress(sim, r);
  const eta = sim.robotEta(r);
  const remaining = sim.remainingSegments(r);
  const alerts = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.robotId === id).reverse();
  const events = s.events.filter((e) => e.robotId === id).slice(-25).reverse();
  const h = healthScore(r);
  const hist = r.history.slice(-180);
  const mission = r.missionId ? s.missions[r.missionId] : null;

  const hotspotState = useMemo(() => ({
    lidar: { v: `Localization ${T.localization.toFixed(2)}`, ok: T.localization >= 0.8 ? 0 : T.localization >= 0.6 ? 1 : 2 },
    camera: { v: `Sensor health ${Math.round(T.sensorHealth)}%`, ok: T.sensorHealth >= 90 ? 0 : 1 },
    bin: { v: `Fill ${Math.round(T.binFill)}%`, ok: T.binFill < 70 ? 0 : T.binFill < 85 ? 1 : 2 },
    battery: { v: `${Math.round(T.battery)}% · health ${Math.round(T.batteryHealth)}%`, ok: T.battery < 20 ? 2 : T.batteryHealth < 80 ? 1 : 0 },
    brush: { v: `Wear ${Math.round(T.brushWear)}% · ${Math.round(T.motorTemp)} °C`, ok: T.motorTemp > 75 ? 2 : T.brushWear > 80 ? 1 : 0 },
    drive: { v: `Load ${Math.round(T.motorLoad)}%`, ok: T.motorLoad > 85 ? 1 : 0 },
  }) as Record<string, { v: string; ok: number }>, [T.localization, T.sensorHealth, T.binFill, T.battery, T.batteryHealth, T.brushWear, T.motorTemp, T.motorLoad]);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => navigate("fleet")}><ArrowLeft size={14} />Fleet</Button>
        <h1 className="mono text-[20px] font-semibold">{r.id}</h1>
        <RobotStatusPill status={r.status} />
        <span className="text-[12px] text-ink-3">{r.model} · {s.stations[r.stationId].name}</span>
        <Tag tone="sim">Simulated telemetry</Tag>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {r.status === "paused"
            ? <Button size="sm" variant="success" onClick={() => act((x) => x.resume(id))}><Play size={13} />Resume mission</Button>
            : <Button size="sm" disabled={isDocked(r) || stale || r.status === "maintenance"} onClick={() => act((x) => x.pause(id))}><Pause size={13} />Pause mission</Button>}
          <Button size="sm" disabled={isDocked(r) || stale} onClick={() => act((x) => x.operatorReturn(id))}><Undo2 size={13} />Return to station</Button>
          <Button size="sm" disabled={!remaining.length} onClick={() => setReassign(true)}><RouteIcon size={13} />Reassign route</Button>
          <Button size="sm" variant="warn" disabled={!!r.maintenanceFlag} onClick={() => act((x) => x.flagMaintenance(id, "Operator inspection requested"))}><Wrench size={13} />Flag maintenance</Button>
          <Button size="sm" onClick={() => diagRef.current?.scrollIntoView({ behavior: "smooth" })}><GaugeIcon size={13} />Review diagnostics</Button>
          <Button size="sm" variant="primary" onClick={() => { follow(id); select({ kind: "robot", id }); navigate("map"); }}><Crosshair size={13} />Follow on map</Button>
        </div>
      </div>

      {stale && (
        <div className="mb-3 rounded-lg border border-crit/40 bg-crit/10 px-4 py-2.5 text-[12.5px] text-[#fca5a5]">
          Connection lost. CIVIC is not assuming fresh telemetry: every value below is the last report from {fmtT(r.lastTelemetryAt)} ({Math.round((s.t - r.lastTelemetryAt) / 60)} min ago). The robot holds position until the link recovers.
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_340px] gap-3">
        <div className="space-y-3">
          <div ref={diagRef} className="panel relative overflow-hidden">
            <img src="/assets/diagnostics.jpg" alt="CS-2 robot technical cut-away" className="block w-full" />
            <div className="absolute left-3 top-3 flex items-center gap-2"><Tag tone="accent">Diagnostics</Tag><span className="text-[11px] text-ink-3">Hover a component</span></div>
            <div className="absolute right-3 top-3 rounded-lg border border-line bg-bg/85 px-3 py-1.5 text-center backdrop-blur">
              <div className="label">Health score</div>
              <div className="num text-[22px] font-semibold" style={{ color: healthColor(h) }}>{h}</div>
            </div>
            {HOTSPOTS.map((hs) => {
              const st = hotspotState[hs.id];
              const c = st.ok === 2 ? "#ef4444" : st.ok === 1 ? "#f59e0b" : "#22d3ee";
              return (
                <Tip key={hs.id} content={<><div className="font-semibold">{hs.label}</div><div className="text-ink-2">{st.v}</div></>}>
                  <span className={cn("absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-help place-items-center rounded-full border-2 bg-bg/70", stale && "opacity-50")}
                    style={{ left: `${hs.x}%`, top: `${hs.y}%`, borderColor: c, boxShadow: `0 0 0 4px ${c}22` }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                  </span>
                </Tip>
              );
            })}
            <div className="absolute bottom-2 left-3 text-[10px] text-ink-3">Illustration of the production CS-2 unit (generated concept art)</div>
          </div>
          <Panel title="Robot information">
            <div className="grid grid-cols-2 gap-x-6 px-3.5 py-1.5">
              <div>
                <KV k="Robot ID" v={<span className="mono">{r.id}</span>} />
                <KV k="Assigned station" v={s.stations[r.stationId].name} />
                <KV k="Current location" v={robotLocation(sim, r)} />
                <KV k="Assigned mission" v={mission?.name ?? "None active"} />
                <KV k="Current segment" v={r.currentSegmentId ? s.segments[r.currentSegmentId].name : "-"} />
              </div>
              <div>
                <KV k="Route completion" v={`${pct(p.pct)} (${(p.done / 1000).toFixed(2)} km)`} />
                <KV k="Distance travelled today" v={`${(r.distanceTodayM / 1000).toFixed(2)} km`} />
                <KV k="Operating hours" v={`${(r.operatingSecondsToday / 3600).toFixed(1)} h today · ${Math.round(r.operatingHoursTotal)} h total`} />
                <KV k="Est. mission completion" v={eta ? fmtT(eta) : "Complete"} />
                <KV k="Odometer" v={`${Math.round(r.odometerKm)} km`} />
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Telemetry" sub={stale ? `stale since ${fmtT(r.lastTelemetryAt)}` : `last report ${fmtT(r.lastTelemetryAt)}`} actions={<Tag tone="sim">Simulated</Tag>}>
            <div className="grid grid-cols-3 gap-y-3 px-2 py-3">
              <Gauge value={T.battery} label="Battery level" color={T.battery < 20 ? "#ef4444" : "#10b981"} stale={stale} />
              <Gauge value={T.batteryHealth} label="Battery health" color={T.batteryHealth < 80 ? "#f59e0b" : "#10b981"} stale={stale} />
              <Gauge value={T.binFill} label="Bin fill" color={T.binFill > 85 ? "#f59e0b" : "#7dd3fc"} stale={stale} />
              <Gauge value={100 - T.brushWear} label="Brush condition" color={T.brushWear > 80 ? "#f59e0b" : "#a78bfa"} stale={stale} />
              <Gauge value={T.motorTemp} max={110} unit="°C" label="Motor temp" color={T.motorTemp > 75 ? "#ef4444" : "#7dd3fc"} stale={stale} />
              <Gauge value={T.motorLoad} label="Motor load" color="#22d3ee" stale={stale} />
              <Gauge value={T.connectivity} label="Connectivity" color={T.connectivity < 15 ? "#ef4444" : "#10b981"} />
              <Gauge value={T.localization * 100} label="Localization" color={T.localization < 0.6 ? "#f59e0b" : "#22d3ee"} stale={stale} />
              <Gauge value={T.sensorHealth} label="Sensor health" color="#10b981" stale={stale} />
            </div>
            <div className="grid grid-cols-2 gap-x-6 border-t border-line px-3.5 py-1.5">
              <KV k="Last maintenance" v={fmtDayTime(r.lastMaintenance)} />
              <KV k="Next scheduled service" v={<span className={r.nextService < s.t ? "text-warn" : ""}>{fmtDayTime(r.nextService)}{r.nextService < s.t ? " (overdue)" : ""}</span>} />
            </div>
          </Panel>
          <Panel title="Last 3 hours" sub="one sample per simulated minute">
            <div className="space-y-2 px-3.5 py-3">
              {[["Battery %", hist.map((x) => x.battery), "#10b981", 0, 100], ["Motor °C", hist.map((x) => x.motorTemp), "#f97316", 10, 100],
                ["Bin %", hist.map((x) => x.binFill), "#7dd3fc", 0, 100], ["Motor load %", hist.map((x) => x.motorLoad), "#22d3ee", 0, 100]].map(([l, d, c, lo, hi]) => (
                <div key={l as string} className="grid grid-cols-[86px_1fr_44px] items-center gap-2">
                  <span className="text-[11px] text-ink-3">{l as string}</span>
                  <Sparkline data={d as number[]} color={c as string} min={lo as number} max={hi as number} height={26} />
                  <span className="num text-right text-[11.5px]">{(d as number[]).length ? Math.round((d as number[])[(d as number[]).length - 1]) : "-"}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Assigned route" sub={`${p.segments.length} segments · ${(p.total / 1000).toFixed(2)} km`}>
            <div className="space-y-1 p-2">
              {p.segments.map((g) => (
                <button key={g.id} type="button" onClick={() => select({ kind: "segment", id: g.id })} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated">
                  <div className="flex items-center gap-2"><span className="flex-1 truncate text-[12px]">{g.name}</span><SegmentStatusPill status={sim.segmentStatus(g)} /></div>
                  <div className="mt-1 flex items-center gap-2"><Progress value={sim.segmentProgress(g)} color="#10b981" /><span className="num w-9 text-right text-[10.5px] text-ink-3">{pct(sim.segmentProgress(g))}</span></div>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Alerts" sub="Threshold rules (configurable in Maintenance)">
            <div className="max-h-56 space-y-1 overflow-y-auto p-2">
              {!alerts.length && <div className="px-2 py-3 text-[12px] text-ink-3">No alerts today.</div>}
              {alerts.map((a) => (
                <div key={a.id} className={cn("rounded-md border px-2.5 py-1.5", a.resolvedAt === null ? "border-line-2 bg-panel-2" : "border-line opacity-60")}>
                  <div className="flex items-start gap-2 text-[12px]"><SeverityIcon severity={a.severity} />{a.message}</div>
                  <div className="pl-6 text-[11px] text-ink-3">{fmtT(a.openedAt)}{a.resolvedAt !== null ? ` - cleared ${fmtT(a.resolvedAt)}` : " · open"} · {a.recommendation}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Activity" icon={<Battery size={13} />}>
            <div className="max-h-64 overflow-y-auto p-1">{events.map((e) => <EventRow key={e.id} e={e} compact />)}</div>
          </Panel>
        </div>
      </div>
      <ReassignDialog open={reassign} onOpenChange={setReassign} segmentIds={remaining} fromRobot={id} />
    </div>
  );
}
