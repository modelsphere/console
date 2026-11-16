import { Badge } from "@modelsphere/ui";
import type { Condition, Phase } from "../types";
import { useTranslation } from "../lib/translation";
import { ErrorNotice } from "./ErrorNotice";

export function CanaryCondition({ condition, phase }: { condition: Condition; phase?: Phase }) {
  const { t } = useTranslation();
  const degraded = condition.type === "Degraded";
  const failed = degraded
    ? condition.status === "True"
    : condition.status === "False" && phase === "Failed";
  const healthy = degraded
    ? condition.status === "False"
    : condition.status === "True";
  const waiting = !failed && condition.status === "False" &&
    (condition.reason === "ArmsNotReady" || condition.reason === "ProxyNotReady");
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={failed ? "destructive" : healthy ? "success" : "secondary"}>
          {condition.status}
        </Badge>
        <span className="font-medium">{condition.type}</span>
        <span className="text-xs text-muted-foreground">{condition.reason}</span>
      </div>
      {failed && condition.message ? (
        <ErrorNotice error={condition.message} fallback="condition" className="mt-1 text-xs text-destructive" />
      ) : waiting ? (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t(condition.reason === "ArmsNotReady" ? "detail.waitingArms" : "detail.waitingProxy")}
        </p>
      ) : condition.message ? (
        <p className="mt-1 text-xs text-muted-foreground">{condition.message}</p>
      ) : null}
    </div>
  );
}
