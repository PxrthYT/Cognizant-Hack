import { Zap } from "lucide-react";
import { useState } from "react";
import { Button, KV, Panel, Pill, Progress, Tag } from "@/components/ui";
import { SeverityIcon } from "@/components/common/status";
import { bayOf, dockStationOf, fmtT, isDocked } from "@/sim/engine";
import type { Robot } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { ROBOT_COLOR, cn, pct } from "@/lib/utils";

const CHARGE_MIN = 50;

export default function Stations() {
  const sim = useEngine();
  const s = sim.s;
  const sel = useUi((x) => x.selection);
  const stations = Object.values(s.stations);
  const [open, setOpen] = useState<string>(sel?.kind === "station" ? sel.id : stations[0].id);
  const metro = stations.length > 6;
  const shown = metro ? stations.filter((x) => x.id === open) : stations;
  const dockedAll = s.robotOrder.map((id) => s.robots[id]).filter((r) => isDocked(r) && bayOf(r) !== null);
  const totalBays = stations.reduce((a, x) => a + x.bays - x.baysOutOfService, 0);
  const charging = dockedAll.filter((r) => r.status === "charging").length;
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-end gap-4">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Stations & Charging</h1>
          <p className="text-[11.5px] text-ink-3">{stations.length} docking stations · {totalBays} working bays · {charging} robots charging · utilization {pct(totalBays ? dockedAll.length / totalBays : 0)}</p>
        </div>
        {metro && (
          <select className="ml-auto h-8 rounded-md border border-line-2 bg-surface px-2 text-xs" value={open} onChange={(e) => setOpen(e.target.value)}>
            {stations.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}
          </select>
        )}
      </div>
      <div className={cn("grid gap-3", metro ? "grid-cols-1" : "grid-cols-3")}>
        {shown.map((st) => <StationCard key={st.id} id={st.id} />)}
      </div>
    </div>
  );
}

