import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LngLat } from "@/sim/types";

export type PageId =
  | "command" | "map" | "fleet" | "stations" | "missions" | "incidents" | "maintenance" | "analytics" | "hardware" | "settings";

export type Selection =
  | { kind: "robot"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "station"; id: string }
  | { kind: "incident"; id: string }
  | null;

export interface MapCommand {
  seq: number;
  center?: LngLat;
  zoom?: number;
  bounds?: [LngLat, LngLat];
  duration?: number;
}

export interface Settings {
  operatorName: string;
  maskPlates: boolean;
  showNarrative: boolean;
  showZones: boolean;
  showRoutes: boolean;
  robotLinkUrl: string;
  visionBridgeUrl: string;
}

interface UiStore {
  page: PageId;
  param: string | null;            // e.g. robot id on the fleet page
  selection: Selection;
  followRobotId: string | null;
  mapCommand: MapCommand | null;
  paletteOpen: boolean;
  settings: Settings;
  navigate: (page: PageId, param?: string | null) => void;
  select: (sel: Selection) => void;
  follow: (id: string | null) => void;
  flyTo: (cmd: Omit<MapCommand, "seq">) => void;
  setPalette: (v: boolean) => void;
  updateSettings: (p: Partial<Settings>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  operatorName: "Duty Supervisor",
  maskPlates: false,
  showNarrative: true,
  showZones: true,
  showRoutes: true,
  robotLinkUrl: "ws://localhost:8787/telemetry",
  visionBridgeUrl: "http://localhost:8765",
};

function parseHash(): { page: PageId; param: string | null } {
  const [, page, param] = (window.location.hash || "#/command").split("/");
  const pages: PageId[] = ["command", "map", "fleet", "stations", "missions", "incidents", "maintenance", "analytics", "hardware", "settings"];
  return { page: (pages.includes(page as PageId) ? page : "command") as PageId, param: param ? decodeURIComponent(param) : null };
}

export const useUi = create<UiStore>()(
  persist(
    (set, get) => ({
      ...parseHash(),
      selection: null,
      followRobotId: null,
      mapCommand: null,
      paletteOpen: false,
      settings: DEFAULT_SETTINGS,
      navigate(page, param = null) {
        const hash = `#/${page}${param ? `/${encodeURIComponent(param)}` : ""}`;
        if (window.location.hash !== hash) window.history.pushState(null, "", hash);
        set({ page, param });
      },
      select: (selection) => set({ selection }),
      follow: (followRobotId) => set({ followRobotId }),
      flyTo: (cmd) => set({ mapCommand: { ...cmd, seq: (get().mapCommand?.seq ?? 0) + 1 } }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      updateSettings: (p) => set({ settings: { ...get().settings, ...p } }),
    }),
    { name: "civic.ui.v1", partialize: (s) => ({ settings: s.settings }) },
  ),
);

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => useUi.setState(parseHash()));
}
