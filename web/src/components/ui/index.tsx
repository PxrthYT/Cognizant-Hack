import * as RDialog from "@radix-ui/react-dialog";
import * as RSwitch from "@radix-ui/react-switch";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RDropdown from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Button
const button = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-[#5ee0f2] shadow-[0_0_0_1px_rgba(34,211,238,0.3)]",
        secondary: "bg-elevated text-ink border border-line-2 hover:bg-[#1d2a3e] hover:border-[#33455f]",
        ghost: "text-ink-2 hover:text-ink hover:bg-elevated",
        danger: "bg-crit/15 text-[#fca5a5] border border-crit/40 hover:bg-crit/25",
        success: "bg-ok/15 text-[#6ee7b7] border border-ok/40 hover:bg-ok/25",
        warn: "bg-warn/15 text-[#fcd34d] border border-warn/40 hover:bg-warn/25",
      },
      size: { xs: "h-6 px-2 text-[11px]", sm: "h-7 px-2.5 text-xs", md: "h-8 px-3 text-[13px]", lg: "h-10 px-4 text-sm", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...p} />
));
Button.displayName = "Button";

// ---------------------------------------------------------------- Pills
export function Dot({ color, pulse, className }: { color: string; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function Pill({ color, children, pulse, className, title }: { color: string; children: ReactNode; pulse?: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[1px] text-[11px] font-medium", className)}
      style={{ borderColor: `${color}55`, background: `${color}14`, color: "#e6ecf4" }}
    >
      <Dot color={color} pulse={pulse} />
      {children}
    </span>
  );
}

export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "sim" | "real" | "manual" | "warn" | "crit" | "ok" | "accent"; className?: string }) {
  const tones = {
    neutral: "text-ink-2 border-line-2 bg-elevated",
    sim: "text-[#c4b5fd] border-[#a78bfa55] bg-[#a78bfa14]",
    real: "text-[#6ee7b7] border-[#10b98155] bg-[#10b98114]",
    manual: "text-[#fcd34d] border-[#f59e0b55] bg-[#f59e0b14]",
    warn: "text-[#fcd34d] border-[#f59e0b55] bg-[#f59e0b14]",
    crit: "text-[#fca5a5] border-[#ef444455] bg-[#ef444414]",
    ok: "text-[#6ee7b7] border-[#10b98155] bg-[#10b98114]",
    accent: "text-[#67e8f9] border-[#22d3ee55] bg-[#22d3ee14]",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider", tones[tone], className)}>{children}</span>;
}

// ---------------------------------------------------------------- Panel
export function Panel({ title, actions, children, className, bodyClass, icon, sub }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; icon?: ReactNode; sub?: ReactNode;
}) {
  return (
    <section className={cn("panel flex min-h-0 flex-col", className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          {icon && <span className="text-ink-3">{icon}</span>}
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold tracking-tight">{title}</h3>
            {sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}
          </div>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClass)}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- Metric tile
export function Metric({ label, value, sub, tone, icon, onClick, className }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon?: ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("panel group flex min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors", onClick && "hover:border-line-2 cursor-pointer", !onClick && "cursor-default", className)}
    >
      <div className="flex w-full items-center gap-1.5">
        <span className="label truncate">{label}</span>
        {icon && <span className="ml-auto text-ink-3">{icon}</span>}
      </div>
      <div className="num text-[19px] font-semibold leading-tight tracking-tight" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="w-full truncate text-[11px] text-ink-3">{sub}</div>}
    </button>
  );
}

// ---------------------------------------------------------------- Progress
export function Progress({ value, color = "#22d3ee", className, track = "#1c2738", striped }: { value: number; color?: string; className?: string; track?: string; striped?: boolean }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", className)} style={{ background: track }}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", striped && "charging-bar")} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }} />
    </div>
  );
}

