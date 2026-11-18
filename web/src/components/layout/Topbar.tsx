import {
  Bell, Building2, ChevronDown, CircleUser, Pause, Play, RotateCcw, Search, Sparkles, Wifi, WifiOff, Zap,
} from "lucide-react";
import { useState } from "react";
import { PRESETS, type PresetId } from "@/sim/dataset";
import { fmtT } from "@/sim/engine";
import { caseVisible } from "@/sim/selectors";
import { clearSaved, useEngine, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { useDemo } from "@/demo/demo";
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Segmented, Tag, Tip } from "@/components/ui";
import { SeverityIcon } from "@/components/common/status";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast";

export function Topbar() {
  const sim = useEngine();
  const s = sim.s;
  const { running, speed, presetId, setRunning, setSpeed, init, act } = useSim();
  const { navigate, select, setPalette, settings } = useUi();
  const selection = useUi((x) => x.selection);
  const demo = useDemo();
  const [injectFor, setInjectFor] = useState<string | null>(null);

  const online = s.robotOrder.filter((id) => s.robots[id].status !== "offline").length;
  const total = s.robotOrder.length;
  const openAlerts = s.alertOrder.map((a) => s.alerts[a]).filter((a) => a.resolvedAt === null);
  const reviews = s.caseOrder.map((c) => s.cases[c]).filter((c) => c.status === "awaiting_review" && caseVisible(s, c));
  const notifCount = openAlerts.filter((a) => a.severity !== "info").length + reviews.length;
  const date = new Date();
  const target = injectFor ?? (selection?.kind === "robot" ? selection.id : s.robotOrder.find((id) => s.robots[id].status === "cleaning") ?? s.robotOrder[0]);

  const switchPreset = async (id: PresetId) => {
    if (id === presetId) return;
    await init(id, { fresh: true });
    select(null);
  };

  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface/95 px-3 backdrop-blur">
      {/* City */}
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="flex h-9 items-center gap-2 rounded-md border border-line px-2.5 text-left hover:border-line-2 hover:bg-panel-2">
            <Building2 size={15} className="text-ink-3" />
            <div className="leading-tight">
              <div className="text-[12px] font-semibold">Halifax, NS</div>
              <div className="text-[10px] text-ink-3">{PRESETS[presetId].label.replace("Halifax · ", "")}</div>
            </div>
            <ChevronDown size={13} className="text-ink-3" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" width={290}>
          <MenuLabel>Operating area</MenuLabel>
          {Object.values(PRESETS).map((p) => (
            <MenuItem key={p.id} onSelect={() => switchPreset(p.id as PresetId)}>
              <div className="flex-1">
                <div className={cn("text-[12.5px]", p.id === presetId && "text-accent")}>{p.label}</div>
                <div className="text-[11px] text-ink-3">{p.detail}</div>
              </div>
              {p.id === presetId && <Tag tone="accent">Active</Tag>}
            </MenuItem>
          ))}
          <MenuSeparator />
          <div className="px-2 py-1.5 text-[11px] leading-snug text-ink-3">Real Halifax street geometry (OpenStreetMap). Stations, robots and missions are fictional demonstration data.</div>
        </MenuContent>
      </Menu>

      {/* Clock */}
      <div className="flex items-center gap-2 border-l border-line pl-2.5">
        <div className="leading-tight">
          <div className="num text-[17px] font-semibold tracking-tight">{fmtT(s.t)}<span className="text-[12px] text-ink-3">:{String(Math.floor(((s.t % 60) + 60) % 60)).padStart(2, "0")}</span></div>
          <div className="text-[10px] text-ink-3">{date.toLocaleDateString(undefined, { timeZone: "America/Halifax", weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
        </div>
        <Tip content="All robot telemetry, positions and events on this screen are produced by the CIVIC simulation engine, not by physical sensors.">
          <span><Tag tone="sim">Simulation</Tag></span>
        </Tip>
      </div>

      {/* Sim controls */}
      <div className="flex items-center gap-1.5 border-l border-line pl-2.5">
        <Tip content={running ? "Pause simulation" : "Start simulation"}>
          <Button size="icon" aria-label={running ? "Pause simulation" : "Start simulation"} variant={running ? "secondary" : "primary"} className="h-8 w-8" onClick={() => setRunning(!running)}>
            {running ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tip>
        <Segmented value={speed} onChange={(v) => setSpeed(v)}
          options={[{ value: 1, label: "1×", title: "1 simulated minute per second" }, { value: 2, label: "2×" }, { value: 5, label: "5×" }]} />
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="secondary"><Zap size={13} className="text-warn" />Inject<ChevronDown size={12} /></Button>
          </MenuTrigger>
          <MenuContent align="start" width={270}>
            <MenuLabel>Target robot</MenuLabel>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {s.robotOrder.slice(0, 12).map((id) => (
                <button key={id} type="button" onClick={(e) => { e.preventDefault(); setInjectFor(id); }}
                  className={cn("mono rounded border px-1.5 py-0.5 text-[10.5px]", id === target ? "border-accent/60 bg-accent/15 text-accent" : "border-line-2 text-ink-3 hover:text-ink")}>
                  {id}
                </button>
              ))}
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => { if (act((x) => x.triggerObstacle(target)) === false) toast(`${target} is not cleaning`, "Obstacles can only be injected in front of a robot that is cleaning.", "warning"); else toast("Obstacle placed", `Parked car 6 m ahead of ${target}`); }}>Trigger obstacle (parked car ahead)</MenuItem>
            <MenuItem onSelect={() => act((x) => x.triggerLowBattery(target))}>Trigger low battery</MenuItem>
            <MenuItem onSelect={() => act((x) => x.triggerFullBin(target))}>Trigger full bin</MenuItem>
            <MenuItem onSelect={() => act((x) => x.triggerFault(target))}>Trigger maintenance fault</MenuItem>
            <MenuItem onSelect={() => act((x) => x.completeCurrentSegment(target))}>Complete current segment</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={async () => { clearSaved(); await init(presetId, { fresh: true }); select(null); }}>
              <RotateCcw size={13} /> Reset simulation to 09:56
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Tip content={`${online} of ${total} robots connected. Offline robots hold position and their telemetry is shown as stale.`}>
          <div className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11.5px]", online === total ? "border-ok/30 text-[#6ee7b7]" : "border-crit/40 text-[#fca5a5]")}>
            {online === total ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="num font-semibold">{online}/{total}</span>
            <span className="text-ink-3">online</span>
          </div>
        </Tip>

        <button type="button" onClick={() => setPalette(true)}
          aria-label="Search"
          className="flex h-8 w-8 items-center justify-center gap-2 rounded-md border border-line bg-panel px-2.5 text-[12px] text-ink-3 hover:border-line-2 xl:w-44 xl:justify-start">
          <Search size={13} /><span className="hidden xl:inline">Search</span>
          <kbd className="mono ml-auto hidden rounded border border-line-2 px-1 text-[10px] xl:inline">Ctrl K</kbd>
        </button>

        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="relative grid h-8 w-8 place-items-center rounded-md border border-line hover:border-line-2 hover:bg-panel-2" aria-label="Notifications">
              <Bell size={15} />
              {notifCount > 0 && <span className="num absolute -right-1 -top-1 rounded-full bg-crit px-1 text-[9.5px] font-bold leading-4 text-white">{notifCount}</span>}
            </button>
          </MenuTrigger>
          <MenuContent width={360}>
            <MenuLabel>Needs attention</MenuLabel>
            {reviews.map((c) => (
              <MenuItem key={c.id} onSelect={() => navigate("incidents", c.id)}>
                <SeverityIcon severity="warning" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink">{c.id} awaiting enforcement review</div>
                  <div className="truncate text-[11px] text-ink-3">{s.segments[s.incidents[c.incidentId].segmentId].name} · {fmtT(c.createdAt)}</div>
                </div>
              </MenuItem>
            ))}
            {openAlerts.filter((a) => a.severity !== "info").slice(-8).reverse().map((a) => (
              <MenuItem key={a.id} onSelect={() => select({ kind: "robot", id: a.robotId })}>
                <SeverityIcon severity={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink">{a.message}</div>
                  <div className="truncate text-[11px] text-ink-3">{a.recommendation}</div>
                </div>
              </MenuItem>
            ))}
            {notifCount === 0 && <div className="px-2 py-4 text-center text-xs text-ink-3">All clear.</div>}
            <MenuSeparator />
            <MenuItem onSelect={() => navigate("maintenance")}>Open maintenance console</MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-panel-2">
              <CircleUser size={20} className="text-ink-3" />
              <div className="hidden text-left leading-tight 2xl:block">
                <div className="text-[11.5px] font-medium">{settings.operatorName}</div>
                <div className="text-[10px] text-ink-3">Operations</div>
              </div>
            </button>
          </MenuTrigger>
          <MenuContent width={240}>
            <div className="px-2 py-2">
              <div className="text-[13px] font-semibold">{settings.operatorName}</div>
              <div className="text-[11px] text-ink-3">Street Operations · Day shift</div>
              <div className="mt-1 text-[11px] text-ink-3">Can approve enforcement referrals (simulation)</div>
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => navigate("settings")}>Profile & settings</MenuItem>
          </MenuContent>
        </Menu>

        <Button variant="primary" size="md" className="ml-1 font-semibold" onClick={() => (demo.active ? demo.stop() : demo.start())}>
          <Sparkles size={14} /> {demo.active ? "Exit demo" : "Run City Operations Demo"}
        </Button>
      </div>
    </header>
  );
}
