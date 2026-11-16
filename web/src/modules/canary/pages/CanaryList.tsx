import { ErrorNotice, ErrorDetails } from "../components/ErrorNotice";
import { describeError, visibleExperimentError } from "../lib/errors";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "../lib/translation";
import { FlaskConical, Plus } from "lucide-react";
import {
  Button,
  PageBanner,
  ResourceTable,
  type ResourceColumn,
} from "@modelsphere/ui";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { usePluginPath } from "../lib/host";
import { PhaseBadge } from "../components/PhaseBadge";
import type { ExperimentSummary } from "../types";

export function CanaryList() {
  const { t } = useTranslation("canary");
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const p = usePluginPath();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("active");
  const list = useQuery({
    queryKey: ["experiments", api.mode],
    queryFn: () => api.experiments.list(),
    refetchInterval: 10000,
  });
  const historical = (e: ExperimentSummary) => e.state === "Stopped";
  const rows = (list.data ?? []).filter(
    (e) =>
      filter === "all" ||
      (filter === "active"
        ? !historical(e)
        : filter === "history"
          ? historical(e)
          : e.archived),
  );
  const columns: ResourceColumn<ExperimentSummary>[] = [
    {
      key: "name",
      title: t("list.name"),
      hideable: false,
      render: (e) => (
        <div>
          <Link
            to={p(`experiments/${e.id}`)}
            className="font-medium text-primary hover:underline"
          >
            {e.name}
          </Link>
          <div className="text-xs text-muted-foreground">
            {e.namespace} · {e.id.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: "state",
      title: t("experiments.state"),
      render: (e) => (
        <div>
          {t(`experiments.${e.state}`)}
          {e.archived && (
            <span className="ml-2 text-xs">{t("experiments.archived")}</span>
          )}
          {visibleExperimentError(e) && (
            <ErrorNotice
              error={visibleExperimentError(e)}
              className="text-xs text-destructive"
            />
          )}
        </div>
      ),
    },
    {
      key: "phase",
      title: t("list.phase"),
      render: (e) => <PhaseBadge phase={e.phase} state={e.state} />,
    },
    {
      key: "target",
      title: t("list.target"),
      render: (e) => (
        <span className="font-mono text-xs">
          {e.targetRef.namespace ?? e.namespace}/{e.targetRef.name}
        </span>
      ),
    },
    {
      key: "arms",
      title: t("experiments.compare"),
      render: (e) => e.compareArms.join(" / "),
    },
    {
      key: "created",
      title: t("experiments.createdAt"),
      render: (e) => (
        <span className="text-xs">
          {new Date(e.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "snapshot",
      title: t("experiments.snapshot"),
      render: (e) => (
        <span
          title={
            e.snapshotError
              ? describeError(e.snapshotError, t, "snapshot").summary
              : undefined
          }
        >
          {t(
            `experiments.${e.snapshot === "pending" && e.state === "Running" ? "collecting" : e.snapshot}`,
          )}
        </span>
      ),
    },
  ];
  const create = canWrite ? (
    <Button onClick={() => navigate(p("new"))}>
      <Plus />
      {t("nav.create")}
    </Button>
  ) : null;
  return (
    <div className="flex h-full flex-col">
      <PageBanner
        title={t("experiments.title")}
        description={t("subtitle")}
        icon={<FlaskConical className="size-5" />}
      />
      <div className="flex gap-2 p-4">
        {["all", "active", "history", "archived"].map((f) => (
          <Button
            key={f}
            size="sm"
            variant={f === filter ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {t(`experiments.${f}`)}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {list.error && <ErrorDetails error={list.error} />}
        <ResourceTable<ExperimentSummary>
          height="fill"
          data={rows}
          loading={list.isLoading}
          error={list.error ? describeError(list.error, t).summary : null}
          onRetry={() => void list.refetch()}
          rowKey="id"
          columns={columns}
          onRowClick={(e) => navigate(p(`experiments/${e.id}`))}
          showRefresh
          onRefresh={() => void list.refetch()}
          toolbarLeft={create}
          emptyTitle={t("list.empty")}
          emptyAction={create}
        />
      </div>
    </div>
  );
}
