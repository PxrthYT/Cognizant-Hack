import { Lightbulb, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { CityMap, MapLegend } from "@/components/map/CityMap";
import { Button, Dialog, Empty, Field, Panel, Pill, Progress, Segmented, Tag, inputCls } from "@/components/ui";
import { SegmentStatusPill } from "@/components/common/status";
import { fmtT } from "@/sim/engine";
import type { Mission, MissionStatus } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { toast } from "@/store/toast";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

const MCOLOR: Record<MissionStatus, string> = { scheduled: "#f59e0b", active: "#22d3ee", paused: "#a78bfa", completed: "#10b981", partial: "#f97316", cancelled: "#64748b" };
const toT = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 3600 + m * 60; };

export default function Missions() {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const select = useUi((x) => x.select);
  const s = sim.s;
  const [view, setView] = useState<"timeline" | "cards">("timeline");
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState<string[] | undefined>();
  const missions = s.missionOrder.map((m) => s.missions[m]);
  const recs = s.recOrder.map((r) => s.recommendations[r]).filter((r) => r.status === "open");
  const recsDone = s.recOrder.map((r) => s.recommendations[r]).filter((r) => r.status !== "open").reverse().slice(0, 8);
  const incomplete = s.segmentOrder.map((i) => s.segments[i]).filter((g) => g.scheduled && g.blocked.some((b) => !b.resolved));
  const progress = (m: Mission) => {
    const segs = m.segmentIds.map((i) => s.segments[i]);
    const tot = segs.reduce((a, g) => a + g.length, 0);
    return tot ? segs.reduce((a, g) => a + Math.min(g.length, g.cleaned.reduce((x, iv) => x + iv.to - iv.from, 0)), 0) / tot : 0;
  };
  const dayRange = { a: 6 * 3600, b: 22 * 3600 };
  const x = (t: number) => `${Math.max(0, Math.min(100, ((t - dayRange.a) / (dayRange.b - dayRange.a)) * 100))}%`;
  const rows = useMemo(() => [...missions].sort((a, b) => a.robotId.localeCompare(b.robotId) || a.window.start - b.window.start), [missions]);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_380px] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-end gap-3">
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">Cleaning Missions</h1>
            <p className="text-[11.5px] text-ink-3">{missions.length} missions today · {missions.filter((m) => m.status === "active").length} active · {incomplete.length} segments blocked and waiting for revisit</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Segmented value={view} onChange={setView} options={[{ value: "timeline", label: "Timeline" }, { value: "cards", label: "Cards" }]} />
            <Button variant="primary" size="md" onClick={() => setCreating(true)}><Plus size={14} />New assignment</Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(220px,1fr)_minmax(0,1.3fr)] gap-3">
          <div className="panel relative overflow-hidden">
            <CityMap highlightSegmentIds={highlight} showZones={false} />
            <div className="pointer-events-none absolute bottom-3 left-3"><MapLegend /></div>
            {highlight && <div className="absolute right-3 top-3"><Button size="xs" onClick={() => setHighlight(undefined)}>Clear highlight</Button></div>}
          </div>
          <Panel title={view === "timeline" ? "Daily schedule" : "Mission cards"} className="min-h-0" bodyClass="overflow-y-auto">
            {view === "timeline" ? (
              <div className="min-w-[640px] p-3">
                <div className="relative ml-[84px] h-5 text-[10px] text-ink-3">
                  {[6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => <span key={h} className="num absolute -translate-x-1/2" style={{ left: x(h * 3600) }}>{String(h).padStart(2, "0")}:00</span>)}
                </div>
                {rows.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 py-[3px]">
                    <span className="mono w-[78px] shrink-0 truncate text-[11px] text-ink-2">{m.robotId}{m.kind !== "routine" && <span className="ml-1 text-ink-3">{m.kind === "revisit" ? "RV" : m.kind === "reassignment" ? "RA" : "OP"}</span>}</span>
                    <div className="relative h-5 flex-1 rounded bg-surface">
                      {[8, 10, 12, 14, 16, 18, 20].map((h) => <span key={h} className="absolute inset-y-0 w-px bg-line/70" style={{ left: x(h * 3600) }} />)}
                      <button type="button" onClick={() => setHighlight(m.segmentIds)} title={`${m.name} · ${fmtT(m.window.start)}-${fmtT(m.window.end)} · ${m.status}`}
                        className="absolute inset-y-0.5 overflow-hidden rounded border text-left"
                        style={{ left: x(m.window.start), width: `calc(${x(m.window.end)} - ${x(m.window.start)})`, borderColor: MCOLOR[m.status], background: `${MCOLOR[m.status]}22` }}>
                        <span className="absolute inset-y-0 left-0" style={{ width: `${progress(m) * 100}%`, background: `${MCOLOR[m.status]}66` }} />
                        <span className="relative truncate px-1 text-[10px] text-ink">{m.name}</span>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="relative ml-[84px] mt-1 h-0"><span className="absolute -top-[calc(var(--rows,0)*1px)] h-0 w-px" /></div>
                <div className="mt-3 flex flex-wrap gap-3 pl-[84px] text-[10.5px] text-ink-3">
                  {Object.entries(MCOLOR).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: c }} />{k}</span>)}
                  <span>Bar fill = cleaned length · click a bar to highlight its streets on the map · RV revisit · RA reassignment · OP operator</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {missions.map((m) => (
                  <button key={m.id} type="button" onClick={() => setHighlight(m.segmentIds)} className="rounded-lg border border-line bg-panel-2 p-3 text-left hover:border-line-2">
                    <div className="flex items-center gap-2"><span className="mono text-[11px] text-ink-3">{m.id}</span><Pill color={MCOLOR[m.status]}>{m.status}</Pill>{m.priority === "priority" && <Tag tone="warn">Priority</Tag>}</div>
                    <div className="mt-1 text-[13px] font-medium">{m.name}</div>
                    <div className="text-[11px] text-ink-3">{m.robotId} · {fmtT(m.window.start)}-{fmtT(m.window.end)} · {m.segmentIds.length} segments</div>
                    <Progress value={progress(m)} color="#10b981" className="mt-2" />
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Dispatch recommendations" icon={<Lightbulb size={14} />} sub="Rules-based engine. Every recommendation shows its reason." actions={<Tag tone="neutral">Rules, not ML</Tag>}>
          <div className="space-y-2 p-2.5">
            {!recs.length && <Empty>No open recommendations.</Empty>}
            {recs.map((r) => (
              <div key={r.id} className="rounded-lg border border-line-2 bg-panel-2 p-3">
                <div className="flex items-center gap-2"><Tag tone="accent">{r.type.replace(/_/g, " ")}</Tag><span className="mono ml-auto text-[10.5px] text-ink-3">{fmtT(r.createdAt)}</span></div>
                <div className="mt-1.5 text-[13px] font-semibold">{r.title}</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-ink-2"><span className="text-ink-3">Why: </span>{r.reason}</div>
                <div className="mt-2.5 flex gap-1.5">
                  <Button size="xs" variant="primary" onClick={() => { act((x) => x.acceptRecommendation(r.id)); toast("Recommendation applied", r.title, "success"); }}>Accept</Button>
                  <Button size="xs" onClick={() => act((x) => x.dismissRecommendation(r.id))}>Dismiss</Button>
                  {r.segmentIds && <Button size="xs" variant="ghost" onClick={() => setHighlight(r.segmentIds)}>Show on map</Button>}
                </div>
              </div>
            ))}
            {recsDone.length > 0 && <div className="label px-1 pt-1">Decided</div>}
            {recsDone.map((r) => (
              <div key={r.id} className="rounded-md px-2 py-1.5 text-[11.5px] text-ink-3"><span className="text-ink-2">{r.title}</span> · {r.status}{r.status === "applied" ? " automatically" : ""}</div>
            ))}
          </div>
        </Panel>
        <Panel title={`Incomplete cleaning (${incomplete.length})`} sub="Blocked sections waiting for a revisit">
          <div className="space-y-1.5 p-2.5">
            {!incomplete.length && <Empty>Nothing blocked.</Empty>}
            {incomplete.map((g) => {
              const rv = s.missionOrder.map((m) => s.missions[m]).find((m) => m.kind === "revisit" && m.segmentIds.includes(g.id) && (m.status === "scheduled" || m.status === "active"));
              return (
                <div key={g.id} className="rounded-md border border-line bg-panel-2 px-2.5 py-2">
                  <div className="flex items-center gap-2"><button type="button" className="flex-1 text-left text-[12.5px] font-medium hover:text-accent" onClick={() => select({ kind: "segment", id: g.id })}>{g.name}</button><SegmentStatusPill status={sim.segmentStatus(g)} /></div>
                  <div className="mt-1 text-[11px] text-ink-3">{rv ? `Revisit ${rv.status} for ${fmtT(rv.window.start)} by ${rv.robotId}` : "No revisit scheduled"}</div>
                  {!rv && <Button size="xs" className="mt-1.5" onClick={() => { act((x) => x.scheduleRevisit(g.id, g.robotId, x.s.t + 20 * 60)); toast("Revisit scheduled", g.name, "success"); }}>Schedule revisit in 20 min</Button>}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <NewAssignment open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewAssignment({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const s = sim.s;
  const [robot, setRobot] = useState(s.robotOrder[0]);
  const [picked, setPicked] = useState<string[]>([]);
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("14:00");
  const [priority, setPriority] = useState<"routine" | "priority">("routine");
  const r = s.robots[robot];
  const station = s.stations[r.stationId];
  const nearby = s.segmentOrder.map((id) => s.segments[id])
    .filter((seg) => seg.district === station.district || seg.robotId === robot);
  const km = picked.reduce((a, id) => a + s.segments[id].length, 0) / 1000;
  const hours = km * 1000 / r.speedClean / 3600 + picked.length * 0.04;
  const ok = picked.length > 0 && toT(start) >= s.dayStart && toT(end) > Math.max(s.t, toT(start)) && toT(end) <= s.dayEnd
    && picked.every((id) => sim.canScheduleSegment(s.segments[id]));
  const fits = hours * 3600 <= toT(end) - toT(start);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New cleaning assignment" description="Choose streets, a robot and a cleaning window. The robot leaves its station shortly before the window opens." width={640}>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <Field label="Docking station">
            <select className={inputCls} value={station.id} onChange={(e) => {
              const next = s.robotOrder.find((id) => s.robots[id].stationId === e.target.value);
              if (next) { setRobot(next); setPicked([]); }
            }}>
              {Object.values(s.stations).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </Field>
          <Field label="Robot">
            <select className={inputCls} value={robot} onChange={(e) => setRobot(e.target.value)}>
              {s.robotOrder.filter((id) => s.robots[id].stationId === station.id)
                .map((id) => <option key={id} value={id}>{id} · {Math.round(s.robots[id].telemetry.battery)}% battery</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Window start"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Window end"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Priority"><Segmented value={priority} onChange={setPriority} options={[{ value: "routine", label: "Routine" }, { value: "priority", label: "Priority" }]} /></Field>
          <div className="rounded-lg border border-line bg-panel-2 p-3 text-[12px]">
            <div className="label mb-1">Estimate</div>
            <div className="num">{picked.length} segments · {km.toFixed(2)} km</div>
            <div className="num text-ink-2">Cleaning time about {Math.round(hours * 60)} min at {r.speedClean} m/s</div>
            <div className={cn("mt-1", fits ? "text-ok" : "text-warn")}>{picked.length === 0 ? "Select streets" : fits ? `Fits the window; finishes about ${fmtT(toT(start) + hours * 3600)}` : "Does not fit the window: widen it or pick fewer streets"}</div>
          </div>
        </div>
        <div>
          <div className="label mb-1">Streets ({picked.length} selected)</div>
          <div className="h-[290px] space-y-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1.5">
            {nearby.map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-elevated has-[:disabled]:opacity-50">
                <input type="checkbox" className="accent-cyan-400" checked={picked.includes(g.id)} disabled={!picked.includes(g.id) && !sim.canScheduleSegment(g)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))} />
                <span className="flex-1 truncate text-[12px]">{g.name}</span><span className="num text-[10.5px] text-ink-3">{Math.round(g.length)} m · {g.robotId}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => {
          const id = act((x) => x.createMission({ robotId: robot, segmentIds: picked, start: toT(start), end: toT(end), priority }));
          if (!id) return toast("Mission could not be created", "Check street availability and the cleaning window.", "warning");
          toast("Mission created", `${picked.length} segment(s) assigned to ${robot}`, "success");
          setPicked([]);
          onOpenChange(false);
        }}>Create mission</Button>
      </div>
    </Dialog>
  );
}
