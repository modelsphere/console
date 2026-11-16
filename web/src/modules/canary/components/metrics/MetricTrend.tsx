import { describeError } from "../../lib/errors";
import { useTranslation } from "../../lib/translation";
import { useId, useState } from "react";
import type { Metrics, MetricSummary } from "../../types";
import { format } from "../../lib/metric-presentation";
export function MetricTrend({
  data,
  metric,
  label,
  threshold = 0,
}: {
  data: Metrics;
  metric: keyof MetricSummary;
  label: string;
  threshold?: number;
}) {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const width = 640,
    height = 170;
  const times = data.series.map((p) => p.time);
  const values = data.series
    .flatMap((p) => data.compareArms.map((a) => p.arms[a]?.[metric]))
    .filter((v): v is number => typeof v === "number");
  if (times.length === 0 || values.length === 0) return null;
  const minT = Math.min(...times),
    maxT = Math.max(...times);
  const maxV = Math.max(0, threshold, ...values) || 1;
  const x = (time: number) =>
    30 + ((time - minT) / Math.max(60, maxT - minT)) * (width - 40);
  const y = (v: number) => height - 25 - (v / maxV) * (height - 40);
  const colors = ["#94a3b8", "#2563eb"];
  const activePoint = data.series.find((point) => point.time === activeTime);
  const digits = metric.startsWith("revenue") ? 6 : 3;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        aria-describedby={activePoint ? tooltipId : undefined}
        tabIndex={0}
        className="w-full rounded-sm focus-visible:outline focus-visible:outline-ring"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const pointerX =
            ((event.clientX - bounds.left) / bounds.width) * width;
          const pointerY =
            ((event.clientY - bounds.top) / bounds.height) * height;
          if (
            pointerX < 26 ||
            pointerX > width - 6 ||
            pointerY < 10 ||
            pointerY > height - 20
          ) {
            setActiveTime(null);
            return;
          }
          const time =
            minT +
            ((Math.max(30, Math.min(width - 10, pointerX)) - 30) /
              (width - 40)) *
              Math.max(60, maxT - minT);
          const nearest = data.series.reduce((best, point) =>
            Math.abs(point.time - time) < Math.abs(best.time - time)
              ? point
              : best,
          );
          // Do not present a record from a different minute across an observation gap.
          setActiveTime(
            Math.abs(nearest.time - time) <= 30 ? nearest.time : null,
          );
        }}
        onPointerLeave={() => setActiveTime(null)}
        onFocus={() => setActiveTime(minT)}
        onBlur={() => setActiveTime(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setActiveTime(null);
            return;
          }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = data.series.findIndex(
            (point) => point.time === activeTime,
          );
          const next =
            index < 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    data.series.length - 1,
                    index + (event.key === "ArrowRight" ? 1 : -1),
                  ),
                );
          setActiveTime(data.series[next].time);
        }}
      >
        <line
          x1="30"
          y1={height - 25}
          x2={width - 10}
          y2={height - 25}
          stroke="currentColor"
          opacity=".2"
        />
        <text x="1" y="20" fill="currentColor" fontSize="10">
          {format(maxV, metric.startsWith("revenue") ? 6 : 3)}
        </text>
        {threshold > 0 && (
          <g>
            <rect
              x="30"
              y={y(threshold)}
              width={width - 40}
              height={height - 25 - y(threshold)}
              fill="#dc2626"
              opacity=".05"
            />
            <line
              x1="30"
              x2={width - 10}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke="#dc2626"
              strokeDasharray="5 3"
            />
            <text
              x={width - 10}
              y={Math.max(12, y(threshold) - 4)}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
            >
              {threshold} token/s
            </text>
          </g>
        )}
        {data.compareArms.map((arm, i) => {
          const segments: string[][] = [];
          let segment: string[] = [];
          let previous = 0;
          for (const point of data.series) {
            const v = point.arms[arm]?.[metric];
            if (
              v === null ||
              v === undefined ||
              point.error ||
              (previous && point.time - previous > 60)
            ) {
              if (segment.length) segments.push(segment);
              segment = [];
            }
            if (v !== null && v !== undefined && !point.error)
              segment.push(`${x(point.time)},${y(v)}`);
            previous = point.time;
          }
          if (segment.length) segments.push(segment);
          return (
            <g key={arm}>
              {segments.map((points, j) => (
                <polyline
                  key={j}
                  points={points.join(" ")}
                  fill="none"
                  stroke={colors[i]}
                  strokeWidth="2"
                  strokeDasharray={i === 0 ? "5 3" : undefined}
                />
              ))}
              {data.series
                .filter((p) => !p.error && p.arms[arm]?.[metric] != null)
                .map((p) => (
                  <circle
                    key={p.time}
                    cx={x(p.time)}
                    cy={y(p.arms[arm][metric]!)}
                    r="2"
                    fill={
                      threshold > 0 && p.arms[arm][metric]! < threshold
                        ? "#dc2626"
                        : colors[i]
                    }
                    stroke={
                      threshold > 0 && p.arms[arm][metric]! < threshold
                        ? colors[i]
                        : undefined
                    }
                    strokeWidth="2"
                  />
                ))}
            </g>
          );
        })}
        {activePoint && (
          <g pointerEvents="none">
            <line
              x1={x(activePoint.time)}
              x2={x(activePoint.time)}
              y1="15"
              y2={height - 25}
              stroke="currentColor"
              strokeDasharray="4 3"
              opacity=".4"
            />
            {data.compareArms.map((arm, i) => {
              const value = activePoint.arms[arm]?.[metric];
              return !activePoint.error && value != null ? (
                <circle
                  key={arm}
                  cx={x(activePoint.time)}
                  cy={y(value)}
                  r="4"
                  fill={colors[i]}
                  stroke="var(--background, white)"
                  strokeWidth="2"
                  strokeDasharray={i === 0 ? "5 3" : undefined}
                />
              ) : null;
            })}
          </g>
        )}
        <text x="30" y={height - 5} fill="currentColor" fontSize="10">
          {new Date(minT * 1000).toLocaleString()}
        </text>
        <text
          x={width - 10}
          y={height - 5}
          textAnchor="end"
          fill="currentColor"
          fontSize="10"
        >
          {new Date(maxT * 1000).toLocaleString()}
        </text>
      </svg>
      {activePoint && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute top-2 z-10 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          style={{
            width: "min(16rem, calc(100% - 16px))",
            left: `clamp(8px, ${(x(activePoint.time) / width) * 100}%, calc(100% - 16rem - 8px))`,
          }}
        >
          <div className="font-medium">{label}</div>
          <div className="mb-2 text-muted-foreground">
            {new Date(activePoint.time * 1000).toLocaleString()}
          </div>
          {activePoint.error && (
            <div className="mb-2 text-muted-foreground">
              {describeError(activePoint.error, t, "snapshot").summary}
            </div>
          )}
          {data.compareArms.map((arm, i) => (
            <div key={arm} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[i] }}
                />
                <span className="break-all">{arm}</span>
              </span>
              <strong className="shrink-0 tabular-nums">
                {format(
                  activePoint.error ? null : activePoint.arms[arm]?.[metric],
                  digits,
                )}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
