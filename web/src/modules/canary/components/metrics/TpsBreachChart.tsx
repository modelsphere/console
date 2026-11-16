import type { Metrics } from "../../types";
import { tpsPreview, format } from "../../lib/metric-presentation";
import { useTranslation } from "../../lib/translation";
export function TpsBreachChart({
  data,
  threshold,
}: {
  data: Metrics;
  threshold: number;
}) {
  const { t } = useTranslation();
  const previews = data.compareArms.map((arm) =>
    tpsPreview(data, arm, threshold),
  );
  const max = Math.max(1, threshold, ...previews.flatMap((p) => p.values));
  const bins = 12;
  const counts = previews.map((p) =>
    Array.from(
      { length: bins },
      (_, i) =>
        p.values.filter(
          (v) => Math.min(bins - 1, Math.floor((v / max) * bins)) === i,
        ).length,
    ),
  );
  const height = Math.max(1, ...counts.flat());
  return (
    <div className="grid gap-3">
      <h4 className="text-sm font-medium">{t("dashboard.distribution")}</h4>
      <svg
        viewBox="0 0 640 190"
        role="img"
        aria-label={t("dashboard.distribution")}
        className="w-full"
      >
        <line
          x1={30}
          x2={630}
          y1={160}
          y2={160}
          stroke="currentColor"
          opacity={0.2}
        />
        {counts.map((group, a) =>
          group.map((count, i) => (
            <rect
              key={`${a}:${i}`}
              x={30 + i * 50 + a * 20}
              y={160 - (count / height) * 130}
              width={19}
              height={(count / height) * 130}
              fill={a ? "#2563eb" : "#cbd5e1"}
            >
              <title>
                {data.compareArms[a]}: {format((i / bins) * max)}–
                {format(((i + 1) / bins) * max)} token/s · {count}{" "}
                {t("dashboard.minutes")}
              </title>
            </rect>
          )),
        )}
        {threshold > 0 && (
          <g>
            <rect
              x={30}
              y={20}
              width={(threshold / max) * 600}
              height={140}
              fill="#dc2626"
              opacity={0.06}
            />
            <line
              x1={30 + (threshold / max) * 600}
              x2={30 + (threshold / max) * 600}
              y1={15}
              y2={160}
              stroke="#dc2626"
              strokeDasharray="4 3"
            />
            <text
              x={Math.min(510, 34 + (threshold / max) * 600)}
              y={12}
              fontSize={10}
              fill="currentColor"
            >
              {t("dashboard.threshold")}: {threshold}
            </text>
          </g>
        )}
        <text x={30} y={180} fill="currentColor" fontSize={10}>
          0 token/s
        </text>
        <text
          x={630}
          y={180}
          textAnchor="end"
          fill="currentColor"
          fontSize={10}
        >
          {format(max)} token/s
        </text>
      </svg>
      <div className="flex flex-wrap gap-4 text-xs">
        {data.compareArms.map((arm, i) => (
          <span key={arm}>
            <span style={{ color: i ? "#2563eb" : "#64748b" }}>●</span> {arm}:{" "}
            {previews[i].evaluated} {t("dashboard.minutes")}
            {threshold > 0
              ? ` · ${t("dashboard.failed")}: ${previews[i].failed}`
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