// ---------------------------------------------------------------- Gauge (semi-circle)
export function Gauge({ value, max = 100, label, unit = "%", color, stale, decimals = 0, size = 92 }: {
  value: number; max?: number; label: string; unit?: string; color: string; stale?: boolean; decimals?: number; size?: number;
}) {
  const f = Math.max(0, Math.min(1, value / max));
  const r = 36;
  const len = Math.PI * r;
  return (
    <div className={cn("flex flex-col items-center", stale && "opacity-45")} title={stale ? "Telemetry is stale" : undefined}>
      <svg width={size} height={size * 0.62} viewBox="0 0 92 57">
        <path d="M 10 50 A 36 36 0 0 1 82 50" fill="none" stroke="#1c2738" strokeWidth="7" strokeLinecap="round" />
        <path d="M 10 50 A 36 36 0 0 1 82 50" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${len * f} ${len}`} style={{ transition: "stroke-dasharray 0.5s ease" }} />
        <text x="46" y="44" textAnchor="middle" className="num" fill="#e6ecf4" fontSize="15" fontWeight="600">
          {value.toFixed(decimals)}
          <tspan fontSize="9" fill="#6c7a8e">{unit}</tspan>
        </text>
      </svg>
      <div className="label -mt-0.5 text-center">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Sparkline
export function Sparkline({ data, color = "#22d3ee", height = 28, min, max, className }: { data: number[]; color?: string; height?: number; min?: number; max?: number; className?: string }) {
  if (data.length < 2) return <div className={className} style={{ height }} />;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const w = 120;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - lo) / span) * (height - 3) - 1.5}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <polyline points={`0,${height} ${pts} ${w},${height}`} fill={`${color}18`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------- Switch
export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2" htmlFor={id}>
      <RSwitch.Root id={id} checked={checked} onCheckedChange={onChange}
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-line-2 bg-elevated transition-colors data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/30">
        <RSwitch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-ink-2 transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent" />
      </RSwitch.Root>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- Segmented control
export function Segmented<T extends string | number>({ value, options, onChange, size = "sm" }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "xs" | "sm";
}) {
  return (
    <div className="inline-flex rounded-md border border-line-2 bg-surface p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={cn("rounded px-2 font-medium transition-colors", size === "xs" ? "h-5 text-[10.5px]" : "h-6 text-[11.5px]",
            o.value === value ? "bg-elevated text-ink shadow-[0_0_0_1px_#33455f]" : "text-ink-3 hover:text-ink-2")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Tooltip
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6}
          className="z-[100] max-w-[280px] rounded-md border border-line-2 bg-elevated px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-xl">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
export const TipProvider = RTooltip.Provider;

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onOpenChange, title, description, children, width = 560 }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[2px]" />
        <RDialog.Content className="panel fixed left-1/2 top-1/2 z-[90] max-h-[86vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden border-line-2 bg-panel shadow-2xl"
          style={{ width: `min(${width}px, 94vw)` }}>
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div>
              <RDialog.Title className="text-sm font-semibold">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-0.5 text-xs text-ink-3">{description}</RDialog.Description>}
            </div>
            <RDialog.Close className="ml-auto rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink"><X size={15} /></RDialog.Close>
          </div>
          <div className="max-h-[calc(86vh-56px)] overflow-y-auto p-4">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------------------------------------------------------------- Dropdown
export const Menu = RDropdown.Root;
export const MenuTrigger = RDropdown.Trigger;
export function MenuContent({ children, align = "end", width = 260 }: { children: ReactNode; align?: "start" | "end" | "center"; width?: number }) {
  return (
    <RDropdown.Portal>
      <RDropdown.Content align={align} sideOffset={6} style={{ width }}
        className="z-[70] overflow-hidden rounded-lg border border-line-2 bg-panel p-1 shadow-2xl">
        {children}
      </RDropdown.Content>
    </RDropdown.Portal>
  );
}
export function MenuItem({ children, onSelect, disabled, className }: { children: ReactNode; onSelect?: () => void; disabled?: boolean; className?: string }) {
  return (
    <RDropdown.Item disabled={disabled} onSelect={onSelect}
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-elevated data-[highlighted]:text-ink", className)}>
      {children}
    </RDropdown.Item>
  );
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <RDropdown.Label className="label px-2 pb-1 pt-2">{children}</RDropdown.Label>;
}
export const MenuSeparator = () => <RDropdown.Separator className="my-1 h-px bg-line" />;

// ---------------------------------------------------------------- misc
export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-ink-3">{icon}{children}</div>;
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="shrink-0 text-[11.5px] text-ink-3">{k}</span>
      <span className={cn("num min-w-0 truncate text-right text-[12.5px] text-ink", mono && "mono")}>{v}</span>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-8 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60 focus:ring-2 focus:ring-accent/15";
