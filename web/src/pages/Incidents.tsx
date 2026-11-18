import { motion } from "motion/react";
import { Check, CheckCircle2, CircleDashed, Eye, FileSearch, Send, ShieldCheck, ThumbsDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CaseStatusPill } from "@/components/common/status";
import { Button, Empty, KV, Panel, Tag, inputCls } from "@/components/ui";
import { fmtT } from "@/sim/engine";
import { CASE_LABEL, caseVisible, fmtDayTime } from "@/sim/selectors";
import { WORKFLOW_STAGES, type EnforcementCase } from "@/sim/types";
import { useEngine, useSim } from "@/store/sim";
import { toast } from "@/store/toast";
import { useUi } from "@/store/ui";
import { cn, maskPlate, pct } from "@/lib/utils";

type Filter = "open" | "all" | "closed";

export default function Incidents() {
  const sim = useEngine();
  const param = useUi((s) => s.param);
  const navigate = useUi((s) => s.navigate);
  const s = sim.s;
  const cases = s.caseOrder.map((c) => s.cases[c]).filter((c) => caseVisible(s, c)).reverse();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = cases.filter((c) => filter === "all" || (filter === "open" ? c.status === "awaiting_review" || c.status === "approved" : !["awaiting_review", "approved"].includes(c.status)));
  const sel = param && s.cases[param] ? s.cases[param] : shown[0] ?? cases[0];
  useEffect(() => {
    if (!param && sel) navigate("incidents", sel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full grid-cols-[340px_minmax(0,1fr)] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-2">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Incidents & Enforcement</h1>
          <p className="text-[11.5px] text-ink-3">Obstructions detected during scheduled cleaning. A parked car is a referral only if a posted restriction applies and an operator approves.</p>
        </div>
        <div className="flex gap-1.5">
          {([["all", "All"], ["open", "Needs action"], ["closed", "Closed"]] as [Filter, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFilter(v)} className={cn("h-7 rounded-full border px-3 text-[11.5px]", filter === v ? "border-accent/50 bg-accent/10" : "border-line text-ink-2")}>{l}</button>
          ))}
        </div>
        <div className="panel min-h-0 flex-1 overflow-y-auto">
          {!shown.length && <Empty>No cases in this view.</Empty>}
          {shown.map((c) => {
            const inc = s.incidents[c.incidentId];
            return (
              <button key={c.id} type="button" onClick={() => navigate("incidents", c.id)}
                className={cn("block w-full border-b border-line/70 px-3 py-2.5 text-left last:border-0 hover:bg-panel-2", sel?.id === c.id && "bg-elevated shadow-[inset_2px_0_0_#22d3ee]")}>
                <div className="flex items-center gap-2"><span className="mono text-[12px] font-semibold">{c.id}</span><CaseStatusPill status={c.status} /></div>
                <div className="mt-1 truncate text-[12px]">{s.segments[inc.segmentId].name}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">{fmtT(inc.t)} · {inc.robotId} · {inc.vehicle.color} {inc.vehicle.body}</div>
              </button>
            );
          })}
        </div>
      </div>
      {sel ? <CaseDetail c={sel} /> : <Panel><Empty icon={<ShieldCheck size={28} />}>No obstruction cases yet. Cases appear when a robot meets a parked car during a cleaning window.</Empty></Panel>}
    </div>
  );
}

function WorkflowStepper({ c }: { c: EnforcementCase }) {
  const sim = useEngine();
  const t = sim.s.t;
  const done = c.stages.map((x) => x !== null && t >= x);
  const firstPending = done.findIndex((d) => !d);
  const skipped = c.status === "no_violation";
  return (
    <div className="flex items-start">
      {WORKFLOW_STAGES.map((label, i) => {
        const complete = done[i];
        const current = i === firstPending && !skipped;
        const skip = skipped && (i === 5 || i === 6);
        return (
          <div key={label} className="flex min-w-0 flex-1 items-start">
            <div className="flex w-full flex-col items-center text-center">
              <motion.div initial={false} animate={{ scale: complete ? [1, 1.18, 1] : 1 }} transition={{ duration: 0.5 }}
                className={cn("grid h-7 w-7 place-items-center rounded-full border-2",
                  skip ? "border-line-2 text-ink-3" : complete ? "border-ok bg-ok/15 text-ok" : current ? "border-warn bg-warn/15 text-warn" : "border-line-2 text-ink-3")}>
                {skip ? <X size={13} /> : complete ? <Check size={14} /> : current ? <span className="h-2 w-2 animate-pulse rounded-full bg-warn" /> : <CircleDashed size={13} />}
              </motion.div>
              <div className={cn("mt-1.5 px-0.5 text-[10.5px] font-medium leading-tight", complete ? "text-ink" : current ? "text-[#fcd34d]" : "text-ink-3")}>{label}</div>
              <div className="mono mt-0.5 text-[10px] text-ink-3">{complete && c.stages[i] ? fmtT(c.stages[i]!) : current ? "now" : skip ? "n/a" : ""}</div>
            </div>
            {i < WORKFLOW_STAGES.length - 1 && <div className={cn("mt-3.5 h-0.5 w-3 shrink-0 rounded", complete && done[i + 1] ? "bg-ok" : complete ? "bg-gradient-to-r from-ok to-line-2" : "bg-line-2")} />}
          </div>
        );
      })}
    </div>
  );
}

function CaseDetail({ c }: { c: EnforcementCase }) {
  const sim = useEngine();
  const act = useSim((s) => s.act);
  const masked = useUi((s) => s.settings.maskPlates);
  const select = useUi((s) => s.select);
  const navigate = useUi((s) => s.navigate);
  const flyTo = useUi((s) => s.flyTo);
  const s = sim.s;
  const inc = s.incidents[c.incidentId];
  const seg = s.segments[inc.segmentId];
  const [plate, setPlate] = useState(c.plate);
  const [note, setNote] = useState("");
  useEffect(() => { setPlate(c.plate); setNote(""); }, [c.id, c.plate]);
  const review = c.status === "awaiting_review";
  const revisit = inc.revisitMissionId ? s.missions[inc.revisitMissionId] : null;
  const lowOcr = inc.plateSource === "ocr-simulated" && inc.ocrConfidence < 0.85;
  const approved = c.status === "approved";

  const decide = (d: "approved" | "rejected" | "insufficient_evidence") => {
    if (plate.trim().toUpperCase() !== c.plate) act((x) => x.correctPlate(c.id, plate));
    act((x) => x.decideCase(c.id, d, note));
    toast(d === "approved" ? "Referral approved" : d === "rejected" ? "Case rejected" : "Marked insufficient evidence", c.id, d === "approved" ? "success" : "info");
  };

  return (
    <div className="min-h-0 space-y-3 overflow-y-auto pr-0.5">
      <Panel>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="mono text-[17px] font-semibold">{c.id}</span>
          <CaseStatusPill status={c.status} />
          <span className="text-[12px] text-ink-3">Incident <span className="mono">{inc.id}</span> · {fmtDayTime(inc.t)}</span>
          <Tag tone="sim" className="ml-auto">Simulation · no real agency receives data</Tag>
        </div>
        <div className="px-4 py-4"><WorkflowStepper c={c} /></div>
      </Panel>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3">
        <div className="space-y-3">
          <Panel title="Evidence" actions={<Tag tone={inc.evidence.source === "camera" ? "real" : "sim"}>{inc.evidence.source === "camera" ? "Camera snapshot" : "Simulated evidence"}</Tag>}>
            <div className="relative @container">
              <img src={inc.evidence.image} alt="Obstruction evidence" className="block w-full" />
              {inc.evidence.syntheticPlate && (
                <span className="absolute left-[80.1%] top-[54.2%] -translate-x-1/2 -translate-y-1/2 -rotate-3 whitespace-nowrap font-mono text-[1.22cqw] font-semibold tracking-tight text-[#252830]">
                  {maskPlate(inc.evidence.syntheticPlate, masked)}
                </span>
              )}
              <div className="absolute left-3 top-3 rounded bg-bg/80 px-2 py-1 text-[10.5px] text-ink-2 backdrop-blur">
                <span className="mono">{inc.robotId}</span> · {fmtT(inc.t)} · {inc.pos[1].toFixed(5)}, {inc.pos[0].toFixed(5)}
              </div>
              {inc.evidence.source === "simulated" && (
                <div className="absolute right-[5%] top-[24%] h-[55%] w-[62%] rounded border border-accent/70" aria-label="Detected vehicle">
                  <span className="absolute bottom-full left-0 rounded-t bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">Vehicle {pct(inc.vehicleConfidence)}</span>
                </div>
              )}
              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                <div className="rounded-md border border-line-2 bg-bg/85 px-3 py-1.5 backdrop-blur">
                  <div className="label">Recognized plate (synthetic)</div>
                  <div className="mono text-[18px] font-semibold tracking-widest">{maskPlate(c.plate, masked)}</div>
                </div>
                <div className="text-right text-[10.5px] text-ink-3">{inc.evidence.note}</div>
              </div>
            </div>
          </Panel>
          <Panel title="Audit trail" sub={`${c.audit.length} entries`}>
            <ol className="relative space-y-0 p-3">
              {[...c.audit].filter((a) => a.t <= s.t).map((a, i, arr) => (
                <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < arr.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-line-2" />}
                  <span className="relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-accent bg-panel" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2"><span className="mono text-[11px] text-ink-3">{fmtT(a.t)}</span><span className="text-[12.5px] font-medium">{a.action}</span><span className="text-[11px] text-ink-3">· {a.actor}</span></div>
                    {a.detail && <div className="text-[11.5px] text-ink-2">{a.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Human review">
            <div className="space-y-3 p-3.5">
              {c.status === "no_violation" && (
                <div className="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12px] text-ink-2">No enforcement referral was created. {c.check.reason}</div>
              )}
              {review && (
                <>
                  <div className="flex items-center gap-2 text-[12px]">
                    <Button size="xs" variant={c.evidenceReviewed ? "success" : "secondary"} onClick={() => act((x) => x.reviewEvidence(c.id))}>
                      {c.evidenceReviewed ? <><CheckCircle2 size={12} />Evidence reviewed</> : <><Eye size={12} />Mark evidence reviewed</>}
                    </Button>
                  </div>
                  {lowOcr && <div className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11.5px] text-[#fcd34d]">Plate read is only {pct(inc.ocrConfidence)} confident. Compare with the image and correct it if needed.</div>}
                  <label className="block">
                    <span className="label mb-1 block">Plate (correct OCR result)</span>
                    <input className={cn(inputCls, "mono text-[14px] uppercase tracking-widest")} value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={10} />
                  </label>
                  <label className="block">
                    <span className="label mb-1 block">Reviewer note</span>
                    <input className={inputCls} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button variant="success" disabled={!c.evidenceReviewed || !plate.trim()} onClick={() => decide("approved")}><Check size={13} />Approve referral</Button>
                    <Button variant="danger" onClick={() => decide("rejected")}><ThumbsDown size={13} />Reject case</Button>
                    <Button className="col-span-2" onClick={() => decide("insufficient_evidence")}><FileSearch size={13} />Mark insufficient evidence</Button>
                  </div>
                  {!c.evidenceReviewed && <div className="text-[11px] text-ink-3">Review the evidence before approving.</div>}
                </>
              )}
              {approved && (
                <>
                  <div className="rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-[12px] text-[#6ee7b7]">Approved. Not yet sent anywhere.</div>
                  <Button variant="primary" className="w-full" onClick={() => { act((x) => x.forwardCase(c.id)); toast("Routed to " + c.department, "Simulated forwarding. No data left this app.", "success"); }}>
                    <Send size={13} />Route to {c.department} (simulated)
                  </Button>
                </>
              )}
              {(c.status === "forwarded" || c.status === "acknowledged") && (
                <div className="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12px]">{c.status === "acknowledged" ? "Acknowledged by" : "Routed to"} {c.department} (simulated).</div>
              )}
              {(c.status === "rejected" || c.status === "insufficient_evidence") && <div className="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink-2">Case closed: {CASE_LABEL[c.status].toLowerCase()}. No referral was made.</div>}
            </div>
          </Panel>

          <Panel title="Restriction check">
            <div className="px-3.5 py-2">
              <div className={cn("mb-2 rounded-md border px-2.5 py-1.5 text-[12px]", c.check.applies ? "border-warn/40 bg-warn/10 text-[#fcd34d]" : "border-line-2 bg-panel-2 text-ink-2")}>{c.check.reason}</div>
              <KV k="Applicable restriction" v={<span className="whitespace-normal">{c.check.restriction}</span>} />
              <KV k="Sign posted" v={c.check.signed ? "Yes" : "No"} />
              <KV k="Within window" v={c.check.withinWindow ? "Yes" : "No"} />
              <KV k="Cleaning schedule" v={`${fmtT(seg.window.start)} - ${fmtT(seg.window.end)}`} />
            </div>
          </Panel>

          <Panel title="Incident details">
            <div className="px-3.5 py-2">
              <KV k="Detection time" v={fmtT(inc.t)} />
              <KV k="Robot" v={<button type="button" className="mono text-accent hover:underline" onClick={() => select({ kind: "robot", id: inc.robotId })}>{inc.robotId}</button>} />
              <KV k="Street" v={<button type="button" className="text-accent hover:underline" onClick={() => { select({ kind: "segment", id: seg.id }); flyTo({ center: inc.pos, zoom: 17 }); navigate("map"); }}>{seg.name}</button>} />
              <KV k="GPS fix" v={<span className="mono">{inc.pos[1].toFixed(5)}, {inc.pos[0].toFixed(5)}</span>} />
              <KV k="Vehicle" v={`${inc.vehicle.color} ${inc.vehicle.body}`} />
              <KV k="Vehicle detection" v={pct(inc.vehicleConfidence)} />
              <KV k="OCR confidence" v={inc.plateSource === "manual" ? "Manual entry" : pct(inc.ocrConfidence)} />
              <KV k="Department" v={c.department} />
              <KV k="Revisit" v={revisit ? `${revisit.status} · ${fmtT(revisit.window.start)}${inc.resolved ? " · cleared" : ""}` : "-"} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
