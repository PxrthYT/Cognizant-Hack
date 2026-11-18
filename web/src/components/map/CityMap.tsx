import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { isDocked, bayOf, dockStationOf } from "@/sim/engine";
import { LOCAL_STREETS } from "@/sim/dataset";
import { gaps, mergeIntervals, slice } from "@/sim/geo";
import type { Frame } from "@/sim/replay";
import type { Interval, LngLat, RobotStatus, SegmentStatus, StreetSegment } from "@/sim/types";
import { onSimFrame, useSim } from "@/store/sim";
import { useUi } from "@/store/ui";
import { ROBOT_COLOR, SEGMENT_COLOR, cn } from "@/lib/utils";

// Free vector basemap, no API key (OpenFreeMap, data © OpenMapTiles © OpenStreetMap contributors).
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
// Used if the basemap can't be reached (e.g. offline at a venue): the digital twin still works.
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "local-streets": { type: "geojson", data: LOCAL_STREETS, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#070b12" } },
    { id: "local-streets", type: "line", source: "local-streets", paint: {
      "line-color": "#263343", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 17, 2.5],
    } },
  ],
};

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;
const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const line = (coords: LngLat[], props: Record<string, unknown>): Feature => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: props });

function segmentPieces(seg: StreetSegment, status: SegmentStatus, cleaned: Interval[], blocked: Interval[]): Feature[] {
  const out: Feature[] = [];
  const add = (iv: Interval, color: string, kind: string) => {
    const c = slice(seg.coords, seg.cum, iv.from, iv.to);
    if (c.length >= 2) out.push(line(c, { id: seg.id, color, kind }));
  };
  if (status === "inactive") {
    out.push(line(seg.coords, { id: seg.id, color: SEGMENT_COLOR.inactive, kind: "inactive" }));
    return out;
  }
  const c = mergeIntervals(cleaned);
  const b = mergeIntervals(blocked);
  for (const iv of c) add(iv, SEGMENT_COLOR.cleaned, "cleaned");
  for (const iv of b) add(iv, SEGMENT_COLOR.blocked, "blocked");
  const remainingStatus = status === "blocked" && b.length ? "scheduled" : status;
  for (const iv of gaps([...c, ...b], seg.length)) add(iv, SEGMENT_COLOR[remainingStatus], remainingStatus);
  return out;
}

export interface CityMapProps {
  className?: string;
  frame?: Frame | null;
  showZones?: boolean;
  showRoutes?: boolean;
  highlightSegmentIds?: string[];
  fitPadding?: number;
  interactive?: boolean;
  statusFilter?: SegmentStatus[] | null;
  districtFilter?: string | null;
}

