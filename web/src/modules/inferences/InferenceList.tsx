import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  PageBanner,
  ResourceTable,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type ResourceColumn,
  type ResourceRowAction,
} from "@modelsphere/ui";
import { Bot, Plus } from "lucide-react";
import { formatDateTime, useModulePath } from "@/shell";
import { api, type Deployment } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { detailPath, modelLine, rowState, swissLinks } from "@/modules/inferences/lib";
import { StatusDot } from "@/modules/inferences/components/StatusDot";
import { UninstallDialog, type UninstallTarget } from "@/modules/inferences/components/UninstallDialog";
import { swissBase } from "@/modules/inferences/components/SwissScope";

// swissd caps a page at 100: each row reads its plan, which is the cost paging
// exists to bound.
const PAGE_SIZES = [10, 25, 50, 100];

type Row = Deployment & { key: string };

export function InferenceList() {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const swiss = swissLinks(swissBase);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [uninstalling, setUninstalling] = useState<UninstallTarget | null>(null);

  // The same key prefix as swiss's own list, so an uninstall from either side
  // refreshes both.
  const list = useQuery({
    queryKey: ["deployments", "inferences", page, pageSize],
    queryFn: () => api.deployments(page, pageSize),
    // A release changes on a human timescale; a rollout takes 20-40 minutes.
    refetchInterval: 15_000,
    // Keeps the current page up while the next loads, so paging is not a reload.
    placeholderData: (prev) => prev,
  });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const readOnly = cluster.data ? !cluster.data.allowDeploy : false;

  // Already in the server's order, which is the order pages are cut on.
  const rows: Row[] = (list.data?.deployments ?? []).map((d) => ({ ...d, key: `${d.namespace}/${d.release}` }));
  const open = (d: Deployment) => navigate(p(detailPath(d.release, d.namespace)));

  const columns: ResourceColumn<Row>[] = [
    {
      key: "release",
      title: t("list.columns.name"),
      hideable: false,
      render: (d) => (
        <div className="min-w-0">
          <Link to={p(detailPath(d.release, d.namespace))} className="block truncate font-medium text-primary hover:underline">
            {d.release}
          </Link>
          <div className="truncate text-xs text-muted-foreground">{modelLine(d) || t("list.untracked")}</div>
        </div>
      ),
    },
    { key: "state", title: t("list.columns.state"), width: 110, render: (d) => <StatusDot state={rowState(d)} /> },
    { key: "namespace", title: t("list.columns.namespace"), width: 150 },
    {
      key: "route",
      title: t("list.columns.route"),
      width: 160,
      render: (d) => (d.route ? <span className="font-mono text-xs">/{d.route}/</span> : <span className="text-muted-foreground">-</span>),
    },
    { key: "chart", title: t("list.columns.chart"), width: 180, render: (d) => <span className="text-sm">{d.chart || "-"}</span> },
    { key: "revision", title: t("list.columns.revision"), width: 70, align: "right", render: (d) => <span className="tabular-nums">{d.revision}</span> },
    {
      key: "updated",
      title: t("list.columns.updated"),
      width: 170,
      render: (d) => (d.updated ? formatDateTime(d.updated) : "-"),
    },
    {
      key: "drift",
      title: t("list.columns.catalog"),
      width: 110,
      render: (d) =>
        d.drift ? (
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <Badge variant="warning">{t("list.behind")}</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{d.drift}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ];

  const writeBlocked = (d: Deployment): boolean | string =>
    readOnly ? t("disabled.readOnly") : !d.model ? t("disabled.untracked") : false;

  // More than two fold behind "…", leaving Details inline -- the same shape as
  // Rise Global's lists.
  const rowActions: ResourceRowAction<Row>[] = [
    { key: "detail", label: t("actions.detail"), onClick: open },
    { key: "upgrade", label: t("actions.upgrade"), onClick: (d) => navigate(swiss.upgrade(d.namespace, d.release)), disabled: writeBlocked },
    { key: "versions", label: t("actions.versions"), onClick: (d) => navigate(p(detailPath(d.release, d.namespace, "versions"))) },
    {
      key: "uninstall",
      label: t("actions.uninstall"),
      danger: true,
      onClick: (d) => setUninstalling({ namespace: d.namespace, release: d.release }),
      disabled: () => (readOnly ? t("disabled.readOnly") : false),
    },
  ];

  const deploy = (
    <Button onClick={() => navigate(swiss.catalog)}>
      <Plus className="size-4" /> {t("list.deploy")}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <PageBanner title={t("list.title")} description={t("list.description")} icon={<Bot className="size-5" />} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <ResourceTable<Row>
          height="fill"
          toolbarLayout="inline"
          mode="remote"
          data={rows}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          rowKey="key"
          columns={columns}
          page={page}
          pageSize={pageSize}
          total={list.data?.summary.total ?? 0}
          pageSizeOptions={PAGE_SIZES}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          showRefresh
          onRefresh={() => qc.invalidateQueries({ queryKey: ["deployments"] })}
          rowActions={rowActions}
          toolbarLeft={deploy}
          emptyTitle={t("list.empty")}
          emptyAction={deploy}
        />
      </div>
      <UninstallDialog target={uninstalling} onClose={() => setUninstalling(null)} />
    </div>
  );
}
