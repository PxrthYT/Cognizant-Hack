import { History, Pause, Play, Radio, SkipBack } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CityMap, MapLegend } from "@/components/map/CityMap";
import { Button, Segmented, Switch, Tag } from "@/components/ui";
import { fmtT } from "@/sim/engine";
import { buildProjection, frameAt, type Frame, type Projection } from "@/sim/replay";
import type { SegmentStatus } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { cn, pct } from "@/lib/utils";

const STATUS_FILTERS: { v: SegmentStatus | "all"; label: string }[] = [
  { v: "all", label: "All" }, { v: "cleaned", label: "Cleaned" }, { v: "cleaning", label: "Cleaning" },
  { v: "scheduled", label: "Scheduled" }, { v: "blocked", label: "Blocked" }, { v: "inactive", label: "Inactive" },
];

export default function LiveMap() {
  const sim = useEngine();
  const settings = useUi((s) => s.settings);
  const updateSettings = useUi((s) => s.updateSettings);
  const recorder = useSim((s) => s.recorder);
  const running = useSim((s) => s.running);
  const setRunning = useSim((s) => s.setRunning);
  const s = sim.s;
  const [filter, setFilter] = useState<SegmentStatus | "all">("all");
  const [district, setDistrict] = useState("all");
  const [replayT, setReplayT] = useState<number | null>(null);   // null = live
  const [playing, setPlaying] = useState(false);
  const [proj, setProj] = useState<Projection | null>(null);
  const [projBusy, setProjBusy] = useState(false);
  const replaySession = useRef<{ wasRunning: boolean } | null>(null);
  const districts = useMemo(() => [...new Set(Object.values(s.stations).map((x) => x.district))], [s.stations]);

  const live = replayT === null;
  const frames: Frame[] = useMemo(() => {
    const past = recorder.frames;
    const lastT = past.length ? past[past.length - 1].t : 0;
    return proj ? [...past, ...proj.frames.filter((f) => f.t > lastT)] : past;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, recorder.frames.length, proj]);
  const frame = live ? null : frameAt(frames, replayT!);
  const shownT = live ? s.t : replayT!;

  const enter = async () => {
    const session = { wasRunning: running };
    replaySession.current = session;
    setRunning(false);
    useUi.getState().select(null);
    recorder.record(sim, true);
    setReplayT(s.t);
    setProj(null);
    setProjBusy(true);
    const result = await buildProjection(s);
    if (replaySession.current !== session) return;
    setProj(result);
    setProjBusy(false);
  };
  const goLive = () => {
    const session = replaySession.current;
    replaySession.current = null;
    setReplayT(null);
    setPlaying(false);
    setProj(null);
    setProjBusy(false);
    if (session) setRunning(session.wasRunning);
  };

  useEffect(() => {
    if (!playing || live) return;
    const id = window.setInterval(() => setReplayT((t) => (t === null ? t : Math.min(s.dayEnd, t + 240))), 100);
    return () => window.clearInterval(id);
  }, [playing, live, s.dayEnd]);
  useEffect(() => () => {
    const session = replaySession.current;
    replaySession.current = null;
    if (session) useSim.getState().setRunning(session.wasRunning);
  }, []);
  useEffect(() => {
    if (replayT !== null && replayT >= s.dayEnd) setPlaying(false);
  }, [replayT, s.dayEnd]);

  const events = useMemo(() => {
    const out = s.events.filter((e) => ["obstruction", "alert", "enforcement"].includes(e.kind) && e.severity !== "info" || e.kind === "charging");
    return out;
  }, [s.events.length]); // eslint-disable-line
  const projected = proj?.events.filter((e) => ["obstruction", "alert", "enforcement"].includes(e.kind) && e.severity !== "info") ?? [];
  const markers = [...events, ...projected.map((e) => ({ ...e, projected: true }))].filter((e) => e.kind !== "charging");

  const f = frame;
  const stats = f ? f.kpi : null;
  const robotsActive = f ? f.kpi.active : s.robotOrder.filter((id) => ["cleaning", "navigating", "returning", "blocked"].includes(s.robots[id].status)).length;
  const cov = stats ? stats.coverage : null;

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[17px] font-semibold tracking-tight">Live City Map</h1>
        {live ? <Tag tone="ok"><Radio size={11} />Live</Tag> : <Tag tone="warn"><History size={11} />Replay · {f?.projected ? "projection of today (simulated forward)" : "recorded"}</Tag>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Segmented value={filter} onChange={setFilter} options={STATUS_FILTERS.map((x) => ({ value: x.v, label: x.label }))} />
          <select className="h-7 rounded-md border border-line-2 bg-surface px-2 text-xs" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="all">All districts</option>{districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <Switch checked={settings.showZones} onChange={(v) => updateSettings({ showZones: v })} label="Zones" />
          <Switch checked={settings.showRoutes} onChange={(v) => updateSettings({ showRoutes: v })} label="Paths" />
        </div>
      </div>
      <div className="panel relative min-h-0 flex-1 overflow-hidden">
        <CityMap frame={frame} showZones={settings.showZones} showRoutes={settings.showRoutes}
          statusFilter={filter === "all" ? null : [filter]} districtFilter={district === "all" ? null : district} />
        <div className="pointer-events-none absolute bottom-3 left-3"><MapLegend /></div>
        {f && (
          <div className="absolute right-3 top-3 flex flex-wrap gap-3 rounded-lg border border-line bg-bg/85 px-3 py-2 backdrop-blur">
            {[["Coverage", pct(f.kpi.coverage, 1)], ["Cleaned", `${f.kpi.cleanedKm.toFixed(1)} km`],
              ["Robots active", robotsActive], ["Cases open", f.kpi.openCases],
              ...(f.missions ? [["Missions", `${f.missions.active ?? 0} active · ${f.missions.completed ?? 0} done`]] : []),
            ].map(([l, v]) => (
              <div key={l}><div className="label">{l}</div><div className="num text-[15px] font-semibold">{v}</div></div>
            ))}
          </div>
        )}
        {cov === null && <div className="absolute right-3 top-3"><Tag tone="sim">Digital twin · simulated fleet</Tag></div>}
      </div>

      {/* Time machine */}
      <div className="panel px-4 py-3">
        <div className="flex items-center gap-3">
          <History size={15} className="text-accent" />
          <span className="text-[13px] font-semibold">City Cleaning Time Machine</span>
          <span className="text-[11px] text-ink-3">06:00 - 22:00 · recorded snapshots up to now, then today's plan simulated forward</span>
          <div className="ml-auto flex items-center gap-1.5">
            {live ? <Button size="sm" variant="primary" onClick={() => void enter()}><SkipBack size={13} />Open replay</Button> : (
              <>
                <Button size="sm" aria-label="Rewind to 06:00" onClick={() => { setPlaying(false); setReplayT(s.dayStart); }}><SkipBack size={13} /></Button>
                <Button size="sm" variant={playing ? "secondary" : "primary"} onClick={() => setPlaying(!playing)}>{playing ? <><Pause size={13} />Pause</> : <><Play size={13} />Play</>}</Button>
                <Button size="sm" onClick={goLive}><Radio size={13} />Back to live</Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3">
          <div className="relative h-8">
            {/* markers */}
            {markers.map((e) => {
              const x = ((e.t - s.dayStart) / (s.dayEnd - s.dayStart)) * 100;
              if (x < 0 || x > 100) return null;
              const c = e.kind === "enforcement" ? "#f59e0b" : e.severity === "critical" ? "#ef4444" : e.kind === "obstruction" ? "#f97316" : "#f59e0b";
              return <span key={e.id} title={`${fmtT(e.t)} ${e.message}`} onClick={() => replayT !== null && setReplayT(e.t)}
                className="absolute top-0 h-2.5 w-1.5 -translate-x-1/2 cursor-pointer rounded-sm" style={{ left: `${x}%`, background: c, opacity: (e as { projected?: boolean }).projected ? 0.45 : 1 }} />;
            })}
            <div className="absolute inset-x-0 top-4 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="absolute inset-y-0 left-0 bg-accent/50" style={{ width: `${((s.t - s.dayStart) / (s.dayEnd - s.dayStart)) * 100}%` }} />
              {f && <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${((shownT - s.dayStart) / (s.dayEnd - s.dayStart)) * 100}%` }} />}
            </div>
            <input type="range" min={s.dayStart} max={s.dayEnd} step={60} value={shownT} disabled={live || projBusy}
              onChange={(e) => { setPlaying(false); setReplayT(Number(e.target.value)); }}
              className="absolute inset-x-0 top-2.5 h-4 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label="Replay time" />
            <div className={cn("pointer-events-none absolute top-2.5 h-4 w-1 -translate-x-1/2 rounded", live ? "bg-ok" : "bg-white")}
              style={{ left: `${((shownT - s.dayStart) / (s.dayEnd - s.dayStart)) * 100}%` }} />
            <div className="pointer-events-none absolute top-[26px] h-3 w-px bg-ink-3" style={{ left: `${((s.t - s.dayStart) / (s.dayEnd - s.dayStart)) * 100}%` }} title="Now" />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-ink-3">
            {[6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => <span key={h} className="num">{String(h).padStart(2, "0")}:00</span>)}
          </div>
          <div className="mt-1.5 flex items-center gap-4 text-[11px] text-ink-3">
            <span className="num text-[13px] font-semibold text-ink">{fmtT(shownT)}</span>
            {projBusy && <span>Simulating the rest of the day…</span>}
            <span className="inline-flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-warn" />Alert / case</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-crit" />Critical</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-warn opacity-45" />Projected</span>
            <span className="ml-auto">Replay uses stored simulation snapshots, never new random data. The projection is replayed from a copy of the current state.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
