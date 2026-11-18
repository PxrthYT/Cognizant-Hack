import * as RDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot, ChevronLeft, ChevronRight, MapPin, Pause, Play, RotateCcw, Search, ShieldAlert, SkipForward, Warehouse, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SCENES, useDemo } from "@/demo/demo";
import { ASSUMPTION_KM_PER_CREW_HOUR } from "@/sim/analytics";
import { fmtT } from "@/sim/engine";
import { kpis } from "@/sim/selectors";
import { useEngine } from "@/store/sim";
import { useToast } from "@/store/toast";
import { useUi, type PageId } from "@/store/ui";
import { Button, Switch, Tag } from "@/components/ui";
import { cn, pct } from "@/lib/utils";

// ---------------------------------------------------------------- demo narrative panel
export function DemoPanel() {
  const d = useDemo();
  const sim = useEngine();
  const showNarrative = useUi((s) => s.settings.showNarrative);
  const updateSettings = useUi((s) => s.updateSettings);
  if (!d.active) return null;
  const scene = SCENES[d.scene];
  const last = d.scene === SCENES.length - 1;
  const waiting = scene.waitForUser && !scene.waitForUser(sim);
  return (
    <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className="no-print pointer-events-auto absolute bottom-4 left-1/2 z-50 w-[640px] max-w-[92%] -translate-x-1/2 rounded-xl border border-accent/30 bg-panel/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Tag tone="accent">Live demo</Tag>
        <span className="text-[11px] text-ink-3">{d.finished ? "Demo complete" : `Scene ${d.scene + 1} of ${SCENES.length}`}</span>
        <span className="ml-1 text-[14px] font-semibold">{scene.title}</span>
        <div className="ml-auto flex items-center gap-2">
          <Switch checked={showNarrative} onChange={(v) => updateSettings({ showNarrative: v })} label="Narration" />
          <button type="button" onClick={d.stop} className="rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink" aria-label="Exit demo"><X size={14} /></button>
        </div>
      </div>
      <div className="mt-2 flex gap-1 px-4">
        {SCENES.map((s, i) => (
          <div key={s.id} title={s.title} className={cn("h-1 flex-1 rounded-full", i < d.scene ? "bg-accent" : i === d.scene ? "bg-accent/60" : "bg-line-2")} />
        ))}
      </div>
      <AnimatePresence mode="wait">
        {showNarrative && (
          <motion.p key={scene.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="px-4 pt-2.5 text-[13px] leading-relaxed text-ink-2">{scene.narrative}</motion.p>
        )}
      </AnimatePresence>
      {waiting && (
        <div className="mx-4 mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px] text-[#fcd34d]">
          Waiting for an operator decision on the case. Approve and route it, or reject it, to continue.
        </div>
      )}
      {last && <ImpactSummary />}
      <div className="flex items-center gap-1.5 px-4 pb-3 pt-3">
        <Button size="xs" onClick={d.prev} disabled={d.scene === 0 || !d.snapshots[d.scene - 1]}><ChevronLeft size={12} />Previous</Button>
        <Button size="xs" disabled={d.finished} variant={d.autoplay ? "secondary" : "primary"} onClick={() => d.setAutoplay(!d.autoplay)}>
          {d.autoplay ? <><Pause size={12} />Pause autoplay</> : <><Play size={12} />Auto play</>}
        </Button>
        <Button size="xs" variant="primary" onClick={d.next} disabled={last || waiting || (scene.id === "obstacle" && !scene.ready?.(sim))}>Next scene<ChevronRight size={12} /></Button>
        <div className="mx-1 h-4 w-px bg-line-2" />
        <Button size="xs" variant="ghost" aria-label="Skip to enforcement" onClick={() => void d.skipTo("enforce")}><SkipForward size={12} />Enforcement</Button>
        <Button size="xs" variant="ghost" aria-label="Skip to maintenance" onClick={() => void d.skipTo("maint")}><SkipForward size={12} />Maintenance</Button>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void d.restart()}><RotateCcw size={12} />Restart</Button>
      </div>
    </motion.div>
  );
}

