import { ErrorNotice } from "./ErrorNotice";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "../lib/translation";
import { useCanaryApi } from "../lib/provider";
import type {
  Currency,
  Experiment,
  MetricSummary,
  Metrics,
  TokenPrices,
  ValuationView,
} from "../types";
import {
  finiteNumber,
  format,
  rangeBounds,
  readPreference,
  savePreference,
  timeRanges,
  tpsPreview,
} from "../lib/metric-presentation";
import { quotedRevenue, type QuoteMode } from "../lib/quoted-revenue";
import {
  ComparisonBars,
  ComparisonTable,
  MetricCard,
  type ComparisonRow,
} from "./metrics/MetricCard";
import { EconomicsSettings } from "./metrics/EconomicsSettings";
import { MetricTrend } from "./metrics/MetricTrend";
import { TpsBreachChart } from "./metrics/TpsBreachChart";

const ids = ["cache", "throughput", "ttft", "revenue", "quote", "tps"] as const;
type CardID = (typeof ids)[number];
const ttftKeys = [
  "ttftMean",
  "ttftP50",
  "ttftP95",
  "ttftP99",
  "ttftP999",
] as const;
type TTFTKey = (typeof ttftKeys)[number];
const inputClass =
  "min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";
const buttonClass =
  "rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";
