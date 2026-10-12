import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocale } from "@/shell";
import type { DeploymentBucket } from "@/modules/inferences/dashboard-lib";
import { useT } from "@/modules/inferences/i18n";

export function TrendPlot({ buckets }: { buckets: DeploymentBucket[] }) {
  const t = useT();
  const { locale } = useLocale();
  const hour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const full = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const data = buckets.map((bucket) => ({ ...bucket, stamp: Date.parse(bucket.at) }));
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: -20 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis
          dataKey="stamp"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(value) => hour.format(new Date(value))}
          minTickGap={70}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, (max: number) => Math.max(4, max)]}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={46}
        />
        <Tooltip
          labelFormatter={(label) => full.format(new Date(Number(label)))}
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
        />
        <Legend iconType="plainline" itemSorter={(item) => item.dataKey === "started" ? 0 : item.dataKey === "updated" ? 1 : 2} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
        <Area
          type="linear"
          dataKey="started"
          name={t("dashboard.trend.started")}
          unit={t("dashboard.trend.unit")}
          stroke="var(--info)"
          strokeWidth={2}
          fill="var(--info)"
          fillOpacity={0.1}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="updated"
          name={t("dashboard.trend.updated")}
          unit={t("dashboard.trend.unit")}
          stroke="var(--success)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="failed"
          name={t("dashboard.trend.failed")}
          unit={t("dashboard.trend.unit")}
          stroke="var(--destructive)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
