import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  CircleCheck,
  Cpu,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  ResourceTable,
  SectionCard,
  type ResourceColumn,
} from "@modelsphere/ui";
import { formatDateTime, PermissionGuard, useModulePath } from "@/shell";
import { api, type Deployment, type NodesResponse, type ReleaseStatus } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { detailPath, modelLine, releaseState, rowState } from "@/modules/inferences/lib";
import { StatusDot } from "@/modules/inferences/components/StatusDot";
import { ResourceOverview } from "@/modules/inferences/ResourceOverview";
import { ClusterOverview } from "@/modules/inferences/ClusterOverview";
import { DeploymentTrend } from "@/modules/inferences/DeploymentTrend";
import { useSupportedTotals } from "@/modules/inferences/useSupportedTotals";
import { allDeployments } from "@/modules/inferences/dashboard-api";
import { healthRank, serviceHealth } from "@/modules/inferences/dashboard-lib";

export const DASHBOARD_PAGE_SIZE = 6;

type Row = Deployment & { key: string; live: UseQueryResult<ReleaseStatus, Error> };

export function InferencesOverview() {
  return (
    <PermissionGuard permission="swiss.view">
      <Dashboard />
    </PermissionGuard>
  );
}

function Dashboard() {
  const t = useT();
  const p = useModulePath();
  const list = useQuery({
    queryKey: ["deployments", "dashboard", "all"],
    queryFn: allDeployments,
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: 30_000 });
  const runs = useQuery({
    queryKey: ["runs", "dashboard"],
    queryFn: () => api.runs({ limit: 5 }),
    refetchInterval: 20_000,
  });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const supported = useSupportedTotals(cluster);

  const deployments = list.data?.deployments ?? [];
  const statuses = useQueries({
    queries: deployments.map((d) => ({
      queryKey: ["status", d.namespace, d.release],
      queryFn: () => api.status(d.namespace, d.release),
      refetchInterval: 15_000,
    })),
  });
  const rows: Row[] = deployments.map((d, i) => ({ ...d, key: `${d.namespace}/${d.release}`, live: statuses[i] }));
  // Health numbers wait until every status read has settled, so a slow read can
  // never turn into a healthy-looking zero.
  const settled = rows.every((_, i) => statuses[i] && (statuses[i].data || statuses[i].error));
  const health = settled ? serviceHealth(rows, statuses) : null;
  const shown = rows
    .slice()
    .sort((a, b) => healthRank(a, a.live) - healthRank(b, b.live) || a.release.localeCompare(b.release))
    .slice(0, DASHBOARD_PAGE_SIZE);

  const columns: ResourceColumn<Row>[] = [
    {
      key: "release",
      title: t("list.columns.name"),
      width: 240,
      hideable: false,
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={p(detailPath(row.release, row.namespace))}
            className="block truncate font-medium text-primary hover:underline"
            title={row.release}
          >
            {row.release}
          </Link>
          <span className="block truncate text-xs text-muted-foreground" title={modelLine(row)}>
            {modelLine(row) || t("list.untracked")}
          </span>
        </div>
      ),
    },
    {
      key: "state",
      title: t("list.columns.state"),
      width: 150,
      render: (row) =>
        row.live.error ? (
          <Button variant="ghost" size="sm" onClick={() => void row.live.refetch()} title={row.live.error.message}>
            <TriangleAlert className="size-3.5 text-warning" />
            {t("dashboard.statusError")}
          </Button>
        ) : (
          <StatusDot state={row.live.data ? releaseState(row.live.data) : rowState(row)} />
        ),
    },
    {
      key: "instances",
      title: t("dashboard.instances"),
      width: 100,
      render: (row) => (
        <span className="tabular-nums">{row.live.data ? `${row.live.data.ready} / ${row.live.data.total}` : "-"}</span>
      ),
    },
    { key: "namespace", title: t("list.columns.namespace"), width: 150 },
    {
      key: "route",
      title: t("list.columns.route"),
      width: 160,
      render: (row) => <span className="font-mono text-xs">{row.route ? `/${row.route}/` : "-"}</span>,
    },
  ];
  const all = (path: string) => (
    <Link to={p(path)} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline">
      {t("actions.viewAll")}
      <ArrowRight className="size-3.5" />
    </Link>
  );
  const metrics = [
    { icon: BrainCircuit, label: t("dashboard.supportedModels"), value: supported.totals?.models ?? "-", path: "catalog" },
    { icon: Layers, label: t("dashboard.recipeTotal"), value: supported.totals?.recipes ?? "-", path: "catalog" },
    { icon: CircleCheck, label: t("dashboard.serving"), value: health?.serving ?? "-", path: "" },
    { icon: TriangleAlert, label: t("dashboard.failedServices"), value: health?.failed ?? "-", path: "" },
    { icon: Loader2, label: t("dashboard.changing"), value: health?.degraded ?? "-", path: "" },
    { icon: Bot, label: t("dashboard.instances"), value: health ? `${health.ready} / ${health.instances}` : "-", path: "" },
  ];

  return (
    <section className="col-span-full min-w-0 space-y-4" aria-label={t("dashboard.title")}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <Link key={metric.label} to={p(metric.path)} className="min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
            <Metric {...metric} />
          </Link>
        ))}
      </div>
      {supported.error && (
        <QueryWarning message={t("dashboard.catalogError", { error: supported.error.message })} retry={supported.retry} />
      )}
      {health && health.unknown > 0 && (
        <QueryWarning
          message={t("dashboard.healthUnknown", { n: health.unknown })}
          retry={() =>
            statuses.forEach((s) => {
              if (s.error) void s.refetch();
            })
          }
        />
      )}
      {cluster.data?.warnings?.map((message) => (
        <QueryWarning key={message} message={message} />
      ))}
      {nodes.data?.usageError && (
        <QueryWarning message={t("nodes.usageError", { error: nodes.data.usageError })} retry={() => void nodes.refetch()} />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <DeploymentTrend />
            <CapacityGauges nodes={nodes} />
          </div>
          <section className="min-w-0" aria-label={t("list.title")}>
          {list.isPending && (
            <span role="status" className="sr-only">
              {t("common:status.loading")}
            </span>
          )}
          <ResourceTable<Row>
            title={t("list.title")}
            titleIcon={<Bot className="size-4" />}
            titleSummary={list.data && t("dashboard.preview", { shown: shown.length, total: list.data.summary.total })}
            titleActions={all("")}
            toolbarLayout="inline"
            data={shown}
            columns={columns}
            rowKey="key"
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            pagination={false}
            showColumnToggle={false}
            emptySize="compact"
            emptyTitle={t("list.empty")}
            emptyAction={
              <Button render={<Link to={p("catalog")} />} nativeButton={false}>
                <Plus className="size-4" />
                {t("list.deploy")}
              </Button>
            }
          />
        </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <ClusterOverview cluster={cluster} nodes={nodes} />
          <ResourceOverview nodes={nodes} />
          <section aria-label={t("dashboard.activity")}>
            <SectionCard
              title={t("dashboard.activity")}
              icon={<Activity className="size-4" />}
              actions={all("runs")}
              padded={false}
              loading={runs.isPending}
              error={runs.error}
              onRetry={() => void runs.refetch()}
            >
              {runs.data?.runs.length ? (
                <ol className="divide-y divide-border">
                  {runs.data.runs.map((run) => (
                    <li key={run.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <Link
                          to={p(detailPath(run.release, run.namespace, "runs"))}
                          className="truncate text-sm font-medium text-primary hover:underline"
                        >
                          {run.release}
                        </Link>
                        <Badge variant={run.error ? "destructive" : run.changed ? "success" : "secondary"}>
                          {t(run.error ? "runs.failed" : run.changed ? "runs.changed" : "runs.unchanged")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t(`runsPage.actions.${run.action}`, { defaultValue: run.action })}</span>
                        <time dateTime={run.startedAt}>{formatDateTime(run.startedAt)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
                  <Activity className="size-4" />
                  <span>{t(runs.data?.hasStore === false ? "overview.noStore" : "runs.empty")}</span>
                </div>
              )}
            </SectionCard>
          </section>
        </aside>
      </div>
    </section>
  );
}

function CapacityGauges({ nodes }: { nodes: UseQueryResult<NodesResponse> }) {
  const t = useT();
  const data = nodes.data;
  const known = !!data && !data.usageError;
  const ready = data ? data.nodes.filter((n) => n.Ready).length : null;
  const gauges = [
    {
      label: t("dashboard.resources.allocation"),
      value: known ? data.summary.gpusUsed : null,
      total: data?.summary.gpus ?? null,
      color: "var(--info)",
      detail: known
        ? t("dashboard.resources.freeCount", { n: Math.max(0, data!.summary.gpus - data!.summary.gpusUsed) })
        : t("dashboard.resources.unknown"),
    },
    {
      label: t("dashboard.resources.online"),
      value: ready,
      total: data?.summary.nodes ?? null,
      color: "var(--success)",
      detail:
        ready === null || !data
          ? t("dashboard.resources.unknown")
          : t("dashboard.resources.readyCount", { ready, total: data.summary.nodes }),
    },
  ];
  return (
    <section aria-label={t("dashboard.capacity")}>
    <SectionCard
      title={t("dashboard.capacity")}
      icon={<Cpu className="size-4" />}
      loading={nodes.isPending}
      error={nodes.error}
      onRetry={() => void nodes.refetch()}
    >
      <div className="grid grid-cols-2 gap-4 p-4">
        {gauges.map((gauge) => {
          const value = gauge.value;
          const total = gauge.total;
          const measured = value !== null && total !== null && total > 0;
          const percent = measured ? Math.min(100, Math.max(0, Math.round((value / total) * 100))) : null;
          const angle = Math.min(100, percent ?? 0) * 3.6;
          return (
            <div key={gauge.label} className="flex min-w-0 flex-col items-center gap-2 text-center">
              <div
                role={measured ? "meter" : "img"}
                aria-label={gauge.label}
                aria-valuetext={measured ? `${value} / ${total}` : undefined}
                className="relative grid aspect-square w-full max-w-24 place-items-center rounded-full"
                style={{ background: `conic-gradient(${gauge.color} 0deg ${angle}deg, var(--muted) ${angle}deg 360deg)` }}
              >
                <div className="absolute inset-1.5 rounded-full bg-card" />
                <span className="relative text-xl font-semibold tabular-nums">{percent === null ? "-" : `${percent}%`}</span>
              </div>
              <div className="break-words text-xs font-medium">{gauge.label}</div>
              <div className="break-words text-xs text-muted-foreground">{gauge.detail}</div>
            </div>
          );
        })}
      </div>
    </SectionCard>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | string }) {
  return (
    <Card role="group" aria-label={`${label}: ${value}`} className="min-h-[92px] rounded-lg py-0">
      <CardContent className="flex flex-1 flex-col justify-center gap-2 p-3.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="break-words text-xs text-muted-foreground">{label}</span>
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function QueryWarning({ message, retry }: { message: string; retry?: () => void }) {
  const t = useT();
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertDescription className="flex min-w-0 flex-wrap items-center gap-2 break-words">
        <span className="min-w-0 flex-1 break-words">{message}</span>
        {retry && (
          <Button variant="ghost" size="sm" onClick={retry}>
            <RefreshCw className="size-3.5" />
            {t("dashboard.retry")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