function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
function dateTime(value: number | null | undefined) {
  return value == null ? "—" : new Date(value * 1000).toLocaleString();
}
function localInput(seconds: number) {
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 8.64e12)
    seconds = Date.now() / 1000;
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function MetricsPanel({ experiment }: { experiment: Experiment }) {
  return <Dashboard key={experiment.id} experiment={experiment} />;
}
function Dashboard({ experiment }: { experiment: Experiment }) {
  const { t } = useTranslation();
  const api = useCanaryApi();
  const [params, setParams] = useSearchParams();
  const prefKey = `canary:metrics:${experiment.id}`;
  const [preferences] = useState(() =>
    readPreference<{
      currency?: Currency;
      normalization?: ValuationView["normalization"];
      targetGPUs?: number;
      ttft?: TTFTKey;
    }>(prefKey, {}),
  );
  const [currency, setCurrency] = useState<Currency | "">(
    preferences.currency === "CNY" || preferences.currency === "USD"
      ? preferences.currency
      : "",
  );
  const [normalization, setNormalization] = useState<
    ValuationView["normalization"]
  >(
    ["raw", "as-if", "per-gpu"].includes(preferences.normalization ?? "")
      ? preferences.normalization!
      : "raw",
  );
  const [targetGPUs, setTargetGPUs] = useState(
    preferences.targetGPUs &&
      Number.isInteger(preferences.targetGPUs) &&
      preferences.targetGPUs >= 1 &&
      preferences.targetGPUs <= 1024
      ? preferences.targetGPUs
      : 8,
  );
  const [ttft, setTTFT] = useState<TTFTKey>(
    ttftKeys.includes(preferences.ttft!) ? preferences.ttft! : "ttftP95",
  );
  const rangeParam = params.get("range") ?? "0";
  const range = timeRanges.some(([n]) => String(n) === rangeParam)
    ? Number(rangeParam)
    : rangeParam === "custom"
      ? "custom"
      : 0;
  const initialBounds = rangeBounds(experiment, 3600);
  const [customStart, setCustomStart] = useState(() =>
    localInput(Number(params.get("start")) || initialBounds.start!),
  );
  const [customEnd, setCustomEnd] = useState(() =>
    localInput(Number(params.get("end")) || initialBounds.end),
  );
  const [customError, setCustomError] = useState("");
  const [quoteHit, setQuoteHit] = useState("50");
  const [quoteMode, setQuoteMode] = useState<QuoteMode>("fixed");
  const [threshold, setThreshold] = useState("0");
  const [customPrices, setCustomPrices] = useState<
    Record<string, Record<string, string>>
  >({});
  const [priceOverride, setPriceOverride] = useState(false);
  const details = useRef<HTMLDivElement>(null);
  const lastOpened = useRef<CardID | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const metricParam = params.get("metric");
  const expanded = ids.includes(metricParam as CardID)
    ? (metricParam as CardID)
    : null;
  const selectedStart = Number(params.get("start")),
    selectedEnd = Number(params.get("end"));
  const validCustom =
    Number.isFinite(selectedStart) &&
    selectedStart < 8.64e12 &&
    selectedEnd < 8.64e12 &&
    Number.isFinite(selectedEnd) &&
    selectedStart > 0 &&
    selectedEnd > selectedStart;
  const bounds =
    range === "custom"
      ? { start: selectedStart, end: selectedEnd }
      : rangeBounds(experiment, range);
  const validGPUs =
    normalization !== "as-if" ||
    (Number.isInteger(targetGPUs) && targetGPUs >= 1 && targetGPUs <= 1024);
  const q = useQuery({
    queryKey: [
      "experiment-metrics",
      api.mode,
      experiment.id,
      range,
      range === "custom" ? bounds : null,
      currency,
      normalization,
      targetGPUs,
      experiment.stopAt,
    ],
    enabled: (range !== "custom" || validCustom) && validGPUs,
    queryFn: () => {
      const latest =
        range === "custom" ? bounds : rangeBounds(experiment, range);
      return api.experiments.metrics(experiment.id, latest.start, latest.end, {
        ...(currency ? { currency } : {}),
        normalization,
        targetGPUs,
      });
    },
    refetchInterval:
      experiment.state !== "Stopped" || experiment.snapshot !== "complete"
        ? 60000
        : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const value = { currency, normalization, targetGPUs, ttft };
    savePreference(prefKey, value);
  }, [currency, normalization, targetGPUs, ttft, prefKey]);
  function updateParams(values: Record<string, string | null>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(values)) {
          if (value == null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }
  function toggle(id: CardID) {
    const button = document.activeElement;
    if (button instanceof HTMLButtonElement) trigger.current = button;
    updateParams({ metric: expanded === id ? null : id });
  }
  useEffect(() => {
    if (!expanded) lastOpened.current = null;
    if (expanded && q.data && lastOpened.current !== expanded) {
      lastOpened.current = expanded;
      details.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      details.current?.focus({ preventScroll: true });
    }
  }, [expanded, !!q.data]);
  const data = q.data;
  const arms = data?.compareArms ?? experiment.compareArms;
  const get = (key: keyof MetricSummary) =>
    arms.map((a) => data?.summary[a]?.[key]);
  const row = (key: keyof MetricSummary, unit?: string): ComparisonRow => ({
    label: t(`experiments.${key}`, { defaultValue: t(`dashboard.${key}`) }),
    values: get(key),
    unit,
  });
  const selectedCurrency = currency || data?.valuation.currency || "USD";
  const thresholdNumber = threshold.trim() !== "" ? Number(threshold) : NaN;
  const thresholdValid =
    finiteNumber(thresholdNumber) &&
    thresholdNumber >= 0 &&
    thresholdNumber <= 1e6;
  const thresholdOn = thresholdValid && thresholdNumber > 0;
  const hitNumber = quoteHit.trim() !== "" ? Number(quoteHit) : NaN;
  const quoteValid =
    finiteNumber(hitNumber) && hitNumber >= 0 && hitNumber <= 100;
  const previews = arms.map((arm) =>
    data ? tpsPreview(data, arm, thresholdNumber) : null,
  );
  const prices = arms.map((arm) => {
    if (!priceOverride)
      return data?.economics?.arms[arm]?.prices[selectedCurrency];
    const custom = customPrices[`${selectedCurrency}:${arm}`] ?? {};
    return Object.fromEntries(
      (
        ["inputPerMillion", "cachedPerMillion", "outputPerMillion"] as const
      ).map((key) => [key, custom[key]?.trim() ? Number(custom[key]) : NaN]),
    ) as unknown as TokenPrices;
  });
  const quotes = arms.map((arm, i) =>
    quotedRevenue(data?.summary[arm], prices[i], hitNumber, quoteMode),
  );
  const scaledLabel =
    normalization === "raw"
      ? t("economics.raw")
      : normalization === "per-gpu"
        ? t("economics.perGPU")
        : `${t("economics.asIf")} ${targetGPUs}`;
  const revenueUnit = `${selectedCurrency}/min`;
  const coverage: ComparisonRow = {
    label: `${t("dashboard.coverage")} / ${data?.eligibleMinutes ?? 0}`,
    values: get("completeMinutes"),
  };
  const gpu: ComparisonRow = {
    label: t("economics.gpuTotal"),
    values: arms.map((a) => data?.economics?.arms[a]?.gpuCount),
  };
  const quoteRows: ComparisonRow[] = [
    { label: t("dashboard.actualHit"), values: get("cacheHit"), unit: "%" },
    {
      label: t("dashboard.appliedHit"),
      values: quotes.map((q) => q?.applied),
      unit: "%",
    },
    {
      label: t("experiments.revenuePerHour"),
      values: quotes.map((q) => q?.hour),
      unit: `${selectedCurrency}/hr`,
    },
  ];
  const cards: {
    id: CardID;
    title: string;
    subtitle: string;
    values: (number | null | undefined)[];
    unit: string;
    rows: ComparisonRow[];
    trend: (keyof MetricSummary)[];
    controls?: ReactNode;
    lowerBetter?: boolean;
  }[] = [
    {
      id: "cache",
      title: t("experiments.cacheHit"),
      subtitle: t("dashboard.cacheHint"),
      values: get("cacheHit"),
      unit: "%",
      rows: [row("inputTokens"), row("cachedTokens"), coverage],
      trend: ["cacheHit"],
    },
    {
      id: "throughput",
      title: t("dashboard.throughput"),
      subtitle: `${t("dashboard.throughputHint")} · ${scaledLabel}`,
      values: get("totalTPM"),
      unit: "token/min",
      rows: [
        row("uncachedTPM"),
        row("cachedTPM"),
        row("outputTPM"),
        row("requests"),
        gpu,
      ],
      trend: ["totalTPM", "inputTPM", "uncachedTPM", "cachedTPM", "outputTPM"],
    },
    {
      id: "ttft",
      title: t("dashboard.ttft"),
      subtitle: t("dashboard.ttftHint"),
      values: get(ttft),
      unit: "s",
      lowerBetter: true,
      rows: [row("ttftMean", "s"), row("ttftSamples"), coverage],
      trend: [ttft],
      controls: (
        <Control label={t("dashboard.statistic")}>
          <select
            aria-label={t("dashboard.statistic")}
            className={inputClass}
            value={ttft}
            onChange={(e) => setTTFT(e.target.value as TTFTKey)}
          >
            {ttftKeys.map((key) => (
              <option
                key={key}
                value={key}
                disabled={
                  key !== "ttftP95" &&
                  !!data &&
                  !arms.some((a) => finiteNumber(data.summary[a]?.[key]))
                }
              >
                {t(`dashboard.${key}`)}
              </option>
            ))}
          </select>
        </Control>
      ),
    },
    {
      id: "revenue",
      title: t("dashboard.revenue"),
      subtitle: `${t("dashboard.frozenRevenue")} · ${scaledLabel}`,
      values: get("revenuePerMinute"),
      unit: revenueUnit,
      rows: [
        row("revenuePerHour", `${selectedCurrency}/hr`),
        row("revenueInputPerMinute", revenueUnit),
        row("revenueCachedPerMinute", revenueUnit),
        row("revenueOutputPerMinute", revenueUnit),
      ],
      trend: ["revenuePerMinute", "revenuePerHour"],
    },
    {
      id: "quote",
      title: t("dashboard.quote"),
      subtitle: `${t("dashboard.localPreview")} · ${scaledLabel}`,
      values: quotes.map((q) => q?.minute),
      unit: revenueUnit,
      rows: quoteRows,
      trend: [],
      controls: (
        <div className="flex flex-wrap gap-3">
          <Control label={t("dashboard.assumedHit")}>
            <input
              aria-label={t("dashboard.assumedHit")}
              className={`${inputClass} w-20`}
              type="number"
              min={0}
              max={100}
              value={quoteHit}
              onChange={(e) => setQuoteHit(e.target.value)}
            />
            %
          </Control>
          <select
            aria-label={t("dashboard.quoteMode")}
            className={inputClass}
            value={quoteMode}
            onChange={(e) => setQuoteMode(e.target.value as QuoteMode)}
          >
            {["fixed", "lower", "upper"].map((mode) => (
              <option key={mode} value={mode}>
                {t(`dashboard.${mode}`)}
              </option>
            ))}
          </select>
          {!quoteValid && (
            <span role="alert" className="text-xs text-red-600">
              {t("dashboard.invalidHit")}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "tps",
      title: t(thresholdOn ? "dashboard.tpsPass" : "dashboard.tps"),
      subtitle: t("dashboard.tpsHint"),
      values: thresholdOn ? previews.map((p) => p?.pass) : get("overallTPS"),
      unit: thresholdOn ? "%" : "token/s",
      rows: [
        row("overallTPS", "token/s"),
        row("decodeTPS", "token/s"),
        {
          label: t("dashboard.evaluated"),
          values: previews.map((p) => p?.evaluated),
        },
        ...(thresholdOn
          ? [
              {
                label: t("dashboard.failed"),
                values: previews.map((p) => p?.failed),
              },
            ]
          : []),
      ],
      trend: ["overallTPS", "decodeTPS"],
      controls: (
        <div className="grid gap-2">
          <Control label={t("dashboard.threshold")}>
            <input
              aria-label={t("dashboard.threshold")}
              className={`${inputClass} w-24`}
              type="number"
              min={0}
              max={1e6}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <span>token/s</span>
          </Control>
          <input
            aria-label={t("dashboard.thresholdSlider")}
            type="range"
            min={0}
            max={Math.max(200, thresholdValid ? thresholdNumber : 0)}
            step={1}
            value={thresholdValid ? thresholdNumber : 0}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full accent-blue-600"
          />
          {!thresholdValid && (
            <span role="alert" className="text-xs text-red-600">
              {t("dashboard.invalidThreshold")}
            </span>
          )}
        </div>
      ),
    },
  ];
  const current = cards.find((c) => c.id === expanded);
  return (
    <div
      className="@container mx-auto grid w-full max-w-[1180px] gap-4 rounded-xl bg-slate-100 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      data-testid="metrics-dashboard"
    >
      <div className="grid gap-3 rounded-[10px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap justify-between gap-2 text-xs">
          <strong>
            {t(`experiments.${experiment.state}`)} · {experiment.creator}
          </strong>
          <span>
            {t("dashboard.snapshot")}: {t(`experiments.${experiment.snapshot}`)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {t("dashboard.created")}:{" "}
            {new Date(experiment.createdAt).toLocaleString()}
          </span>
          {experiment.stopAt && (
            <span>
              {t("dashboard.stopped")}:{" "}
              {new Date(experiment.stopAt).toLocaleString()}
            </span>
          )}
          <span>
            {t("dashboard.observation")}:{" "}
            {experiment.windows.length
              ? `${experiment.windows[0].start} — ${experiment.windows.at(-1)!.end}`
              : "—"}
          </span>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-medium">
            {t("dashboard.compareEconomics")} ·{" "}
            {arms
              .map(
                (a) => `${a}: ${data?.economics?.arms[a]?.gpuCount ?? "—"} GPU`,
              )
              .join(" / ")}
          </summary>
          {data && (
            <div className="mt-3">
              <EconomicsSettings
                key={data.economics?.revision ?? 0}
                data={data}
                experimentId={experiment.id}
              />
            </div>
          )}
        </details>
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={t("dashboard.timeRange")}
        >
          {timeRanges.map(([seconds, label]) => (
            <button
              key={seconds}
              className={`${buttonClass} ${range === seconds ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : ""}`}
              aria-pressed={range === seconds}
              onClick={() =>
                updateParams({ range: String(seconds), start: null, end: null })
              }
            >
              {label}
            </button>
          ))}
          <button
            className={buttonClass}
            aria-pressed={range === "custom"}
            onClick={() => {
              const start = Math.floor(Date.parse(customStart) / 1000),
                end = Math.floor(Date.parse(customEnd) / 1000);
              updateParams({
                range: "custom",
                start: String(start),
                end: String(end),
              });
            }}
          >
            {t("dashboard.custom")}
          </button>
          <button
            className={`${buttonClass} ml-auto`}
            disabled={
              q.isFetching || !validGPUs || (range === "custom" && !validCustom)
            }
            onClick={() => void q.refetch()}
          >
            {q.isFetching
              ? t("dashboard.refreshing")
              : `↻ ${t("dashboard.refresh")}`}
          </button>
        </div>
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Control label={t("dashboard.start")}>
              <input
                aria-label={t("dashboard.start")}
                type="datetime-local"
                className={inputClass}
                value={customStart}
                onInput={(e) => setCustomStart(e.currentTarget.value)}
              />
            </Control>
            <Control label={t("dashboard.end")}>
              <input
                aria-label={t("dashboard.end")}
                type="datetime-local"
                className={inputClass}
                value={customEnd}
                onInput={(e) => setCustomEnd(e.currentTarget.value)}
              />
            </Control>
            <button
              className={buttonClass}
              onClick={() => {
                const start = Math.floor(Date.parse(customStart) / 1000),
                  end = Math.floor(Date.parse(customEnd) / 1000);
                if (
                  !Number.isFinite(start) ||
                  !Number.isFinite(end) ||
                  start >= end
                ) {
                  setCustomError(t("dashboard.invalidRange"));
                  return;
                }
                setCustomError("");
                updateParams({ start: String(start), end: String(end) });
              }}
            >
              {t("dashboard.apply")}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
            {(customError || !validCustom) && (
              <p role="alert" className="text-xs text-red-600">
                {customError || t("dashboard.invalidRange")}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <Control label={t("economics.currency")}>
            <select
              aria-label={t("economics.currency")}
              className={inputClass}
              value={selectedCurrency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              <option>USD</option>
              <option>CNY</option>
            </select>
          </Control>
          <Control label={t("economics.normalization")}>
            <select
              aria-label={t("economics.normalization")}
              className={inputClass}
              value={normalization}
              onChange={(e) =>
                setNormalization(
                  e.target.value as ValuationView["normalization"],
                )
              }
            >
              {["raw", "per-gpu", "as-if"].map((v) => (
                <option key={v} value={v}>
                  {t(
                    `economics.${v === "raw" ? "raw" : v === "per-gpu" ? "perGPU" : "asIf"}`,
                  )}
                </option>
              ))}
            </select>
          </Control>
          {normalization === "as-if" && (
            <Control label={t("economics.targetGPUs")}>
              <input
                aria-label={t("economics.targetGPUs")}
                className={`${inputClass} w-20`}
                type="number"
                min={1}
                max={1024}
                value={targetGPUs || ""}
                onChange={(e) => setTargetGPUs(Number(e.target.value))}
              />
            </Control>
          )}
        </div>
        {!validGPUs && (
          <p role="alert" className="text-xs text-red-600">
            {t("dashboard.invalidGPUs")}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {t("economics.normalizationHint")}
        </p>
        {data && (
          <div
            className="grid gap-1 text-[11px] text-muted-foreground"
            role="status"
          >
            <span>
              {t("dashboard.selectedRange")}:{" "}
              {data.range?.start ? dateTime(data.range.start) : "Full"} —{" "}
              {dateTime(data.range?.end)} · {t("dashboard.windows")}:{" "}
              {data.range?.intersections.length ?? experiment.windows.length}
            </span>
            <span>
              {t("dashboard.storedRange")}: {dateTime(data.range?.dataStart)} —{" "}
              {dateTime(data.range?.dataEnd)} · {t("dashboard.lastCollected")}:{" "}
              {data.lastCollectedAt
                ? new Date(data.lastCollectedAt).toLocaleString()
                : "—"}
            </span>
            {[1, 0].map((i) => (
              <span key={i}>
                {t(i ? "dashboard.experiment" : "dashboard.control")} ·{" "}
                {arms[i]} · {t("dashboard.coverage")}:{" "}
                {data.summary[arms[i]]?.completeMinutes ?? 0}/
                {data.eligibleMinutes}
              </span>
            ))}
            {!!data.excludedMinutes && (
              <span>
                {t("experiments.excludedMinutes", {
                  count: data.excludedMinutes,
                })}
              </span>
            )}
            {arms.some(
              (a) =>
                (data.summary[a]?.completeMinutes ?? 0) < data.eligibleMinutes,
            ) && <span>{t("dashboard.partial")}</span>}
          </div>
        )}
      </div>
      {q.error && (
        <ErrorNotice
          error={q.error}
          className="rounded-md border border-red-200 bg-card p-3 text-sm text-destructive"
        >
          <button className={buttonClass} onClick={() => void q.refetch()}>
            {t("dashboard.refresh")}
          </button>
        </ErrorNotice>
      )}
      {data?.snapshotError && (
        <ErrorNotice
          error={data.snapshotError}
          fallback="snapshot"
          className="text-xs text-destructive"
        />
      )}
      {q.isLoading && !data && (
        <div
          className="grid gap-4 @min-[900px]:grid-cols-2"
          aria-label={t("common.loading")}
        >
          {ids.map((id) => (
            <div
              key={id}
              className="h-72 animate-pulse rounded-[10px] bg-white dark:bg-slate-900"
            />
          ))}
        </div>
      )}
      {data && (
        <>
          {!data.series.length && (
            <p role="status" className="text-sm">
              {t("experiments.noData")}
            </p>
          )}
          <div className="grid items-stretch gap-4 @min-[900px]:grid-cols-2">
            {cards.map((card) => (
              <MetricCard
                key={card.id}
                {...card}
                arms={arms}
                hypothetical={card.id === "quote"}
                expanded={expanded === card.id}
                onToggle={() => toggle(card.id)}
              >
                {card.controls}
              </MetricCard>
            ))}
          </div>
          {current && (
            <div
              ref={details}
              id="metric-details"
              tabIndex={-1}
              className="scroll-mt-16 grid min-w-0 gap-5 rounded-[10px] border border-slate-200 bg-white p-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 dark:border-slate-700 dark:bg-slate-900"
              aria-label={`${current.title} Details`}
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    {current.title} Details
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {current.subtitle}
                  </p>
                </div>
                <button
                  className={buttonClass}
                  onClick={() => {
                    updateParams({ metric: null });
                    trigger.current?.focus();
                  }}
                >
                  {t("dashboard.collapse")}
                </button>
              </header>
              <ComparisonBars
                arms={arms}
                values={current.values}
                unit={current.unit}
                hypothetical={current.id === "quote"}
              />
              <ComparisonTable
                arms={arms}
                rows={[
                  {
                    label: current.title,
                    values: current.values,
                    unit: current.unit,
                  },
                  ...current.rows,
                  ...(current.id !== "cache" && current.id !== "ttft"
                    ? [coverage]
                    : []),
                ]}
              />
              {current.id === "quote" && (
                <div className="grid gap-3 rounded-lg border border-purple-200 p-4 text-xs dark:border-purple-900">
                  <p className="font-medium text-purple-700 dark:text-purple-400">
                    {t("dashboard.quoteHint")}
                  </p>
                  <ComparisonTable
                    arms={arms}
                    rows={[
                      {
                        label: t("dashboard.actualRevenue"),
                        values: get("revenuePerMinute"),
                        unit: revenueUnit,
                      },
                      {
                        label: t("experiments.revenueInputPerMinute"),
                        values: quotes.map((q) => q?.input),
                        unit: revenueUnit,
                      },
                      {
                        label: t("experiments.revenueCachedPerMinute"),
                        values: quotes.map((q) => q?.cached),
                        unit: revenueUnit,
                      },
                      {
                        label: t("experiments.revenueOutputPerMinute"),
                        values: quotes.map((q) => q?.output),
                        unit: revenueUnit,
                      },
                    ]}
                  />
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={priceOverride}
                      onChange={(e) => {
                        setPriceOverride(e.target.checked);
                        if (e.target.checked)
                          setCustomPrices((previous) => ({
                            ...previous,
                            ...Object.fromEntries(
                              arms.map((arm, i) => [
                                `${selectedCurrency}:${arm}`,
                                previous[`${selectedCurrency}:${arm}`] ??
                                  Object.fromEntries(
                                    Object.entries(prices[i] ?? {}).map(
                                      ([k, v]) => [k, String(v)],
                                    ),
                                  ),
                              ]),
                            ),
                          }));
                      }}
                    />
                    {t("dashboard.customPrices")} ({selectedCurrency}/1M)
                  </label>
                  {arms.map((arm, i) => (
                    <div key={arm} className="grid gap-2">
                      <strong className="break-all">
                        {arm} · {data.economics?.arms[arm]?.pricingKey ?? "—"}
                      </strong>
                      <div className="flex flex-wrap gap-3">
                        {(
                          [
                            "inputPerMillion",
                            "cachedPerMillion",
                            "outputPerMillion",
                          ] as const
                        ).map((key) => (
                          <Control key={key} label={t(`economics.${key}`)}>
                            {priceOverride ? (
                              <input
                                type="number"
                                aria-label={`${arm} ${t(`economics.${key}`)}`}
                                className={`${inputClass} w-24`}
                                min={0}
                                max={1e6}
                                value={
                                  customPrices[`${selectedCurrency}:${arm}`]?.[
                                    key
                                  ] ?? ""
                                }
                                onChange={(e) =>
                                  setCustomPrices((previous) => ({
                                    ...previous,
                                    [`${selectedCurrency}:${arm}`]: {
                                      ...previous[`${selectedCurrency}:${arm}`],
                                      [key]: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              <span className="tabular-nums">
                                {format(prices[i]?.[key])}
                              </span>
                            )}
                          </Control>
                        ))}
                      </div>
                    </div>
                  ))}
                  {quotes.some((q) => !q) && (
                    <p role="status">{t("dashboard.quoteUnavailable")}</p>
                  )}
                </div>
              )}
              {current.id === "tps" && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.tpsMethod")}
                  </p>
                  <TpsBreachChart
                    data={data}
                    threshold={thresholdOn ? thresholdNumber : 0}
                  />
                </>
              )}
              {(current.id === "revenue" || current.id === "quote") && (
                <p className="text-xs text-muted-foreground">
                  {t("economics.revenueHint")}{" "}
                  {t("dashboard.unavailableEconomics")}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="p-2">{t("dashboard.observation")}</th>
                      <th className="p-2">Service / UID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.windows ?? experiment.windows).map(
                      (window, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2 whitespace-nowrap">
                            {new Date(window.start).toLocaleString()} —{" "}
                            {new Date(window.end).toLocaleString()}
                          </td>
                          <td className="p-2">
                            {arms.map((arm) => (
                              <div key={arm} className="break-all">
                                {arm}:{" "}
                                {window.bindings[arm]
                                  ? `${window.bindings[arm].namespace}/${window.bindings[arm].service} · ${window.bindings[arm].uid}`
                                  : "—"}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {current.trend.length > 0 && (
                <TrendDetails
                  threshold={
                    current.id === "tps" && thresholdOn ? thresholdNumber : 0
                  }
                  key={`${current.id}:${ttft}`}
                  metrics={current.trend}
                  data={data}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function TrendDetails({
  metrics,
  data,
  threshold = 0,
}: {
  metrics: (keyof MetricSummary)[];
  data: Metrics;
  threshold?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">
        {t("dashboard.trend")}
      </summary>
      {open && (
        <div className="mt-4 grid gap-5">
          {metrics.map((key) => (
            <div key={key}>
              <h4 className="mb-2 text-xs font-medium">
                {t(`experiments.${key}`, {
                  defaultValue: t(`dashboard.${key}`),
                })}
              </h4>
              <MetricTrend
                data={data}
                metric={key}
                threshold={key === "overallTPS" ? threshold : 0}
                label={t(`experiments.${key}`, {
                  defaultValue: t(`dashboard.${key}`),
                })}
              />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
