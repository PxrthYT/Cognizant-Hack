import { Suspense, lazy, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CommandPalette, DemoPanel, Toaster } from "@/components/layout/Overlays";
import { Inspector } from "@/components/inspector/Inspector";
import { TipProvider } from "@/components/ui";
import { useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { CommandCenter } from "@/pages/CommandCenter";

const LiveMap = lazy(() => import("@/pages/LiveMap"));
const Fleet = lazy(() => import("@/pages/Fleet"));
const Stations = lazy(() => import("@/pages/Stations"));
const Missions = lazy(() => import("@/pages/Missions"));
const Incidents = lazy(() => import("@/pages/Incidents"));
const Maintenance = lazy(() => import("@/pages/Maintenance"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Hardware = lazy(() => import("@/pages/Hardware"));
const SettingsPage = lazy(() => import("@/pages/Settings"));

export default function App() {
  const loading = useSim((s) => s.loading);
  const sim = useSim((s) => s.sim);
  const init = useSim((s) => s.init);
  const page = useUi((s) => s.page);

  useEffect(() => {
    void init();
  }, [init]);

  if (loading && !sim) {
    return (
      <div className="grid h-full place-items-center text-ink-3">
        <div className="text-center">
          <div className="text-[15px] font-bold tracking-[0.2em] text-ink">CIVIC</div>
          <div className="mt-2 text-xs">Starting simulation · routing robots on the Halifax street network…</div>
        </div>
      </div>
    );
  }

  return (
    <TipProvider>
      <div className="flex h-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="print-area relative min-h-0 flex-1 overflow-hidden">
            <Suspense fallback={<div className="p-6 text-xs text-ink-3">Loading…</div>}>
              {page === "command" && <CommandCenter />}
              {page === "map" && <LiveMap />}
              {page === "fleet" && <Fleet />}
              {page === "stations" && <Stations />}
              {page === "missions" && <Missions />}
              {page === "incidents" && <Incidents />}
              {page === "maintenance" && <Maintenance />}
              {page === "analytics" && <Analytics />}
              {page === "hardware" && <Hardware />}
              {page === "settings" && <SettingsPage />}
            </Suspense>
            <Inspector />
            <DemoPanel />
          </main>
        </div>
      </div>
      <CommandPalette />
      <Toaster />
    </TipProvider>
  );
}
