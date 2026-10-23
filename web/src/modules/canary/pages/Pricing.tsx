import { ErrorNotice } from "../components/ErrorNotice";
import { asError } from "../lib/errors";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  FieldInput,
  FieldSelect,
  FloatingField,
  PageBanner,
  SectionCard,
} from "@modelsphere/ui";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { useTranslation } from "../lib/translation";
import type { Currency, ModelPrices, PricingTable } from "../types";

export function PriceFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ModelPrices;
  onChange: (value: ModelPrices) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("canary");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(["USD", "CNY"] as Currency[]).map((currency) => {
        const prices = value[currency];
        return (
          <fieldset
            key={currency}
            disabled={disabled}
            className="grid gap-3 rounded-md border p-3"
          >
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={prices !== null}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [currency]: e.target.checked
                      ? {
                          inputPerMillion: 0,
                          cachedPerMillion: 0,
                          outputPerMillion: 0,
                        }
                      : null,
                  })
                }
              />
              {currency} · {t("economics.perMillion")}
            </label>
            {prices && (
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    "inputPerMillion",
                    "cachedPerMillion",
                    "outputPerMillion",
                  ] as const
                ).map((key) => (
                  <FloatingField key={key} label={t(`economics.${key}`)}>
                    <FieldInput
                      aria-label={`${currency} ${t(`economics.${key}`)}`}
                      type="number"
                      min={0}
                      max={1000000}
                      step="any"
                      value={Number.isFinite(prices[key]) ? prices[key] : ""}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          [currency]: {
                            ...prices,
                            [key]:
                              e.target.value === ""
                                ? NaN
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </FloatingField>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

export function Pricing() {
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const { t } = useTranslation("canary");
  const q = useQuery({
    queryKey: ["canary-pricing", api.mode],
    queryFn: () => api.pricing.get(),
    refetchOnWindowFocus: false,
  });
  const [table, setTable] = useState<PricingTable | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setTable(structuredClone(q.data));
  }, [q.data]);
  async function save() {
    if (!table) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setTable(await api.pricing.save(table));
      setSaved(true);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 p-4">
      <PageBanner
        title={t("economics.pricing")}
        description={t("economics.pricingHint")}
      />
      {(q.error || error) && <ErrorNotice error={error ?? q.error} />}
      {q.isLoading && <p>{t("common.loading")}</p>}
      {table && (
        <>
          <FloatingField label={t("economics.defaultCurrency")}>
            <FieldSelect
              value={table.currency}
              disabled={!canWrite || busy}
              onValueChange={(currency) => {
                setSaved(false);
                setTable({ ...table, currency: currency as Currency });
              }}
              options={[
                { value: "USD", label: "USD" },
                { value: "CNY", label: "CNY" },
              ]}
            />
          </FloatingField>
          <SectionCard title={t("economics.defaultPrices")}>
            <PriceFields
              value={table.default}
              disabled={!canWrite || busy}
              onChange={(value) => {
                setSaved(false);
                setTable({ ...table, default: value });
              }}
            />
          </SectionCard>
          {Object.entries(table.models).map(([name, prices]) => (
            <SectionCard key={name} title={name}>
              <PriceFields
                value={prices}
                disabled={!canWrite || busy}
                onChange={(value) => {
                  setSaved(false);
                  setTable({
                    ...table,
                    models: { ...table.models, [name]: value },
                  });
                }}
              />
              {canWrite && (
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const models = { ...table.models };
                    delete models[name];
                    setTable({ ...table, models });
                    setSaved(false);
                  }}
                >
                  {t("economics.remove")}
                </Button>
              )}
            </SectionCard>
          ))}
          {canWrite && (
            <div className="grid gap-4">
              <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-center">
                <FloatingField
                  label={t("economics.pricingKey")}
                  className="min-w-0 flex-1"
                >
                  <FieldInput
                    aria-label={t("economics.pricingKey")}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    disabled={busy}
                  />
                </FloatingField>
                <Button
                  className="self-start sm:self-center"
                  variant="outline"
                  disabled={
                    busy ||
                    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(key) ||
                    key in table.models
                  }
                  onClick={() => {
                    setTable({
                      ...table,
                      models: {
                        ...table.models,
                        [key]: { USD: null, CNY: null },
                      },
                    });
                    setKey("");
                    setSaved(false);
                  }}
                >
                  {t("economics.add")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy} onClick={() => void save()}>
                  {busy ? t("common.loading") : t("economics.save")}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => {
                    setSaved(false);
                    void q.refetch().then((result) => {
                      if (result.data) setTable(structuredClone(result.data));
                    });
                  }}
                >
                  {t("economics.reload")}
                </Button>
              </div>
            </div>
          )}
          {saved && <p role="status">{t("economics.saved")}</p>}
          {table.updatedBy && (
            <p className="text-xs text-muted-foreground">
              {table.updatedBy} · {new Date(table.updatedAt!).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
