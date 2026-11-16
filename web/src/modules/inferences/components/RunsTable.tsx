import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, ResourceTable, type ResourceColumn } from "@modelsphere/ui";
import type { ReactNode } from "react";
import { formatDateTime, useModulePath } from "@/shell";
import { api, type Run } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { detailPath } from "@/modules/inferences/lib";

export function took(r: Pick<Run, "startedAt" | "endedAt">): string {
  const s = Math.max(0, Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000));
  if (!Number.isFinite(s)) return "-";
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${s % 60 ? `${s % 60}s` : ""}` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export function RunsTable({
  namespace,
  release,
  action,
  showService,
  fill,
  title,
  titleActions,
  filters,
  activeFilters,
  onRemoveFilter,
}: {
  namespace?: string;
  release?: string;
  action?: string;
  showService?: boolean;
  fill?: boolean;
  title?: ReactNode;
  titleActions?: ReactNode;
  filters?: ReactNode;
  activeFilters?: { key: string; label: string; display: string }[];
  onRemoveFilter?: (key: string) => void;
}) {
  const t = useT();
  const p = useModulePath();
  const runs = useQuery({
    queryKey: ["runs", namespace ?? "", release ?? "", action ?? ""],
    queryFn: () => api.runs({ namespace, release, action, limit: 200 }),
    refetchInterval: 20_000,
  });

  const columns: ResourceColumn<Run>[] = [
    { key: "startedAt", title: t("runs.columns.time"), width: 170, render: (r) => formatDateTime(r.startedAt) },
    { key: "action", title: t("runs.columns.action"), width: 90, render: (r) => t(`runsPage.actions.${r.action}`, { defaultValue: r.action }) },
    ...(showService
      ? [
          {
            key: "release",
            title: t("runsPage.service"),
            render: (r: Run) => (
              <Link to={p(detailPath(r.release, r.namespace))} className="font-medium text-primary hover:underline">
                {r.release}
                <span className="ms-1.5 text-xs font-normal text-muted-foreground">{r.namespace}</span>
              </Link>
            ),
          },
        ]
      : []),
    {
      key: "result",
      title: t("runs.columns.result"),
      width: 100,
      render: (r) =>
        r.error ? <Badge variant="destructive">{t("runs.failed")}</Badge> : <Badge variant={r.changed ? "success" : "secondary"}>{t(r.changed ? "runs.changed" : "runs.unchanged")}</Badge>,
    },
    { key: "took", title: t("runsPage.took"), width: 80, render: (r) => <span className="tabular-nums">{took(r)}</span> },
    { key: "revision", title: t("runs.columns.revision"), width: 70, render: (r) => (r.revision !== undefined ? <span className="font-mono">r{r.revision}</span> : "-") },
    { key: "planHash", title: t("runsPage.plan"), width: 110, defaultHidden: !showService, render: (r) => <span className="font-mono text-xs" title={r.planHash}>{r.planHash.replace(/^sha256:/, "").slice(0, 12)}</span> },
    { key: "actor", title: t("runs.columns.actor"), width: 120, render: (r) => r.actor || "-" },
    {
      key: "note",
      title: t("runs.columns.note"),
      render: (r) => {
        const text = r.error ?? r.note;
        return text ? (
          <span className={r.error ? "line-clamp-2 text-destructive" : "line-clamp-2 text-muted-foreground"} title={text}>
            {text}
          </span>
        ) : (
          "-"
        );
      },
    },
  ];

  return (
    <ResourceTable<Run>
      height={fill ? "fill" : "auto"}
      toolbarLayout="inline"
      showColumnToggle={!!showService}
      title={title}
      titleActions={titleActions}
      filters={filters}
      activeFilters={activeFilters}
      onRemoveFilter={onRemoveFilter}
      showRefresh={!!showService}
      onRefresh={() => void runs.refetch()}
      data={runs.data?.runs ?? []}
      loading={runs.isPending}
      error={runs.error}
      onRetry={() => void runs.refetch()}
      rowKey="id"
      columns={columns}
      expandable={{ render: (r) => <RunOutput id={r.id} /> }}
      emptyTitle={runs.data && !runs.data.hasStore ? t("overview.noStore") : t("runs.empty")}
    />
  );
}

function RunOutput({ id }: { id: number }) {
  const t = useT();
  const run = useQuery({ queryKey: ["run", id], queryFn: () => api.run(id) });
  if (run.isPending) return <p className="text-sm text-muted-foreground">{t("common:status.loading")}</p>;
  if (run.error) return <p className="text-sm text-destructive">{run.error.message}</p>;
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{t("runs.output")}</div>
      <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{run.data.output || "-"}</pre>
    </div>
  );
}
