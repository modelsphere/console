import type { ReactNode } from "react";
import {
  difference,
  finiteNumber,
  format,
} from "../../lib/metric-presentation";
import { useTranslation } from "../../lib/translation";
export interface ComparisonRow {
  label: string;
  values: (number | null | undefined)[];
  unit?: string;
}
export function ComparisonBars({
  arms,
  values,
  unit = "",
  hypothetical = false,
}: {
  arms: string[];
  values: (number | null | undefined)[];
  unit?: string;
  hypothetical?: boolean;
}) {
  const { t } = useTranslation();
  const max = Math.max(0, ...values.filter(finiteNumber)) || 1;
  return (
    <div className="grid gap-3" title={t("dashboard.barHint")}>
      {[1, 0].map((i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,7rem)_1fr_minmax(4rem,auto)] items-center gap-3 text-xs"
        >
          <div className="min-w-0">
            <span className="font-semibold">
              {t(i ? "dashboard.experiment" : "dashboard.control")}
            </span>
            <div
              className="truncate text-[11px] text-muted-foreground"
              title={arms[i]}
            >
              {arms[i]}
            </div>
          </div>
          <div className="h-6 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded transition-[width]"
              style={{
                width: `${finiteNumber(values[i]) ? (Math.max(0, values[i]!) / max) * 100 : 0}%`,
                backgroundColor: i
                  ? hypothetical
                    ? "#7c3aed"
                    : "#2563eb"
                  : "#cbd5e1",
              }}
            />
          </div>
          <strong className="text-right tabular-nums whitespace-nowrap">
            {format(values[i], /USD|CNY/.test(unit) ? 6 : 3)}
            {finiteNumber(values[i]) && unit ? ` ${unit}` : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}
export function ComparisonTable({
  rows,
  arms,
}: {
  rows: ComparisonRow[];
  arms: string[];
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2 text-left font-normal">
              {t("dashboard.metric")}
            </th>
            {[1, 0].map((i) => (
              <th
                key={i}
                className="p-2 text-right font-normal"
                title={arms[i]}
              >
                {t(i ? "dashboard.experiment" : "dashboard.control")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className="py-2 pr-2 text-muted-foreground">
                {row.label}
                {row.unit ? ` (${row.unit})` : ""}
              </td>
              {[1, 0].map((i) => (
                <td key={i} className="p-2 text-right tabular-nums">
                  {format(
                    row.values[i],
                    /USD|CNY/.test(row.unit ?? "") ? 6 : 3,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function MetricCard({
  id,
  title,
  subtitle,
  arms,
  values,
  unit,
  rows,
  lowerBetter,
  hypothetical,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  arms: string[];
  values: (number | null | undefined)[];
  unit: string;
  rows: ComparisonRow[];
  lowerBetter?: boolean;
  hypothetical?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const delta = difference(values[0], values[1]);
  const good =
    delta.absolute != null &&
    (lowerBetter ? delta.absolute < 0 : delta.absolute > 0);
  const color =
    delta.absolute == null || delta.absolute === 0
      ? "text-muted-foreground"
      : good
        ? "text-green-700 dark:text-green-400"
        : "text-red-600 dark:text-red-400";
  return (
    <article
      data-metric-card={id}
      className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-slate-200 bg-white px-5 py-[18px] shadow-sm dark:border-slate-700 dark:bg-slate-900"
      onClick={(e) => {
        if (
          !(e.target as HTMLElement).closest(
            "button,input,select,label,summary,a",
          )
        )
          onToggle();
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <span
          className={`shrink-0 text-lg font-semibold tabular-nums ${color}`}
          title={t("dashboard.relativeHint")}
        >
          {delta.relative != null && delta.relative > 0 ? "+" : ""}
          {format(delta.relative, 2)}
          {delta.relative != null ? "%" : ""}
        </span>
      </header>
      {children}
      <ComparisonBars
        arms={arms}
        values={values}
        unit={unit}
        hypothetical={hypothetical}
      />
      <div className={`text-right text-xs tabular-nums ${color}`}>
        Δ {t("dashboard.experiment")} vs {t("dashboard.control")}:{" "}
        {delta.absolute != null && delta.absolute > 0 ? "+" : ""}
        {format(delta.absolute, /USD|CNY/.test(unit) ? 6 : 3)}{" "}
        {unit === "%" ? "pp" : unit}
      </div>
      <ComparisonTable rows={rows} arms={arms} />
      <button
        type="button"
        className="mt-auto border-t border-slate-100 pt-3 text-left text-xs font-medium text-blue-600 hover:underline dark:border-slate-800 dark:text-blue-400"
        aria-expanded={expanded}
        aria-controls="metric-details"
        onClick={onToggle}
      >
        {expanded ? "▲" : "▼"} Details
      </button>
    </article>
  );
}
