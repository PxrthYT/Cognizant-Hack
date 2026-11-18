import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RobotStatus, SegmentStatus, Severity } from "@/sim/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const km = (m: number, digits = 1) => `${(m / 1000).toFixed(digits)} km`;

export const SEGMENT_COLOR: Record<SegmentStatus, string> = {
  cleaned: "#10b981",
  cleaning: "#22d3ee",
  scheduled: "#f59e0b",
  blocked: "#ef4444",
  inactive: "#4b5a6e",
};

export const ROBOT_COLOR: Record<RobotStatus, string> = {
  cleaning: "#22d3ee",
  navigating: "#7dd3fc",
  idle: "#94a3b8",
  charging: "#10b981",
  returning: "#a78bfa",
  blocked: "#ef4444",
  paused: "#f59e0b",
  maintenance: "#f97316",
  offline: "#64748b",
};

export const SEVERITY_COLOR: Record<Severity | "success", string> = {
  info: "#7dd3fc",
  warning: "#f59e0b",
  critical: "#ef4444",
  success: "#10b981",
};

export function maskPlate(p: string, mask: boolean) {
  if (!mask || !p) return p;
  return p.replace(/(?<=^.)[A-Z0-9](?=.* )/g, "•").replace(/\d(?=\d)/g, "•");
}