function ImpactSummary() {
  const sim = useEngine();
  const k = kpis(sim);
  const s = sim.s;
  const cases = s.caseOrder.map((c) => s.cases[c]);
  const items = [
    ["Coverage today", pct(k.coverage), `${k.cleanedKm.toFixed(1)} of ${k.scheduledKm.toFixed(1)} km`],
    ["Streets cleaned", `${k.streetsCleaned}/${k.streetsScheduled}`, `${k.segmentsRemaining} remaining`],
    ["Waste collected", `${k.wasteKg.toFixed(0)} kg`, "by 9 robots"],
    ["Obstructions handled", `${s.incidentOrder.length}`, `${cases.filter((c) => c.status === "forwarded" || c.status === "acknowledged").length} referred after review`],
    ["Fleet availability", pct(k.availability), `${k.activeRobots} working now`],
    ["Crew-hours equivalent*", (k.cleanedKm / ASSUMPTION_KM_PER_CREW_HOUR).toFixed(1), "assumption, not measured"],
  ];
  return (
    <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
      {items.map(([l, v, sub]) => (
        <div key={l} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
          <div className="label">{l}</div>
          <div className="num text-[18px] font-semibold">{v}</div>
          <div className="text-[10.5px] text-ink-3">{sub}</div>
        </div>
      ))}
      <div className="col-span-3 text-[10.5px] text-ink-3">* Planning assumption: a manual crew cleans about {ASSUMPTION_KM_PER_CREW_HOUR} km of curb per crew-hour. Simulation time {fmtT(s.t)}.</div>
    </div>
  );
}

// ---------------------------------------------------------------- command palette
interface Item { id: string; label: string; sub: string; icon: React.ReactNode; run: () => void }

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const { navigate, select, flyTo } = useUi.getState();
  const sim = useEngine();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const items = useMemo<Item[]>(() => {
    const s = sim.s;
    const pages: [PageId, string][] = [["command", "Command Center"], ["map", "Live City Map"], ["fleet", "Fleet Management"], ["stations", "Stations & Charging"],
      ["missions", "Cleaning Missions"], ["incidents", "Incidents & Enforcement"], ["maintenance", "Maintenance"], ["analytics", "Analytics & Reports"],
      ["hardware", "Hardware Prototype"], ["settings", "Settings"]];
    return [
      ...pages.map(([id, label]) => ({ id: `p:${id}`, label, sub: "Page", icon: <ChevronRight size={14} />, run: () => navigate(id) })),
      ...s.robotOrder.slice(0, 120).map((id) => ({ id: `r:${id}`, label: id, sub: `Robot · ${s.stations[s.robots[id].stationId].name}`, icon: <Bot size={14} />,
        run: () => { select({ kind: "robot", id }); flyTo({ center: s.robots[id].pos, zoom: 16 }); } })),
      ...s.segmentOrder.map((id) => ({ id: `s:${id}`, label: s.segments[id].name, sub: `Segment ${id} · ${s.segments[id].robotId}`, icon: <MapPin size={14} />,
        run: () => { select({ kind: "segment", id }); const c = s.segments[id].coords; flyTo({ center: c[Math.floor(c.length / 2)], zoom: 16 }); } })),
      ...Object.values(s.stations).map((st) => ({ id: `st:${st.id}`, label: st.name, sub: `Station ${st.id}`, icon: <Warehouse size={14} />,
        run: () => { select({ kind: "station", id: st.id }); flyTo({ center: st.pos, zoom: 15.5 }); } })),
      ...s.caseOrder.map((id) => ({ id: `c:${id}`, label: id, sub: `Case · ${s.segments[s.incidents[s.cases[id].incidentId].segmentId].name}`, icon: <ShieldAlert size={14} />,
        run: () => navigate("incidents", id) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sim.s.caseOrder.length]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(t)) : items.slice(0, 10)).slice(0, 40);
  }, [q, items]);

  const run = (i: Item) => {
    i.run();
    setOpen(false);
    setQ("");
  };

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <RDialog.Content className="panel fixed left-1/2 top-[14%] z-[90] w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden border-line-2 bg-panel shadow-2xl">
          <RDialog.Title className="sr-only">Search</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={15} className="text-ink-3" />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                if (e.key === "Enter" && filtered[idx]) run(filtered[idx]);
              }}
              placeholder="Search robots, streets, stations, cases, pages…" className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3" />
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {filtered.map((i, n) => (
              <button key={i.id} type="button" onClick={() => run(i)} onMouseEnter={() => setIdx(n)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left", n === idx ? "bg-elevated" : "")}>
                <span className="text-ink-3">{i.icon}</span>
                <span className="text-[13px]">{i.label}</span>
                <span className="ml-auto truncate text-[11px] text-ink-3">{i.sub}</span>
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-6 text-center text-xs text-ink-3">No matches.</div>}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------------------------------------------------------------- toasts
export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  const color = { info: "#7dd3fc", success: "#10b981", warning: "#f59e0b", error: "#ef4444" };
  return (
    <div className="no-print pointer-events-none fixed right-4 top-16 z-[100] flex w-[320px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="pointer-events-auto rounded-lg border border-line-2 bg-panel px-3 py-2.5 shadow-2xl" style={{ boxShadow: `inset 3px 0 0 ${color[t.tone]}` }}>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[11.5px] text-ink-3">{t.body}</div>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink"><X size={13} /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
