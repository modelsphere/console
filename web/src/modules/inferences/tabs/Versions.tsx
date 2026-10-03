import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, ResourceTable, Tabs, TabsContent, TabsList, TabsTrigger, type ResourceColumn, type ResourceRowAction } from "@modelsphere/ui";
import { formatDateTime } from "@/shell";
import { api } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { modelLine, revisionRows, swissLinks, type RevisionRow } from "@/modules/inferences/lib";
import { swissBase } from "@/modules/inferences/components/SwissScope";

// helm's revisions, newest first, with the run that made each one for the when,
// who and why. A row expands to the values helm holds for it; rolling back goes
// to swiss's upgrade wizard, which shows the diff before it does anything.
export function Versions({ namespace, release, canRollBack }: { namespace: string; release: string; canRollBack: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const swiss = swissLinks(swissBase);
  const revisions = useQuery({
    queryKey: ["revisions", namespace, release],
    queryFn: () => api.revisions(namespace, release),
  });
  const runs = useQuery({
    queryKey: ["runs", namespace, release],
    queryFn: () => api.runs({ namespace, release, limit: 200 }),
  });

  const rows = revisionRows(revisions.data?.revisions ?? [], runs.data?.runs ?? []);

  const columns: ResourceColumn<RevisionRow>[] = [
    {
      key: "revision",
      title: t("versions.columns.revision"),
      width: 120,
      hideable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono">r{r.revision}</span>
          {r.current && <Badge variant="info">{t("versions.current")}</Badge>}
        </span>
      ),
    },
    { key: "model", title: t("versions.columns.model"), render: (r) => modelLine(r) || "-" },
    { key: "chart", title: t("versions.columns.chart"), width: 180, render: (r) => r.chart || "-" },
    { key: "time", title: t("versions.columns.time"), width: 170, render: (r) => (r.run ? formatDateTime(r.run.endedAt) : "-") },
    { key: "actor", title: t("versions.columns.actor"), width: 120, render: (r) => r.run?.actor || "-" },
    {
      key: "note",
      title: t("versions.columns.note"),
      render: (r) => (r.run?.note ? <span className="line-clamp-2 text-muted-foreground" title={r.run.note}>{r.run.note}</span> : "-"),
    },
  ];

  const rowActions: ResourceRowAction<RevisionRow>[] = [
    {
      key: "rollback",
      label: t("actions.rollback"),
      onClick: (r) => navigate(swiss.rollback(namespace, release, r.revision)),
      disabled: (r) => (r.current ? t("disabled.current") : !canRollBack ? t("disabled.readOnly") : false),
    },
  ];

  return (
    <ResourceTable<RevisionRow>
      title={t("versions.title")}
      titleSummary={t("versions.hint")}
      data={rows}
      loading={revisions.isPending}
      error={revisions.error}
      onRetry={() => void revisions.refetch()}
      rowKey="revision"
      columns={columns}
      rowActions={rowActions}
      expandable={{ render: (r) => <RevisionValues namespace={namespace} release={release} revision={r.revision} /> }}
      emptyTitle={t("versions.empty")}
    />
  );
}

function RevisionValues({ namespace, release, revision }: { namespace: string; release: string; revision: number }) {
  const t = useT();
  const values = useQuery({
    queryKey: ["revisionValues", namespace, release, revision],
    queryFn: () => api.revisionValues(namespace, release, revision),
  });
  if (values.isPending) return <p className="text-sm text-muted-foreground">{t("common:status.loading")}</p>;
  if (values.error) return <p className="text-sm text-destructive">{values.error.message}</p>;
  const v = values.data;
  return (
    <Tabs defaultValue="supplied" className="gap-2">
      <TabsList>
        <TabsTrigger value="supplied">{t("versions.supplied")}</TabsTrigger>
        <TabsTrigger value="all">{t("versions.all")}</TabsTrigger>
      </TabsList>
      <TabsContent value="supplied">
        {v.suppliedError ? (
          <p className="text-sm text-destructive">{t("versions.suppliedError", { error: v.suppliedError })}</p>
        ) : (
          <Yaml text={v.supplied} />
        )}
      </TabsContent>
      <TabsContent value="all">
        <Yaml text={v.all} />
      </TabsContent>
    </Tabs>
  );
}

function Yaml({ text }: { text: string }) {
  return <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">{text || "{}"}</pre>;
}