export function CityMap({ className, frame = null, showZones = true, showRoutes = true, highlightSegmentIds, fitPadding = 40, interactive = true, statusFilter = null, districtFilter = null }: CityMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cameraPositioned = useRef(false);
  const presetId = useSim((s) => s.presetId);
  const robotMarkers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; cls: string }>());
  const stationMarkers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; key: string }>());
  const incidentMarkers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement }>());
  const segCache = useRef(new Map<string, { key: string; feats: Feature[] }>());
  const ready = useRef(false);
  const propsRef = useRef({ frame, showZones, showRoutes, highlightSegmentIds, statusFilter, districtFilter });
  propsRef.current = { frame, showZones, showRoutes, highlightSegmentIds, statusFilter, districtFilter };
  const lastSegUpdate = useRef(0);

  // create map once
  useEffect(() => {
    const sim = useSim.getState().sim!;
    const all = sim.s.segmentOrder.flatMap((id) => sim.s.segments[id].coords);
    const lons = all.map((p) => p[0]);
    const lats = all.map((p) => p[1]);
    const bounds: LngLatBoundsLike = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    const map = new maplibregl.Map({
      container: ref.current!,
      style: BASEMAP_URL,
      bounds,
      fitBoundsOptions: { padding: fitPadding },
      attributionControl: { compact: true },
      interactive,
      maxZoom: 19,
      minZoom: 11,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    let userMoved = false;
    const refit = () => {
      map.resize();
      if (!userMoved && !cameraPositioned.current) map.fitBounds(bounds, { padding: fitPadding, duration: 0, maxZoom: 15.2 });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(ref.current!);
    map.on("dragstart", () => (userMoved = true));
    map.on("wheel", () => (userMoved = true));
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const fallbackTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) map.setStyle(FALLBACK_STYLE);
    }, 7000);
    map.on("error", (e) => {
      if (!ready.current && String((e as { error?: Error }).error?.message ?? "").match(/style|Failed to fetch/i)) map.setStyle(FALLBACK_STYLE);
    });
    let handlersBound = false;
    map.on("style.load", () => {
      window.clearTimeout(fallbackTimer);
      tuneBasemap(map);
      map.addSource("zones", { type: "geojson", data: fc([]) });
      map.addSource("segs", { type: "geojson", data: fc([]) });
      map.addSource("segs-full", { type: "geojson", data: fc([]) });
      map.addSource("route", { type: "geojson", data: fc([]) });
      map.addSource("sel", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#22d3ee", "fill-opacity": 0.035 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#2c5466", "line-width": 1, "line-dasharray": [3, 3] } });
      map.addLayer({ id: "sel-glow", type: "line", source: "sel", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 7, 17, 14], "line-opacity": 0.22, "line-blur": 2 } });
      map.addLayer({ id: "segs-casing", type: "line", source: "segs", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#04070c", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 4.5, 17, 10], "line-opacity": 0.85 } });
      map.addLayer({ id: "segs-line", type: "line", source: "segs", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2.6, 17, 6.5],
          "line-opacity": ["case", ["==", ["get", "dim"], true], 0.25, 1] } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "w"], "line-dasharray": [1.2, 1.4], "line-opacity": 0.9 } });
      map.addLayer({ id: "segs-hit", type: "line", source: "segs-full", paint: { "line-color": "#000", "line-width": 16, "line-opacity": 0 } });
      if (handlersBound) {
        ready.current = true;
        segCache.current.clear();
        const s = useSim.getState().sim!.s;
        (map.getSource("segs-full") as GeoJSONSource).setData(fc(s.segmentOrder.map((id) => line(s.segments[id].coords, { id }))));
        render(true);
        return;
      }
      handlersBound = true;
      map.on("click", "segs-hit", (e) => {
        if (propsRef.current.frame) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) useUi.getState().select({ kind: "segment", id });
      });
      map.on("mouseenter", "segs-hit", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "segs-hit", () => (map.getCanvas().style.cursor = ""));
      map.on("dragstart", () => useUi.getState().follow(null));

      const s = useSim.getState().sim!.s;
      (map.getSource("segs-full") as GeoJSONSource).setData(fc(s.segmentOrder.map((id) => line(s.segments[id].coords, { id }))));
      ready.current = true;
      render(true);
    });

    const unsub = onSimFrame(() => render(false));
    return () => {
      unsub();
      window.clearTimeout(fallbackTimer);
      ro.disconnect();
      ready.current = false;
      robotMarkers.current.forEach((x) => x.m.remove());
      stationMarkers.current.forEach((x) => x.m.remove());
      incidentMarkers.current.forEach((x) => x.m.remove());
      robotMarkers.current.clear();
      stationMarkers.current.clear();
      incidentMarkers.current.clear();
      segCache.current.clear();
      map.remove();
      mapRef.current = null;
      cameraPositioned.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  // re-render on prop / selection / tick changes (replay frames, filters)
  const tick = useSim((s) => s.tick);
  const selection = useUi((s) => s.selection);
  const follow = useUi((s) => s.followRobotId);
  useEffect(() => {
    render(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, showZones, showRoutes, highlightSegmentIds?.join(","), selection, follow, tick, statusFilter?.join(","), districtFilter]);

  // camera commands
  const cmd = useUi((s) => s.mapCommand);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cmd) return;
    cameraPositioned.current = true;
    if (cmd.bounds) map.fitBounds(cmd.bounds, { padding: 60, duration: cmd.duration ?? 1200 });
    else if (cmd.center) map.flyTo({ center: cmd.center, zoom: cmd.zoom ?? map.getZoom(), duration: cmd.duration ?? 1200, essential: true });
    useUi.setState((state) => state.mapCommand === cmd ? { mapCommand: null } : state);
  }, [cmd, presetId]);

  function render(force: boolean) {
    const map = mapRef.current;
    const sim = useSim.getState().sim;
    if (!map || !sim || !ready.current) return;
    const s = sim.s;
    const p = propsRef.current;
    const live = !p.frame;
    if (!live && !force) return;
    const ui = useUi.getState();
    const sel = ui.selection;
    const now = performance.now();

    // ---- robots (every frame)
    s.robotOrder.forEach((id, i) => {
      const r = s.robots[id];
      const fr = p.frame?.robots[i];
      const pos = fr ? fr.pos : r.pos;
      const status: RobotStatus = fr ? fr.status : r.status;
      const docked = fr ? fr.docked : isDocked(r);
      const heading = fr ? fr.heading : r.heading;
      let entry = robotMarkers.current.get(id);
      if (!entry) {
        const el = document.createElement("div");
        el.innerHTML = `<div class="arrow"></div><div class="dot"></div><div class="tag">${id}</div>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (propsRef.current.frame) return;
          useUi.getState().select({ kind: "robot", id });
        });
        const m = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map);
        entry = { m, el, cls: "" };
        robotMarkers.current.set(id, entry);
      }
      const selected = (sel?.kind === "robot" && sel.id === id) || ui.followRobotId === id;
      const filteredOut = p.districtFilter && s.stations[r.stationId].district !== p.districtFilter;
      const cls = cn("robot-marker", status, selected && "selected", docked && "docked", filteredOut && "docked");
      if (cls !== entry.cls) {
        entry.el.className = cls;
        entry.el.style.setProperty("--c", ROBOT_COLOR[status]);
        entry.cls = cls;
      }
      entry.m.setLngLat(pos);
      entry.el.title = `${id} · ${status} · ${Math.round(fr?.battery ?? r.telemetry.battery)}% battery`;
      const arrow = entry.el.firstElementChild as HTMLDivElement;
      arrow.style.transform = `rotate(${heading}deg)`;
      arrow.style.display = status === "navigating" || status === "cleaning" || status === "returning" ? "" : "none";
    });
    if (live && ui.followRobotId) {
      const r = s.robots[ui.followRobotId];
      if (r && !map.isEasing() && map.project(r.pos).dist(map.project(map.getCenter())) >= 3) {
        map.jumpTo({ center: r.pos });
      }
    }

    if (!force && now - lastSegUpdate.current < 140) return;
    lastSegUpdate.current = now;

    // ---- segments
    const feats: Feature[] = [];
    s.segmentOrder.forEach((id, i) => {
      const seg = s.segments[id];
      const fs = p.frame?.segs[i];
      const status = fs ? fs.status : sim.segmentStatus(seg);
      const cleaned = fs ? fs.cleaned : seg.cleaned;
      const blocked = fs ? fs.blocked : seg.blocked.filter((b) => !b.resolved);
      const key = JSON.stringify([status, cleaned.map(({ from, to }) => [from, to]), blocked.map(({ from, to }) => [from, to])]);
      let c = segCache.current.get(id);
      if (!c || c.key !== key) {
        c = { key, feats: segmentPieces(seg, status, cleaned, blocked) };
        segCache.current.set(id, c);
      }
      const dimmed = (p.statusFilter && !p.statusFilter.includes(status)) || (p.districtFilter && seg.district !== p.districtFilter)
        || (p.highlightSegmentIds && p.highlightSegmentIds.length > 0 && !p.highlightSegmentIds.includes(id));
      for (const f of c.feats) feats.push(dimmed ? { ...f, properties: { ...f.properties, dim: true } } : f);
    });
    (map.getSource("segs") as GeoJSONSource | undefined)?.setData(fc(feats));

    // ---- selection highlight
    const selFeats: Feature[] = [];
    if (sel?.kind === "segment" && s.segments[sel.id]) selFeats.push(line(s.segments[sel.id].coords, { id: sel.id }));
    if (p.highlightSegmentIds) for (const id of p.highlightSegmentIds) if (s.segments[id]) selFeats.push(line(s.segments[id].coords, { id }));
    (map.getSource("sel") as GeoJSONSource | undefined)?.setData(fc(selFeats));

    // ---- zones
    const zoneFeats: Feature[] = p.showZones
      ? Object.values(s.zones).filter((z) => !p.districtFilter || z.district === p.districtFilter).map((z) => ({
        type: "Feature", geometry: { type: "Polygon", coordinates: [[...z.polygon, z.polygon[0]]] }, properties: { id: z.id },
      }))
      : [];
    (map.getSource("zones") as GeoJSONSource | undefined)?.setData(fc(zoneFeats));

    // ---- route of selected / followed robot (live only)
    const routeFeats: Feature[] = [];
    const rid = ui.followRobotId ?? (sel?.kind === "robot" ? sel.id : null);
    if (live && p.showRoutes) {
      const robots = rid ? [s.robots[rid]] : s.robotOrder.map((id) => s.robots[id]).filter((r) => r.route?.kind === "transit");
      for (const r of robots) {
        if (!r) continue;
        if (r.route && r.route.progress < r.route.length) {
          const rest = slice(r.route.coords, r.route.cum, r.route.progress, r.route.length);
          if (rest.length >= 2) routeFeats.push(line(rest, { color: r.route.dest === "station" ? "#a78bfa" : "#7dd3fc", w: rid ? 2.5 : 1.5 }));
        }
        if (rid) for (const q of r.queue.slice(r.route?.kind === "clean" ? 1 : 0)) {
          routeFeats.push(line(s.segments[q.segmentId].coords, { color: "#e6ecf4", w: 1.5 }));
        }
      }
    }
    (map.getSource("route") as GeoJSONSource | undefined)?.setData(fc(routeFeats));

    // ---- stations
    for (const st of Object.values(s.stations)) {
      const docked = p.frame
        ? p.frame.robots.filter((r) => r.docked && r.stationId === st.id && r.bay !== null)
        : s.robotOrder.map((id) => s.robots[id]).filter((r) => isDocked(r) && dockStationOf(r) === st.id && bayOf(r) !== null)
          .map((r) => ({ bay: bayOf(r), status: r.status }));
      const working = st.bays - st.baysOutOfService;
      const bars = Array.from({ length: st.bays }, (_, i) => {
        if (i >= working) return "out";
        const stt = docked.find((r) => r.bay === i + 1)?.status ?? (docked[i]?.bay === undefined ? docked[i]?.status : undefined);
        return stt === "charging" ? "busy" : stt ? "on" : "";
      });
      const selected = sel?.kind === "station" && sel.id === st.id;
      const key = `${bars.join(",")}|${selected}|${p.districtFilter ?? ""}`;
      let e = stationMarkers.current.get(st.id);
      if (!e) {
        const el = document.createElement("div");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (propsRef.current.frame) return;
          useUi.getState().select({ kind: "station", id: st.id });
        });
        const m = new maplibregl.Marker({ element: el, anchor: "left", offset: [-14, 0] }).setLngLat(st.pos).addTo(map);
        e = { m, el, key: "" };
        stationMarkers.current.set(st.id, e);
      }
      if (e.key !== key) {
        e.key = key;
        const hidden = p.districtFilter && st.district !== p.districtFilter;
        e.el.style.display = hidden ? "none" : "";
        e.el.className = cn("station-marker", selected && "selected");
        e.el.innerHTML = `<div class="hex"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>`
          + `<div class="info">${st.name}<small>${st.id} · ${docked.length}/${working} docked</small><div class="bays">${bars.map((b) => `<i class="${b}"></i>`).join("")}</div></div>`;
      }
    }

    // ---- incidents (live: unresolved, last 2h or awaiting review)
    const wanted = new Set<string>();
    const obstructions = p.frame?.obstructions ?? [];
    const visibleIncidents = live
      ? s.incidentOrder.flatMap((iid) => {
        const inc = s.incidents[iid];
        const c = inc.caseId ? s.cases[inc.caseId] : null;
        const recent = s.t - inc.t < 2 * 3600;
        if (inc.resolved && !recent) return [];
        if (!recent && c && c.status !== "awaiting_review") return [];
        return [{ id: iid, pos: inc.pos, title: `${iid} · ${inc.vehicle.color} ${inc.vehicle.body}`, muted: inc.resolved || c?.status !== "awaiting_review" }];
      })
      : obstructions.map((inc) => ({ ...inc, title: `${inc.id} · ${inc.street}`, muted: false }));
    for (const { id: iid, pos, title, muted } of visibleIncidents) {
      wanted.add(iid);
      let e = incidentMarkers.current.get(iid);
      if (!e) {
        const el = document.createElement("div");
        el.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (propsRef.current.frame) return;
          useUi.getState().select({ kind: "incident", id: iid });
        });
        const m = new maplibregl.Marker({ element: el, offset: [0, -16] }).setLngLat(pos).addTo(map);
        e = { m, el };
        incidentMarkers.current.set(iid, e);
      }
      e.m.setLngLat(pos);
      e.el.title = title;
      e.el.className = cn("incident-marker", muted && "muted");
    }
    for (const [id, e] of incidentMarkers.current) if (!wanted.has(id)) {
      e.m.remove();
      incidentMarkers.current.delete(id);
    }
  }

  return <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)} />;
}

/** Calm the basemap down so operational layers stand out. */
function tuneBasemap(map: maplibregl.Map) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    try {
      if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#080d15");
      if (layer.type === "fill" && /water/.test(layer.id)) map.setPaintProperty(layer.id, "fill-color", "#0b1826");
      if (layer.type === "line" && /road|highway|street|bridge|tunnel/.test(layer.id)) map.setPaintProperty(layer.id, "line-opacity", 0.55);
      if (layer.type === "symbol") {
        map.setPaintProperty(layer.id, "text-color", "#6c7a8e");
        map.setPaintProperty(layer.id, "text-halo-color", "#070b12");
      }
      if (layer.type === "symbol" && /poi|transit|airport/.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
    } catch {
      /* property not supported for this layer */
    }
  }
}

export function MapLegend({ className }: { className?: string }) {
  const items: [string, string][] = [
    [SEGMENT_COLOR.cleaned, "Cleaned"],
    [SEGMENT_COLOR.cleaning, "Cleaning in progress"],
    [SEGMENT_COLOR.scheduled, "Scheduled"],
    [SEGMENT_COLOR.blocked, "Blocked / intervention"],
    [SEGMENT_COLOR.inactive, "Not scheduled"],
  ];
  return (
    <div className={cn("pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-bg/85 px-2.5 py-1.5 text-[11px] text-ink-2 backdrop-blur", className)}>
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: c }} />{l}</span>
      ))}
    </div>
  );
}
