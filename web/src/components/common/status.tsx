import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { fmtT } from "@/sim/engine";
import { CASE_LABEL, SEGMENT_LABEL, STATUS_LABEL } from "@/sim/selectors";
import type { CaseStatus, RobotStatus, SegmentStatus, SimEvent } from "@/sim/types";
import { ROBOT_COLOR, SEGMENT_COLOR, SEVERITY_COLOR, cn } from "@/lib/utils";
import { Pill } from "@/components/ui";
import { useUi } from "@/store/ui";

export function RobotStatusPill({ status, className }: { status: RobotStatus; className?: string }) {
  return <Pill color={ROBOT_COLOR[status]} pulse={status === "cleaning"} className={className}>{STATUS_LABEL[status]}</Pill>;
}

export function SegmentStatusPill({ status }: { status: SegmentStatus }) {
  return <Pill color={SEGMENT_COLOR[status]}>{SEGMENT_LABEL[status]}</Pill>;
}

export const CASE_COLOR: Record<CaseStatus, string> = {
  awaiting_review: "#f59e0b",
  approved: "#22d3ee",
  forwarded: "#7dd3fc",
  acknowledged: "#10b981",
  rejected: "#64748b",
  insufficient_evidence: "#94a3b8",
  no_violation: "#64748b",
};

export function CaseStatusPill({ status }: { status: CaseStatus }) {
  return <Pill color={CASE_COLOR[status]} pulse={status === "awaiting_review"}>{CASE_LABEL[status]}</Pill>;
}

export function SeverityIcon({ severity, size = 14 }: { severity: SimEvent["severity"]; size?: number }) {
  const c = SEVERITY_COLOR[severity];
  if (severity === "critical") return <OctagonAlert size={size} color={c} />;
  if (severity === "warning") return <AlertTriangle size={size} color={c} />;
  if (severity === "success") return <CheckCircle2 size={size} color={c} />;
  return <Info size={size} color={c} />;
}

export function EventRow({ e, compact }: { e: SimEvent; compact?: boolean }) {
  const { select, navigate } = useUi.getState();
  const open = () => {
    if (e.caseId) return navigate("incidents", e.caseId);
    if (e.incidentId) return select({ kind: "incident", id: e.incidentId });
    if (e.segmentId) return select({ kind: "segment", id: e.segmentId });
    if (e.robotId) return select({ kind: "robot", id: e.robotId });
    if (e.stationId) return select({ kind: "station", id: e.stationId });
  };
  return (
    <button type="button" onClick={open}
      className={cn("flex w-full items-start gap-2 rounded-md px-2 text-left transition-colors hover:bg-elevated", compact ? "py-1" : "py-1.5")}>
      <span className="mt-[2px] shrink-0"><SeverityIcon severity={e.severity} size={13} /></span>
      <span className="mono shrink-0 pt-px text-[10.5px] text-ink-3">{fmtT(e.t)}</span>
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">{e.message}</span>
    </button>
  );
}
