import { useState } from "react";
import { Button, FieldInput, FloatingField, SectionCard } from "@modelsphere/ui";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { useTranslation } from "../lib/translation";
import { asError } from "../lib/errors";
import type { Experiment } from "../types";
import { ErrorNotice } from "./ErrorNotice";
import { TrafficBar } from "./TrafficBar";

export function validTrafficWeights(production: string, canary: string) {
  if (production.trim() === "" || canary.trim() === "") return false;
  const values = [Number(production), Number(canary)];
  return values.every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 1000000) && values[0] + values[1] > 0;
}

export function canAdjustTraffic(experiment: Experiment, canWrite: boolean) {
  const { canary } = experiment;
  return canWrite && experiment.state === "Running" && !experiment.stopAt && experiment.cleanup !== "complete" && !!experiment.uid &&
    canary.spec.route.enabled !== false && !!canary.metadata.generation && canary.status?.phase === "Serving" &&
    canary.status.observedGeneration === canary.metadata.generation &&
    !!canary.status.conditions?.some((c) => c.type === "TrafficProgrammed" && c.status === "True") &&
    !canary.status.conditions?.some((c) => c.type === "Degraded" && c.status === "True");
}

export function TrafficEditor({ experiment, onRefresh }: { experiment: Experiment; onRefresh?: () => void }) {
  const { t } = useTranslation("canary");
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const current = experiment.canary.spec.traffic;
  const [production, setProduction] = useState(String(current.production));
  const [canary, setCanary] = useState(String(current.canary));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const changes = experiment.trafficChanges ?? [];
  const pending = changes.some((c) => c.status === "pending" || c.status === "applying");
  const editable = canAdjustTraffic(experiment, canWrite);
  const valid = validTrafficWeights(production, canary);
  const unchanged = Number(production) === current.production && Number(canary) === current.canary;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editable || !valid || unchanged || busy || pending) return;
    setBusy(true); setError(null);
    try {
      await api.experiments.updateTraffic(experiment.id, { production: Number(production), canary: Number(canary), expectedGeneration: experiment.canary.metadata.generation! });
      onRefresh?.();
    } catch (e) { setError(asError(e)); }
    finally { setBusy(false); }
  }
  return <div className="mb-4 grid gap-4">
    {editable && <SectionCard title={t("trafficUpdate.title")} hint={t("trafficUpdate.hint")}>
      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FloatingField label={t("create.weightProd")}><FieldInput aria-label={t("create.weightProd")} type="number" min={0} max={1000000} step={1} required disabled={busy || pending} value={production} onChange={(e) => setProduction(e.target.value)} /></FloatingField>
          <FloatingField label={t("create.weightCanary")}><FieldInput aria-label={t("create.weightCanary")} type="number" min={0} max={1000000} step={1} required disabled={busy || pending} value={canary} onChange={(e) => setCanary(e.target.value)} /></FloatingField>
        </div>
        {valid ? <TrafficBar production={Number(production)} canary={Number(canary)} /> : <p role="alert" className="text-sm text-destructive">{t("trafficUpdate.invalid")}</p>}
        <Button type="submit" disabled={busy || pending || !valid || unchanged}>{t(busy ? "trafficUpdate.submitting" : "trafficUpdate.submit")}</Button>
      </form>
    </SectionCard>}
    {error && <ErrorNotice error={error} />}
    {pending && <p role="status" className="text-sm">{t("trafficUpdate.waiting")}</p>}
    {changes.length > 0 && <SectionCard title={t("trafficUpdate.history")}>
      <ul className="grid gap-3 text-sm">{[...changes].reverse().map((c) => <li key={c.id} className="border-b pb-3 last:border-b-0">
        <p>{c.from.production}:{c.from.canary} → {c.to.production}:{c.to.canary} · {t(`trafficUpdate.${c.status}`)}</p>
        <p className="text-xs text-muted-foreground">{new Date(c.requestedAt).toLocaleString()} · {c.requestedBy}</p>
        {c.error && <ErrorNotice error={c.error} />}
      </li>)}</ul>
    </SectionCard>}
  </div>;
}
