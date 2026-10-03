import { cn } from "@modelsphere/ui";
import type { State, Tone } from "@/modules/inferences/lib";
import { useT } from "@/modules/inferences/i18n";

const DOT: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info animate-pulse",
  warning: "bg-warning",
  error: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

// A dot and a word: the state read at a glance, the way Rise Global's lists
// show it. The kit has no status indicator, so it lives here.
export function StatusDot({ state, suffix, className }: { state: State; suffix?: string; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[state.tone])} aria-hidden />
      <span>{t(`state.${state.key}`, { raw: state.raw ?? "" })}</span>
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </span>
  );
}
