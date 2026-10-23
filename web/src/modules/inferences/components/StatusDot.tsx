import { StatusIndicator, type StatusVariant } from "@modelsphere/ui";
import type { TFn } from "@/shell";
import type { State, Tone } from "@/modules/inferences/lib";
import { useT } from "@/modules/inferences/i18n";

const VARIANT: Record<Tone, StatusVariant> = {
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
  muted: "neutral",
};

const label = (state: State, t: TFn, suffix?: string) =>
  [t(`state.${state.key}`, { raw: state.raw ?? "" }), suffix].filter(Boolean).join(" ");

const inFlight = (key: string) => key === "applying" || key === "uninstalling";

export function statusOf(state: State, t: TFn, suffix?: string) {
  return { tone: VARIANT[state.tone], label: label(state, t, suffix), animated: inFlight(state.key) };
}

export function StatusDot({ state, suffix }: { state: State; suffix?: string }) {
  const t = useT();
  return <StatusIndicator variant={VARIANT[state.tone]} animated={inFlight(state.key)} label={label(state, t, suffix)} />;
}
