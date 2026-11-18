import { Download, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Panel, Tag, inputCls } from "@/components/ui";
import { ASSUMPTION_KM_PER_CREW_HOUR, buildHistory, summarize, toCsv, todayRecords, type Filters, type MissionKind } from "@/sim/analytics";
import { useEngine } from "@/store/sim";
import { cn, pct } from "@/lib/utils";

const AX = { stroke: "#6c7a8e", fontSize: 10.5 } as const;
const TIP = { contentStyle: { background: "#0e1520", border: "1px solid #26354b", borderRadius: 8, fontSize: 12, color: "#e6ecf4" }, labelStyle: { color: "#a9b5c5" }, cursor: { stroke: "#33455f", fill: "rgba(34,211,238,0.06)" } };

function Chart({ title, sub, children, h = 200 }: { title: string; sub?: string; children: React.ReactElement; h?: number }) {
  return (
    <Panel title={title} sub={sub}>
      <div className="px-2 pb-2 pt-3" style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </Panel>
  );
}

export default function Analytics() {
  const sim = useEngine();
  const s = sim.s;
  const [f, setF] = useState<Filters>({ days: 14, district: "all", stationId: "all", robotId: "all", mission: "all" });
  const history = useMemo(() => buildHistory(sim, 30), [sim]);
  const pastDays = useMemo(() => summarize(history, f), [history, f]);
  const days = [...pastDays, ...summarize(todayRecords(sim), f)];
  const today = days.find((d) => d.day === 0);
  const past = days.filter((d) => d.day < 0);
  const avg = (k: "coverage" | "utilization" | "missionRate" | "adherence") => (past.length ? past.reduce((a, d) => a + d[k], 0) / past.length : 0);
  const totalKm = days.reduce((a, d) => a + d.cleanedKm, 0);
  const districts = [...new Set(Object.values(s.stations).map((x) => x.district))];
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v });

  const exportCsv = () => {
    const blob = new Blob([toCsv(days)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `civic-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const weekly = useMemo(() => {
    const out: { week: string; coverage: number }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const sched = chunk.reduce((a, d) => a + d.scheduledKm, 0);
      out.push({ week: `${chunk[0].label}`, coverage: sched ? chunk.reduce((a, d) => a + d.cleanedKm, 0) / sched : 0 });
    }
    return out;
  }, [days]);

  const data = days.map((d) => ({ ...d, covPct: +(d.coverage * 100).toFixed(1), utilPct: +(d.utilization * 100).toFixed(1), missionPct: +(d.missionRate * 100).toFixed(1),
    adhPct: +(d.adherence * 100).toFixed(1), km: +d.cleanedKm.toFixed(2), dist: +d.distanceKm.toFixed(2), waste: +d.wasteKg.toFixed(1), mps: +d.minutesPerStreet.toFixed(1), chg: +d.chargingHours.toFixed(1) }));

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Analytics & Reports</h1>
          <p className="text-[11.5px] text-ink-3">Past days are synthetic history generated from this fleet and its schedules. Today is live from the simulation.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={cn(inputCls, "w-32")} value={f.days} onChange={(e) => set("days", Number(e.target.value))}>{[7, 14, 30].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
          <select className={cn(inputCls, "w-36")} value={f.district} onChange={(e) => set("district", e.target.value)}><option value="all">All districts</option>{districts.map((d) => <option key={d}>{d}</option>)}</select>
          <select className={cn(inputCls, "w-40")} value={f.stationId} onChange={(e) => set("stationId", e.target.value)}><option value="all">All stations</option>{Object.values(s.stations).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className={cn(inputCls, "w-28")} value={f.robotId} onChange={(e) => set("robotId", e.target.value)}><option value="all">All robots</option>{s.robotOrder.slice(0, 120).map((id) => <option key={id}>{id}</option>)}</select>
          <select className={cn(inputCls, "w-36")} value={f.mission} onChange={(e) => set("mission", e.target.value as MissionKind | "all")}>
            <option value="all">All missions</option><option value="routine">Routine</option><option value="revisit">Revisit</option><option value="reassignment">Reassignment</option><option value="operator">Operator</option>
          </select>
          <Button size="md" onClick={exportCsv}><Download size={14} />Export CSV</Button>
          <Button size="md" variant="primary" onClick={() => window.print()}><Printer size={14} />Print report</Button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-6 gap-2">
        {[
          ["Today's coverage", today ? pct(today.coverage, 1) : "-", "by cleaned road length"],
          [`${f.days}-day avg coverage`, pct(avg("coverage"), 1), "cleaned km / scheduled km"],
          ["Fleet utilization", pct(avg("utilization"), 1), "active hours / available hours"],
          ["Mission completion", pct(avg("missionRate"), 1), "completed / created"],
          ["Schedule adherence", pct(avg("adherence"), 1), "segments done inside window"],
          ["Distance cleaned", `${totalKm.toFixed(0)} km`, `in ${days.length} days`],
        ].map(([l, v, sub]) => (
          <div key={l} className="panel px-3 py-2"><div className="label">{l}</div><div className="num text-[20px] font-semibold">{v}</div><div className="text-[10.5px] text-ink-3">{sub}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Chart title="Daily cleaning coverage" sub="% of scheduled road length cleaned">
          <AreaChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} domain={[0, 100]} unit="%" width={36} /><Tooltip {...TIP} />
            <Area type="monotone" dataKey="covPct" name="Coverage %" stroke="#10b981" fill="#10b98122" strokeWidth={2} /></AreaChart>
        </Chart>
        <Chart title="Weekly coverage trend" sub="week starting">
          <BarChart data={weekly.map((w) => ({ ...w, c: +(w.coverage * 100).toFixed(1) }))}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="week" {...AX} /><YAxis {...AX} domain={[0, 100]} unit="%" width={36} /><Tooltip {...TIP} />
            <Bar dataKey="c" name="Coverage %" fill="#22d3ee" radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        <Chart title="Distance cleaned vs driven" sub="km per day">
          <LineChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} width={36} /><Tooltip {...TIP} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="km" name="Cleaned km" stroke="#10b981" dot={false} strokeWidth={2} /><Line dataKey="dist" name="Driven km" stroke="#7dd3fc" dot={false} strokeWidth={2} strokeDasharray="4 3" /></LineChart>
        </Chart>
        <Chart title="Waste collected" sub="kg per day">
          <BarChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} width={36} /><Tooltip {...TIP} /><Bar dataKey="waste" name="Waste kg" fill="#a78bfa" radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        <Chart title="Fleet utilization" sub="% of available robot-hours spent working">
          <AreaChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} domain={[0, 100]} unit="%" width={36} /><Tooltip {...TIP} /><Area type="monotone" dataKey="utilPct" name="Utilization %" stroke="#22d3ee" fill="#22d3ee22" strokeWidth={2} /></AreaChart>
        </Chart>
        <Chart title="Mission completion & schedule adherence" sub="%">
          <LineChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} domain={[0, 100]} unit="%" width={36} /><Tooltip {...TIP} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="missionPct" name="Missions completed %" stroke="#10b981" dot={false} strokeWidth={2} /><Line dataKey="adhPct" name="On-time %" stroke="#f59e0b" dot={false} strokeWidth={2} /></LineChart>
        </Chart>
        <Chart title="Average time per street" sub="minutes per cleaned segment">
          <LineChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} width={36} /><Tooltip {...TIP} /><Line dataKey="mps" name="Minutes" stroke="#7dd3fc" dot={false} strokeWidth={2} /></LineChart>
        </Chart>
        <Chart title="Charging downtime" sub="robot-hours on chargers per day">
          <BarChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} width={36} /><Tooltip {...TIP} /><Bar dataKey="chg" name="Hours" fill="#10b981" radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        <Chart title="Maintenance incidents" sub="critical alerts and breakdowns per day">
          <BarChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} allowDecimals={false} width={36} /><Tooltip {...TIP} /><Bar dataKey="maintenance" name="Incidents" fill="#f97316" radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        <Chart title="Blocked areas & parking obstruction reports" sub="obstructions vs. enforcement cases created">
          <BarChart data={data}><CartesianGrid stroke="#1c2738" vertical={false} /><XAxis dataKey="label" {...AX} /><YAxis {...AX} allowDecimals={false} width={36} /><Tooltip {...TIP} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="obstructions" name="Obstructions" fill="#ef4444" radius={[3, 3, 0, 0]} /><Bar dataKey="enforcement" name="Cases" fill="#f59e0b" radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        <Panel title="Pending enforcement reviews" sub="live">
          <div className="grid h-[200px] place-items-center"><div className="text-center"><div className="num text-[44px] font-semibold" style={{ color: today && today.pending ? "#f59e0b" : "#10b981" }}>{today?.pending ?? 0}</div>
            <div className="text-[11.5px] text-ink-3">cases waiting for an operator</div></div></div>
        </Panel>
        <Panel title="Estimated operating efficiency" sub="assumptions, not measurements" actions={<Tag tone="warn">Assumption</Tag>}>
          <div className="space-y-1.5 px-3.5 py-3 text-[12px]">
            <div className="flex justify-between"><span className="text-ink-3">Km cleaned in period</span><span className="num">{totalKm.toFixed(0)} km</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Manual-crew equivalent*</span><span className="num">{(totalKm / ASSUMPTION_KM_PER_CREW_HOUR).toFixed(0)} crew-hours</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Robot active hours (simulated)</span><span className="num">{days.reduce((total, day) => total + day.activeHours, 0).toFixed(0)} h</span></div>
            <p className="pt-1 text-[10.5px] leading-snug text-ink-3">* Assumes a manual crew cleans {ASSUMPTION_KM_PER_CREW_HOUR} km of curb per crew-hour. Environmental or financial impact figures are not shown because no real measurements exist.</p>
          </div>
        </Panel>
      </div>
      <p className="mt-3 text-[11px] text-ink-3">Coverage is computed from cleaned road-segment length (metres), not from the count of streets. All data on this page is simulated.</p>
    </div>
  );
}
