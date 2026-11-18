import {
  BarChart3, Battery, Bot, CalendarClock, Cpu, LayoutDashboard, Map as MapIcon, Settings, ShieldAlert, Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { caseVisible } from "@/sim/selectors";
import { useEngine } from "@/store/sim";
import { useUi, type PageId } from "@/store/ui";
import { cn } from "@/lib/utils";

const NAV: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: "command", label: "Command Center", icon: <LayoutDashboard size={16} /> },
  { id: "map", label: "Live City Map", icon: <MapIcon size={16} /> },
  { id: "fleet", label: "Fleet Management", icon: <Bot size={16} /> },
  { id: "stations", label: "Stations & Charging", icon: <Battery size={16} /> },
  { id: "missions", label: "Cleaning Missions", icon: <CalendarClock size={16} /> },
  { id: "incidents", label: "Incidents & Enforcement", icon: <ShieldAlert size={16} /> },
  { id: "maintenance", label: "Maintenance", icon: <Wrench size={16} /> },
  { id: "analytics", label: "Analytics & Reports", icon: <BarChart3 size={16} /> },
  { id: "hardware", label: "Hardware Prototype", icon: <Cpu size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0f1a28" stroke="#23344a" />
        <path d="M22.5 10.5a8 8 0 1 0 0 11" fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
        <circle cx="22.5" cy="16" r="2.2" fill="#10b981" />
      </svg>
      <div className="leading-none">
        <div className="text-[15px] font-bold tracking-[0.14em]">CIVIC</div>
        <div className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">Autonomous Urban Operations</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const sim = useEngine();
  const page = useUi((s) => s.page);
  const navigate = useUi((s) => s.navigate);
  const select = useUi((s) => s.select);
  const s = sim.s;
  const reviews = s.caseOrder.filter((c) => s.cases[c].status === "awaiting_review" && caseVisible(s, s.cases[c])).length;
  const alerts = s.alertOrder.filter((a) => s.alerts[a].resolvedAt === null && s.alerts[a].severity !== "info").length;
  const recs = s.recOrder.filter((r) => s.recommendations[r].status === "open").length;
  const badge: Partial<Record<PageId, { n: number; tone: string }>> = {
    incidents: { n: reviews, tone: "bg-warn text-black" },
    maintenance: { n: alerts, tone: "bg-crit text-white" },
    missions: { n: recs, tone: "bg-accent text-accent-ink" },
  };
  return (
    <aside className="no-print flex w-[212px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center border-b border-line px-4"><Logo /></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((n, i) => {
          const b = badge[n.id];
          return (
            <div key={n.id}>
              {i === 8 && <div className="mx-2 my-2 h-px bg-line" />}
              <button type="button" title={n.label} aria-current={page === n.id ? "page" : undefined}
                onClick={() => { select(null); navigate(n.id); }}
                className={cn("group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                  page === n.id ? "bg-elevated text-ink shadow-[inset_2px_0_0_#22d3ee]" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
                <span className={cn(page === n.id ? "text-accent" : "text-ink-3 group-hover:text-ink-2")}>{n.icon}</span>
                <span className="truncate">{n.label}</span>
                {b && b.n > 0 && <span className={cn("num ml-auto rounded px-1.5 text-[10px] font-bold leading-4", b.tone)}>{b.n}</span>}
              </button>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3 text-[11px] leading-relaxed text-ink-3">
        <div className="flex items-center gap-1.5 text-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-violet" /> Simulation engine
        </div>
        <div className="mono">seed {s.seed} · {s.presetName}</div>
        <div className="mt-1">Robots, stations and events are fictional. Streets © OpenStreetMap.</div>
      </div>
    </aside>
  );
}
