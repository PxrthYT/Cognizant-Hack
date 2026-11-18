import { Wrench } from "lucide-react";
import { useState } from "react";
import { SeverityIcon, RobotStatusPill } from "@/components/common/status";
import { Button, Empty, Panel, Pill, Switch, Tag, inputCls } from "@/components/ui";
import { fmtT, isDocked } from "@/sim/engine";
import { fmtDayTime, healthColor, healthScore } from "@/sim/selectors";
import type { AlertRule } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { toast } from "@/store/toast";
import { useUi } from "@/store/ui";
import { SEVERITY_COLOR, cn } from "@/lib/utils";

const ACTION_LABEL: Record<AlertRule["action"], string> = {
  return_to_station: "Recommend return to station", pause: "Recommend pausing", schedule_maintenance: "Recommend maintenance", mark_offline: "Mark robot offline", none: "Notify only",
};

export default function Maintenance() {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const select = useUi((x) => x.select);
  const navigate = useUi((x) => x.navigate);
  const s = sim.s;
  const [tab, setTab] = useState<"open" | "queue" | "rules" | "history">("open");
  const open = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.resolvedAt === null).sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]) || b.openedAt - a.openedAt);
  const history = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.resolvedAt !== null).reverse();
  const robots = s.robotOrder.map((id) => s.robots[id]);
  const queue = robots.filter((r) => r.status === "maintenance" || r.maintenanceFlag || r.faults.length || r.telemetry.brushWear > 75 || r.telemetry.batteryHealth < 80 || r.nextService < s.t)
    .sort((a, b) => healthScore(a) - healthScore(b));

  const doAction = (a: (typeof open)[number]) => {
    const r = s.robots[a.robotId];
    if (a.action === "return_to_station") act((x) => x.operatorReturn(r.id, "Operator dispatch to charging / emptying"));
    else if (a.action === "pause") act((x) => x.pause(r.id));
    else if (a.action === "schedule_maintenance") act((x) => x.flagMaintenance(r.id, a.message));
    act((x) => x.acknowledgeAlert(a.id));
    toast("Action sent", `${r.id}: ${ACTION_LABEL[a.action].toLowerCase()}`, "success");
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Maintenance</h1>
          <p className="text-[11.5px] text-ink-3">Alerts come from simple threshold rules on robot telemetry. They are explainable and configurable, not predictions.</p>
        </div>
        <div className="ml-auto flex gap-1.5">
          {([["open", `Open alerts (${open.length})`], ["queue", `Service queue (${queue.length})`], ["rules", `Rules (${s.rules.length})`], ["history", `History (${history.length})`]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setTab(v)} className={cn("h-8 rounded-md border px-3 text-[12px]", tab === v ? "border-accent/50 bg-accent/10" : "border-line text-ink-2 hover:border-line-2")}>{l}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "open" && (
          <div className="space-y-2">
            {!open.length && <Panel><Empty>No open alerts. Use Inject in the top bar to trigger one.</Empty></Panel>}
            {open.map((a) => (
              <div key={a.id} className="panel flex items-center gap-3 px-4 py-3" style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_COLOR[a.severity]}` }}>
                <SeverityIcon severity={a.severity} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{a.message}</div>
                  <div className="text-[11.5px] text-ink-3">Rule <span className="mono">{a.ruleId}</span> · opened {fmtT(a.openedAt)} · Recommended: {a.recommendation}</div>
                </div>
                <RobotStatusPill status={s.robots[a.robotId].status} />
                <Button size="xs" onClick={() => select({ kind: "robot", id: a.robotId })}>Inspect</Button>
                {a.action !== "none" && a.action !== "mark_offline" && !a.acknowledged && (
                  <Button size="xs" variant="primary" disabled={isDocked(s.robots[a.robotId]) && a.action === "return_to_station"} onClick={() => doAction(a)}>
                    {a.action === "return_to_station" ? "Dispatch to station" : a.action === "pause" ? "Pause cleaning" : "Flag for service"}
                  </Button>
                )}
                {a.acknowledged && <Tag tone="ok">Action sent</Tag>}
              </div>
            ))}
          </div>
        )}

        {tab === "queue" && (
          <div className="grid grid-cols-2 gap-3">
            {!queue.length && <Panel className="col-span-2"><Empty>No robots need service.</Empty></Panel>}
            {queue.map((r) => {
              const T = r.telemetry;
              const reasons = [
                ...r.faults.map((f) => f.text),
                r.maintenanceFlag ? `Flagged: ${r.maintenanceFlag}` : "",
                T.brushWear > 75 ? `Brush ${Math.round(T.brushWear)}% worn` : "",
                T.batteryHealth < 80 ? `Battery health ${Math.round(T.batteryHealth)}%` : "",
                r.nextService < s.t ? `Service overdue since ${fmtDayTime(r.nextService)}` : "",
              ].filter(Boolean);
              return (
                <Panel key={r.id}>
                  <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                    <Wrench size={14} className="text-ink-3" /><button type="button" className="mono text-[14px] font-semibold hover:text-accent" onClick={() => navigate("fleet", r.id)}>{r.id}</button>
                    <RobotStatusPill status={r.status} /><span className="num ml-auto text-[14px] font-semibold" style={{ color: healthColor(healthScore(r)) }}>{healthScore(r)}</span>
                  </div>
                  <ul className="space-y-1 px-3.5 py-2.5 text-[12px] text-ink-2">{reasons.map((x) => <li key={x}>• {x}</li>)}</ul>
                  <div className="flex gap-1.5 border-t border-line px-3.5 py-2.5">
                    <Button size="xs" disabled={isDocked(r) || r.status === "offline"} onClick={() => act((x) => x.operatorReturn(r.id, "Called in for service"))}>Call in</Button>
                    <Button size="xs" variant="success" onClick={() => { act((x) => x.completeService(r.id)); toast("Service completed", `${r.id} back in service`, "success"); }}>Mark serviced</Button>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}

        {tab === "rules" && <RulesTable />}

        {tab === "history" && (
          <Panel>
            {!history.length && <Empty>Nothing resolved yet.</Empty>}
            {history.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-line/70 px-4 py-2 last:border-0">
                <SeverityIcon severity={a.severity} /><span className="flex-1 text-[12.5px]">{a.message}</span>
                <span className="mono text-[11px] text-ink-3">{fmtT(a.openedAt)} → {fmtT(a.resolvedAt!)}</span>
              </div>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

function RulesTable() {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const rules = sim.s.rules;
  const update = (id: string, patch: Partial<AlertRule>) => act((x) => { const r = x.s.rules.find((y) => y.id === id)!; Object.assign(r, patch); });
  return (
    <Panel title="Alert rules" sub="Edit thresholds live. Changes apply to the running simulation immediately and are stored with it.">
      <div className="grid grid-cols-[1.3fr_120px_100px_110px_1.6fr_70px] gap-3 border-b border-line bg-panel-2 px-4 py-2">
        {["Rule", "Metric", "Condition", "Severity", "Action", "Enabled"].map((h) => <span key={h} className="label">{h}</span>)}
      </div>
      {rules.map((r) => (
        <div key={r.id} className="grid grid-cols-[1.3fr_120px_100px_110px_1.6fr_70px] items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0">
          <div><div className="text-[12.5px] font-medium">{r.name}</div><div className="text-[10.5px] text-ink-3">{r.message}</div></div>
          <span className="mono text-[11.5px] text-ink-2">{r.metric}</span>
          <div className="flex items-center gap-1.5"><span className="mono text-ink-3">{r.op}</span>
            <input type="number" step={r.metric === "localization" ? 0.05 : 1} className={cn(inputCls, "num h-7 w-16")} value={r.threshold} onChange={(e) => update(r.id, { threshold: Number(e.target.value) })} /></div>
          <select className={cn(inputCls, "h-7")} value={r.severity} onChange={(e) => update(r.id, { severity: e.target.value as AlertRule["severity"] })}>
            <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
          </select>
          <select className={cn(inputCls, "h-7")} value={r.action} onChange={(e) => update(r.id, { action: e.target.value as AlertRule["action"] })}>
            {Object.entries(ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <Switch checked={r.enabled} onChange={(v) => update(r.id, { enabled: v })} />
        </div>
      ))}
      <div className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-ink-3"><Pill color="#a78bfa">Rules, not ML</Pill>Each alert has a hysteresis margin so it does not flap around the threshold.</div>
    </Panel>
  );
}
