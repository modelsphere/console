import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, ChartNoAxesCombined, Clock, TriangleAlert } from "lucide-react";
import { SectionCard, Skeleton } from "@modelsphere/ui";
import { useModulePath } from "@/shell";
import { readDeploymentTimeline } from "@/modules/inferences/dashboard-api";
import { timelineTotals } from "@/modules/inferences/dashboard-lib";
import { useT } from "@/modules/inferences/i18n";

const TrendPlot = lazy(() => import("@/modules/inferences/TrendPlot").then((m) => ({ default: m.TrendPlot })));

export function DeploymentTrend() {
  const t = useT();
  const p = useModulePath();
  const history = useQuery({
    queryKey: ["runs", "dashboard", "timeline"],
    queryFn: () => readDeploymentTimeline(),
    refetchInterval: 30_000,
  });
  const totals = history.data ? timelineTotals(history.data) : null;

  return (
    <section aria-label={t("dashboard.trend.title")}>
      <SectionCard
        title={t("dashboard.trend.title")}
        icon={<ChartNoAxesCombined className="size-4" />}
        summary={t("dashboard.trend.range")}
        actions={
          <Link
            to={p("runs")}
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline"
          >
            {t("dashboard.trend.records")} <ArrowRight className="size-3.5" />
          </Link>
        }
        padded={false}
        loading={history.isPending}
        error={history.error}
        onRetry={() => void history.refetch()}
        contentClassName="min-h-[288px]"
      >
        {!history.data?.hasStore ? (
          <div className="flex min-h-[288px] flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
            <Clock className="size-6" />
            <span>{t("dashboard.trend.noHistory")}</span>
          </div>
        ) : !history.data.complete ? (
          <div className="flex min-h-[288px] flex-col items-center justify-center gap-3 p-4 text-sm text-warning">
            <TriangleAlert className="size-6" />
            <span className="max-w-md text-center">{t("dashboard.trend.incomplete")}</span>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <dl className="grid grid-cols-3 gap-4 border-b border-border/60 pb-3">
              {(["started", "updated", "failed"] as const).map((key) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t(`dashboard.trend.${key}`)}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{totals?.[key] ?? "-"}</dd>
                </div>
              ))}
            </dl>
            <div className="h-[200px] min-w-0" role="img" aria-label={t("dashboard.trend.chartLabel")}>
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <TrendPlot buckets={history.data.buckets} />
              </Suspense>
            </div>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
