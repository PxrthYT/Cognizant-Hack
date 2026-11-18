import { Button, Field, KV, Panel, Segmented, Switch, Tag, inputCls } from "@/components/ui";
import { PRESETS, type PresetId } from "@/sim/dataset";
import { clearSaved, useEngine, useSim } from "@/store/sim";
import { toast } from "@/store/toast";
import { useUi } from "@/store/ui";

export default function SettingsPage() {
  const sim = useEngine();
  const { settings, updateSettings, select } = useUi();
  const presetId = useSim((s) => s.presetId);
  const init = useSim((s) => s.init);
  const restored = useSim((s) => s.restoredFromStorage);
  const s = sim.s;
  return (
    <div className="h-full overflow-y-auto p-3">
      <h1 className="mb-3 text-[17px] font-semibold tracking-tight">Settings</h1>
      <div className="grid max-w-5xl grid-cols-2 gap-3">
        <Panel title="Operator">
          <div className="space-y-3 p-3.5">
            <Field label="Operator name (recorded in audit trails)">
              <input className={inputCls} value={settings.operatorName} onChange={(e) => { updateSettings({ operatorName: e.target.value }); sim.s.operator = e.target.value; }} />
            </Field>
            <Switch checked={settings.maskPlates} onChange={(v) => updateSettings({ maskPlates: v })} label="Mask licence plates on screen (for screenshots and projectors)" />
            <Switch checked={settings.showNarrative} onChange={(v) => updateSettings({ showNarrative: v })} label="Show narration in the guided demo" />
          </div>
        </Panel>
        <Panel title="Map display">
          <div className="space-y-3 p-3.5">
            <Switch checked={settings.showZones} onChange={(v) => updateSettings({ showZones: v })} label="Show assigned cleaning zones" />
            <Switch checked={settings.showRoutes} onChange={(v) => updateSettings({ showRoutes: v })} label="Show robot paths" />
            <p className="text-[11.5px] text-ink-3">Basemap: OpenFreeMap vector tiles (no API key). If it cannot load, the street layers still render on a plain background.</p>
          </div>
        </Panel>
        <Panel title="Fleet size">
          <div className="space-y-3 p-3.5">
            <Segmented value={presetId} onChange={(v) => { void init(v as PresetId, { fresh: true }); select(null); toast("Preset loaded", PRESETS[v as PresetId].label, "success"); }}
              options={Object.values(PRESETS).map((p) => ({ value: p.id, label: p.label.replace("Halifax · ", "") }))} />
            <p className="text-[11.5px] text-ink-3">{PRESETS[presetId].detail}. The 100-robot preset runs on the same engine with the same rules, at the same speed.</p>
          </div>
        </Panel>
        <Panel title="Simulation">
          <div className="px-3.5 py-2">
            <KV k="Preset" v={s.presetName} /><KV k="Seed" v={<span className="mono">{s.seed}</span>} /><KV k="Robots / stations / segments" v={`${s.robotOrder.length} / ${Object.keys(s.stations).length} / ${s.segmentOrder.length}`} />
            <KV k="Persistence" v={restored ? "Restored from this browser" : "Fresh run"} />
            <div className="mt-2 flex gap-2">
              <Button onClick={async () => { clearSaved(); await init(presetId, { fresh: true }); select(null); toast("Simulation reset", "Back to 09:56", "success"); }}>Reset simulation</Button>
              <Button variant="danger" onClick={() => { localStorage.clear(); window.location.reload(); }}>Clear all saved data</Button>
            </div>
          </div>
        </Panel>
        <Panel title="Data & honesty" className="col-span-2">
          <ul className="space-y-1.5 p-3.5 text-[12px] leading-relaxed text-ink-2">
            <li><Tag tone="sim">Simulated</Tag> Robots, stations, missions, telemetry, plates, restrictions, case outcomes and history are fictional demonstration data.</li>
            <li><Tag tone="real">Real</Tag> Street geometry is from OpenStreetMap contributors (ODbL). The hardware page can show a real camera feed.</li>
            <li>Enforcement referrals are simulated end to end. Nothing is transmitted to any agency and no legal ticket is ever issued by CIVIC.</li>
            <li>Maintenance alerts are threshold rules you can edit under Maintenance. They are not machine learning.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
