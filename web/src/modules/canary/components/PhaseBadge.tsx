import { StatusIndicator, type StatusVariant } from "@modelsphere/ui";
import { useTranslation } from "../lib/translation";
import type { Phase } from "../types";

const PHASE: Record<Phase, { variant: StatusVariant; animated?: boolean }> = {
  Serving: { variant: "success" },
  Provisioning: { variant: "info", animated: true },
  Idle: { variant: "default" },
  Draining: { variant: "warning", animated: true },
  Failed: { variant: "error" },
};

/**
 * Shared status for the list and the detail header. A stopped experiment is
 * historical whatever phase it last reported, so both surfaces agree on the
 * label, colour and the absence of animation.
 */
export function phaseStatus(
  phase?: Phase,
  stopped = false,
  stoppedLabel = "Stopped",
) {
  if (stopped) {
    return { tone: "default" as const, label: stoppedLabel, animated: false };
  }
  const value = phase ?? "Idle";
  const spec = PHASE[value];
  return { tone: spec.variant, label: value, animated: spec.animated };
}

export function PhaseBadge({
  phase,
  state,
}: {
  phase?: Phase;
  state?: string;
}) {
  const { t } = useTranslation("canary");
  const historical = state === "Stopped";
  const status = phaseStatus(phase, historical, t("experiments.Stopped"));
  return (
    <span title={historical ? t("detail.historicalHint") : undefined}>
      <StatusIndicator
        variant={status.tone}
        label={status.label}
        animated={status.animated}
      />
    </span>
  );
}