function StationCard({ id }: { id: string }) {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const select = useUi((x) => x.select);
  const s = sim.s;
  const st = s.stations[id];
  const assigned = s.robotOrder.map((r) => s.robots[r]).filter((r) => r.stationId === id);
  const here = s.robotOrder.map((r) => s.robots[r]).filter((r) => isDocked(r) && dockStationOf(r) === id);
  const inBay = here.filter((r) => bayOf(r) !== null).sort((a, b) => (bayOf(a) ?? 0) - (bayOf(b) ?? 0));
  const waiting = here.filter((r) => bayOf(r) === null);
  const working = st.bays - st.baysOutOfService;
  const departures = assigned.filter((r) => isDocked(r)).map((r) => ({ r, at: nextDeparture(sim, r) })).filter((x) => x.at !== null).sort((a, b) => a.at! - b.at!);
  const returns = assigned.filter((r) => r.status === "returning" && r.route).map((r) => ({ r, eta: s.t + (r.route!.length - r.route!.progress) / 1.5 }));
  const [docking, setDocking] = useState<string | null>(null);
  void docking;

  return (
    <Panel title={<span>{st.name} <span className="mono text-[11px] text-ink-3">{st.id}</span></span>} sub={`${st.district} · ${assigned.length} robots assigned`}
      actions={<Tag tone={st.power === "degraded" ? "warn" : "ok"}><Zap size={10} />{st.power === "solar-assist" ? "Grid + solar" : st.power === "degraded" ? "Degraded" : "Grid normal"}</Tag>}>
      <div className="p-3">
        <button type="button" onClick={() => select({ kind: "station", id })} className="mb-3 block w-full overflow-hidden rounded-lg border border-line text-left">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5 bg-surface p-2">
            {Array.from({ length: st.bays }, (_, i) => {
              const r = inBay.find((x) => bayOf(x) === i + 1);
              const out = i >= working;
              return (
                <div key={i} className={cn("rounded-md border p-2 text-center", out ? "border-crit/40 bg-crit/5" : "border-line bg-panel-2")}>
                  <div className="label">Bay {i + 1}</div>
                  {out ? <div className="py-3 text-[11px] text-crit">Charger offline</div> : r ? (
                    <div key={r.id} className="dock-in">
                      <svg viewBox="0 0 48 28" className="mx-auto mt-1 h-7 w-12">
                        <rect x="6" y="6" width="36" height="14" rx="4" fill="#1b2a3f" stroke={ROBOT_COLOR[r.status]} strokeWidth="1.5" />
                        <rect x="19" y="2" width="10" height="5" rx="2" fill="#2a3b55" />
                        <circle cx="12" cy="22" r="3" fill="#0b1220" stroke="#3b4d68" /><circle cx="36" cy="22" r="3" fill="#0b1220" stroke="#3b4d68" />
                        <rect x="9" y="12" width="30" height="2" rx="1" fill={ROBOT_COLOR[r.status]} opacity="0.9" />
                      </svg>
                      <div className="mono text-[11.5px] font-semibold">{r.id}</div>
                      <Progress value={r.telemetry.battery / 100} color={r.status === "charging" ? "#22d3ee" : "#10b981"} striped={r.status === "charging"} className="mt-1" />
                      <div className="num mt-0.5 text-[10px] text-ink-3">{Math.round(r.telemetry.battery)}%{r.status === "charging" ? ` · ${Math.ceil(((100 - r.telemetry.battery) / 100) * CHARGE_MIN)} min` : ""}</div>
                    </div>
                  ) : <div className="py-4 text-[11px] text-ink-3">Free</div>}
                </div>
              );
            })}
          </div>
        </button>
        <div className="grid grid-cols-2 gap-x-5">
          <div>
            <KV k="Bay capacity" v={`${working} working of ${st.bays}`} />
            <KV k="Docked" v={here.length} />
            <KV k="Charging" v={inBay.filter((r) => r.status === "charging").length} />
            <KV k="Available slots" v={Math.max(0, working - inBay.length)} />
          </div>
          <div>
            <KV k="Utilization" v={pct(working ? inBay.length / working : 0)} />
            <KV k="Coverage zones" v={st.zoneIds.length} />
            <KV k="Waiting for a bay" v={waiting.length} />
            <KV k="Power" v={st.power === "normal" ? "Normal" : st.power === "solar-assist" ? "Solar-assisted" : "Degraded"} />
          </div>
        </div>
        {waiting.length > 0 && <div className="mt-1 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11.5px] text-[#fcd34d]">{waiting.map((r) => r.id).join(", ")} waiting for a free bay.</div>}
        {st.warnings.map((w) => <div key={w} className="mt-1.5 flex gap-2 text-[11.5px] text-[#fcd34d]"><SeverityIcon severity="warning" size={13} />{w}</div>)}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">Scheduled departures</div>
            {departures.length === 0 && <div className="text-[11.5px] text-ink-3">None remaining.</div>}
            {departures.slice(0, 4).map(({ r, at }) => (
              <button key={r.id} type="button" onClick={() => select({ kind: "robot", id: r.id })} className="flex w-full justify-between py-0.5 text-left text-[12px] hover:text-accent"><span className="mono">{r.id}</span><span className="num text-ink-3">{fmtT(at!)}</span></button>
            ))}
          </div>
          <div>
            <div className="label mb-1">Estimated returns</div>
            {returns.length === 0 && <div className="text-[11.5px] text-ink-3">No robots returning.</div>}
            {returns.map(({ r, eta }) => (
              <button key={r.id} type="button" onClick={() => select({ kind: "robot", id: r.id })} className="flex w-full justify-between py-0.5 text-left text-[12px] hover:text-accent"><span className="mono">{r.id}</span><span className="num text-ink-3">{fmtT(eta)}</span></button>
            ))}
          </div>
        </div>

        <div className="label mb-1 mt-3">Assigned robots</div>
        <div className="space-y-1">
          {assigned.map((r: Robot) => (
            <div key={r.id} className="flex items-center gap-2">
              <button type="button" onClick={() => select({ kind: "robot", id: r.id })} className="mono w-12 text-left text-[12px] hover:text-accent">{r.id}</button>
              <Pill color={ROBOT_COLOR[r.status]}>{r.status}</Pill>
              <Progress value={r.telemetry.battery / 100} color={r.telemetry.battery < 20 ? "#ef4444" : "#10b981"} className="flex-1" />
              <span className="num w-9 text-right text-[11px] text-ink-3">{Math.round(r.telemetry.battery)}%</span>
              {!isDocked(r) && r.status !== "offline" && (
                <Button size="xs" variant="ghost" onClick={() => { setDocking(r.id); act((x) => x.operatorReturn(r.id, "Dispatched to charge")); }}>Dock</Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function nextDeparture(sim: ReturnType<typeof useEngine>, r: Robot): number | null {
  const segs = sim.remainingSegments(r);
  if (!segs.length) return null;
  return Math.min(...segs.map((id) => sim.s.segments[id].window.start)) - 3 * 60;
}
