import { Activity, AlertTriangle, CheckCircle2, Layers, Navigation, Route, ShieldAlert, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CityMap, MapLegend } from "@/components/map/CityMap";
import { EventRow, RobotStatusPill, SeverityIcon } from "@/components/common/status";
import { Metric, Progress, Switch, Tag } from "@/components/ui";
import { fmtT } from "@/sim/engine";
import { caseVisible, kpis, robotRouteProgress } from "@/sim/selectors";
import { useEngine } from "@/store/sim";
import { useUi } from "@/store/ui";
import { ROBOT_COLOR, cn, pct } from "@/lib/utils";

export function KpiStrip() {
  const sim = useEngine();
  const k = kpis(sim);
  const { navigate } = useUi.getState();
  const etaLate = k.eta !== null && k.eta > k.latestWindowEnd;
  return (
    <div className="grid grid-cols-5 gap-2 min-[1320px]:grid-cols-10 [&>button]:px-2.5">
      <Metric label="Active robots" value={k.activeRobots} sub="In operation" tone="#22d3ee" onClick={() => navigate("fleet")} />
      <Metric label="Deployed" value={k.totalRobots} sub={`${Object.keys(sim.s.stations).length} stations`} onClick={() => navigate("stations")} />
      <Metric label="Availability" value={pct(k.availability)} sub={`${k.totalRobots - Math.round(k.availability * k.totalRobots)} unavailable`} tone={k.availability < 0.85 ? "#f59e0b" : undefined} onClick={() => navigate("maintenance")} />
      <Metric label="Streets cleaned" value={k.streetsCleaned} sub={`of ${k.streetsScheduled} scheduled`} tone="#10b981" onClick={() => navigate("missions")} />
      <Metric label="Segments left" value={k.segmentsRemaining} sub={`${k.blockedSegments} blocked`} tone={k.blockedSegments ? "#f59e0b" : undefined} onClick={() => navigate("missions")} />
      <Metric label="Coverage" value={pct(k.coverage, 1)} sub={`${k.cleanedKm.toFixed(1)} / ${k.scheduledKm.toFixed(1)} km`} tone="#10b981" onClick={() => navigate("analytics")} />
      <Metric label="Waste collected" value={`${k.wasteKg.toFixed(0)} kg`} sub="today, all robots" onClick={() => navigate("analytics")} />
      <Metric label="Active alerts" value={k.activeAlerts} sub={`${k.criticalAlerts} critical`} tone={k.criticalAlerts ? "#ef4444" : k.activeAlerts ? "#f59e0b" : undefined} onClick={() => navigate("maintenance")} />
      <Metric label="Pending reviews" value={k.pendingReviews} sub="Parking cases" tone={k.pendingReviews ? "#f59e0b" : undefined} onClick={() => navigate("incidents")} />
      <Metric label="Schedule ETA" value={k.eta ? fmtT(k.eta) : "Done"} sub={k.eta ? (etaLate ? `Late · ${fmtT(k.latestWindowEnd)}` : `Ends ${fmtT(k.latestWindowEnd)}`) : "Routes complete"}
        tone={etaLate ? "#f59e0b" : undefined} onClick={() => navigate("missions")} />
    </div>
  );
}

export function CommandCenter() {
  const settings = useUi((s) => s.settings);
  const updateSettings = useUi((s) => s.updateSettings);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <KpiStrip />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(260px,29%,360px)] gap-3">
        <div className="panel relative min-h-0 overflow-hidden">
          <CityMap showZones={settings.showZones} showRoutes={settings.showRoutes} />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
            <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-bg/85 px-3 py-1.5 backdrop-blur">
              <Layers size={13} className="text-ink-3" />
              <Switch checked={settings.showZones} onChange={(v) => updateSettings({ showZones: v })} label="Zones" />
              <Switch checked={settings.showRoutes} onChange={(v) => updateSettings({ showRoutes: v })} label="Robot paths" />
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3"><MapLegend /></div>
          <div className="pointer-events-none absolute right-3 top-3"><Tag tone="sim">Digital twin · simulated fleet</Tag></div>
        </div>
        <OperationsPanel />
      </div>
    </div>
  );
}

function FeedSection({ title, icon, count, children, tone }: { title: string; icon: ReactNode; count: number; children: ReactNode; tone?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line last:border-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-2">
        <span className="text-ink-3">{icon}</span>
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="num ml-auto rounded px-1.5 text-[10.5px] font-bold" style={{ background: count ? `${tone ?? "#26354b"}30` : "#1c2738", color: count ? tone ?? "#a9b5c5" : "#6c7a8e" }}>{count}</span>
      </button>
      {open && <div className="px-1.5 pb-2">{children}</div>}
    </div>
  );
}

