import { ErrorNotice } from "../../components/ErrorNotice";
import { asError } from "../../lib/errors";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  FieldInput,
  FloatingField,
  SectionCard,
} from "@modelsphere/ui";
import { useTranslation } from "../../lib/translation";
import { useCanaryApi, useCanaryWrite } from "../../lib/provider";
import type { Metrics } from "../../types";
import { format } from "../../lib/metric-presentation";
export function EconomicsSettings({
  data,
  experimentId,
}: {
  data: Metrics;
  experimentId: string;
}) {
  const { t } = useTranslation("canary");
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [arms, setArms] = useState(() =>
    (Object.keys(data.economics?.arms ?? {}).length
      ? Object.keys(data.economics!.arms)
      : data.compareArms
    ).map((name) => {
      const x = data.economics?.arms[name];
      return {
        name,
        pricingKey: x?.resolution === "exact" ? x.pricingKey : "",
        gpuCount:
          x?.gpuSource === "manual" ? (x.gpuCount ?? undefined) : undefined,
      };
    }),
  );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.experiments.revalue(
        experimentId,
        data.economics?.revision ?? 0,
        arms,
      );
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ["experiment-metrics", api.mode, experimentId],
        }),
        qc.invalidateQueries({
          queryKey: ["experiment", api.mode, experimentId],
        }),
      ]);
      setEditing(false);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SectionCard title={t("economics.frozen")}>
      {!data.economics && <p className="text-sm">{t("economics.legacy")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {data.compareArms.map((name) => {
          const x = data.economics?.arms[name];
          const rates = x?.prices[data.valuation.currency ?? "USD"];
          return (
            <div key={name} className="rounded-md border p-3 text-sm">
              <strong>{name}</strong> · {t("economics.gpuTotal")}:{" "}
              {x?.gpuCount ?? "—"} ·{" "}
              {t(`economics.${x?.gpuSource ?? "unknown"}`)}
              <p>
                {t("economics.pricingKey")}: {x?.pricingKey || "—"} ·{" "}
                {t(`economics.${x?.resolution ?? "missing"}`)}
              </p>
              <p>
                {rates
                  ? `${data.valuation.currency} / 1M · ${t("economics.inputPerMillion")} ${format(rates.inputPerMillion)} · ${t("economics.cachedPerMillion")} ${format(rates.cachedPerMillion)} · ${t("economics.outputPerMillion")} ${format(rates.outputPerMillion)}`
                  : t("economics.unpriced")}
              </p>
            </div>
          );
        })}
      </div>
      {data.economics && (
        <p className="mt-2 text-xs text-muted-foreground">
          {new Date(data.economics.frozenAt).toLocaleString()} ·{" "}
          {data.economics.frozenBy} · {t("economics.priceRevision")}{" "}
          {data.economics.pricingRevision}
        </p>
      )}
      {canWrite && (
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => setEditing(!editing)}
          disabled={busy}
        >
          {t("economics.revalue")}
        </Button>
      )}
      {editing && (
        <div className="mt-3 grid gap-3">
          <p className="text-sm text-muted-foreground">
            {t("economics.revalueHint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("economics.bindingHint")}
          </p>
          {arms.map((arm, index) => (
            <div key={arm.name} className="grid gap-3 sm:grid-cols-3">
              <strong>{arm.name}</strong>
              <FloatingField label={t("economics.pricingKey")}>
                <FieldInput
                  disabled={busy}
                  value={arm.pricingKey}
                  onChange={(e) =>
                    setArms(
                      arms.map((a, i) =>
                        i === index ? { ...a, pricingKey: e.target.value } : a,
                      ),
                    )
                  }
                />
              </FloatingField>
              <FloatingField label={t("economics.gpuOverride")}>
                <FieldInput
                  disabled={busy}
                  type="number"
                  min={1}
                  max={1024}
                  step={1}
                  value={arm.gpuCount ?? ""}
                  onChange={(e) =>
                    setArms(
                      arms.map((a, i) =>
                        i === index
                          ? {
                              ...a,
                              gpuCount:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            }
                          : a,
                      ),
                    )
                  }
                />
              </FloatingField>
            </div>
          ))}
          <Button disabled={busy} onClick={() => void save()}>
            {t("economics.applyCurrentPrices")}
          </Button>
        </div>
      )}
      {error && <ErrorNotice error={error} className="mt-2 text-destructive" />}
    </SectionCard>
  );
}
