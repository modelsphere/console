import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, ResourceTable, type ResourceColumn } from "@modelsphere/ui";
import { formatDateTime } from "@/shell";
import { api, type Run } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { swissLinks } from "@/modules/inferences/lib";
import { swissBase } from "@/modules/inferences/components/SwissScope";

// Everything swissd did to this release, newest first. The list leaves out the
// helmfile output (tens of kilobytes a row); expanding a row fetches it.
export function Runs({ namespace, release }: { namespace: string; release: string }) {
  const t = useT();
  const navigate = useNavigate();
  const runs = useQuery({
    queryKey: ["runs", namespace, release],
    queryFn: () => api.runs({ namespace, release, limit: 200 }),
  });

  const columns: ResourceColumn<Run>[] = [
    { key: "startedAt", title: t("runs.columns.time"), width: 170, render: (r) => formatDateTime(r.startedAt) },
    { key: "action", title: t("runs.columns.action"), width: 110 },
    {
      key: "result",
      title: t("runs.columns.result"),
      width: 100,
      render: (r) =>
        r.error ? (
          <Badge variant="destructive">{t("runs.failed")}</Badge>
        ) : (
          <Badge variant={r.changed ? "success" : "secondary"}>{t(r.changed ? "runs.changed" : "runs.unchanged")}</Badge>
        ),
    },
    { key: "revision", title: t("runs.columns.revision"), width: 80, render: (r) => (r.revision !== undefined ? <span className="font-mono">r{r.revision}</span> : "-") },
    { key: "actor", title: t("runs.columns.actor"), width: 120, render: (r) => r.actor || "-" },
    {
      key: "note",
      title: t("runs.columns.note"),
      render: (r) => {
        const text = r.error ?? r.note;
        if (!text) return "-";
        return (
          <span className={r.error ? "line-clamp-2 text-destructive" : "line-clamp-2 text-muted-foreground"} title={text}>
            {text}
          </span>
        );
      },
    },
  ];

  return (
    <ResourceTable<Run>
      title={t("tabs.runs")}
      titleActions={
        <Button variant="outline" size="sm" onClick={() => navigate(swissLinks(swissBase).runs(namespace, release))}>
          {t("actions.openInSwiss")}
        </Button>
      }
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