export function OperationsPanel() {
  const sim = useEngine();
  const s = sim.s;
  const { select, navigate } = useUi.getState();
  const active = s.robotOrder.map((id) => s.robots[id]).filter((r) => r.status === "cleaning" || r.status === "navigating" || r.status === "blocked");
  const alerts = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.resolvedAt === null).sort((a, b) => (a.severity === "critical" ? -1 : 0) - (b.severity === "critical" ? -1 : 0) || b.openedAt - a.openedAt);
  const priority = alerts.filter((a) => a.ruleId === "battery-low" || a.ruleId === "bin-full" || a.ruleId === "motor-temp" || a.ruleId === "link-lost");
  const health = alerts.filter((a) => !priority.includes(a));
  const obstructions = s.incidentOrder.map((i) => s.incidents[i]).filter((i) => !i.resolved).reverse();
  const reviews = s.caseOrder.map((c) => s.cases[c]).filter((c) => c.status === "awaiting_review" && caseVisible(s, c));
  const completed = s.events.filter((e) => e.kind === "cleaning" && e.severity === "success").slice(-6).reverse();
  const recent = s.events.slice(-40).reverse();
  return (
    <div className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Activity size={14} className="text-accent" />
        <h3 className="text-[13px] font-semibold">Operations</h3>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-3"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />live · {fmtT(s.t)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FeedSection title="Enforcement awaiting review" icon={<ShieldAlert size={13} />} count={reviews.length} tone="#f59e0b">
          {reviews.length === 0 && <div className="px-2 py-1 text-[11.5px] text-ink-3">No cases waiting.</div>}
          {reviews.map((c) => {
            const inc = s.incidents[c.incidentId];
            return (
              <button key={c.id} type="button" onClick={() => navigate("incidents", c.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated">
                <SeverityIcon severity="warning" size={13} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px]"><span className="mono">{c.id}</span> · {s.segments[inc.segmentId].name}</div>
                  <div className="text-[11px] text-ink-3">{inc.robotId} · {fmtT(inc.t)} · plate read {Math.round(inc.ocrConfidence * 100)}%</div>
                </div>
                <span className="text-[11px] text-accent">Review</span>
              </button>
            );
          })}
        </FeedSection>
        <FeedSection title="Priority alerts" icon={<AlertTriangle size={13} />} count={priority.length} tone="#ef4444">
          {priority.length === 0 && <div className="px-2 py-1 text-[11.5px] text-ink-3">No priority alerts.</div>}
          {priority.map((a) => (
            <button key={a.id} type="button" onClick={() => select({ kind: "robot", id: a.robotId })} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated">
              <span className="mt-0.5"><SeverityIcon severity={a.severity} size={13} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">{a.message}</div>
                <div className="text-[11px] text-ink-3">{a.recommendation}</div>
              </div>
            </button>
          ))}
        </FeedSection>
        <FeedSection title="Active missions" icon={<Navigation size={13} />} count={active.length} tone="#22d3ee">
          {active.map((r) => {
            const p = robotRouteProgress(sim, r);
            return (
              <button key={r.id} type="button" onClick={() => select({ kind: "robot", id: r.id })} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated">
                <div className="flex items-center gap-2">
                  <span className="mono text-[12px] font-semibold">{r.id}</span>
                  <RobotStatusPill status={r.status} />
                  <span className="num ml-auto text-[11px] text-ink-3">{Math.round(r.telemetry.battery)}% batt</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{r.currentSegmentId ? s.segments[r.currentSegmentId].name : "-"}</span>
                  <Progress value={p.pct} color={ROBOT_COLOR.charging} className="w-20" />
                  <span className="num w-8 text-right text-[11px]">{pct(p.pct)}</span>
                </div>
              </button>
            );
          })}
        </FeedSection>
        <FeedSection title="Obstructions" icon={<Route size={13} />} count={obstructions.length} tone="#ef4444">
          {obstructions.length === 0 && <div className="px-2 py-1 text-[11.5px] text-ink-3">No open obstructions.</div>}
          {obstructions.map((i) => (
            <button key={i.id} type="button" onClick={() => select({ kind: "incident", id: i.id })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated">
              <span className="h-2 w-2 rounded-sm bg-crit" />
              <span className="flex-1 truncate text-[12px]">{s.segments[i.segmentId].name}</span>
              <span className="mono text-[11px] text-ink-3">{fmtT(i.t)}</span>
            </button>
          ))}
        </FeedSection>
        <FeedSection title="Robot health anomalies" icon={<Wrench size={13} />} count={health.length} tone="#f59e0b">
          {health.length === 0 && <div className="px-2 py-1 text-[11.5px] text-ink-3">No anomalies.</div>}
          {health.map((a) => (
            <button key={a.id} type="button" onClick={() => select({ kind: "robot", id: a.robotId })} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-elevated">
              <span className="mt-0.5"><SeverityIcon severity={a.severity} size={13} /></span>
              <span className="text-[12px] text-ink-2">{a.message}</span>
            </button>
          ))}
        </FeedSection>
        <FeedSection title="Recently completed" icon={<CheckCircle2 size={13} />} count={completed.length} tone="#10b981">
          {completed.map((e) => <EventRow key={e.id} e={e} compact />)}
        </FeedSection>
        <FeedSection title="Activity log" icon={<Activity size={13} />} count={recent.length}>
          <div className={cn("space-y-0")}>{recent.map((e) => <EventRow key={e.id} e={e} compact />)}</div>
        </FeedSection>
      </div>
    </div>
  );
}
