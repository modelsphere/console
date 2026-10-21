import { asError } from "../lib/errors";
import { ErrorNotice } from "../components/ErrorNotice";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "../lib/translation";
import {
  Button,
  Badge,
  CodeBlock,
  DetailHeader,
  LoadingBlock,
  PanelTabs,
  PropertyList,
  SectionCard,
  Tabs,
  TabsContent,
} from "@modelsphere/ui";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { usePluginPath } from "../lib/host";
import { toYaml } from "../lib/yaml";
import type { LLMCanary, Experiment } from "../types";
import { phaseStatus } from "../components/PhaseBadge";
import { TrafficBar } from "../components/TrafficBar";

import { MetricsPanel } from "../components/MetricsPanel";

const DETAIL_TABS = ["overview", "arms", "traffic", "spec", "metrics"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function CanaryDetail({
  snapshot,
  experiment,
  onRefresh,
}: {
  snapshot?: LLMCanary;
  experiment?: Experiment;
  onRefresh?: () => void;
} = {}) {
  const { t } = useTranslation("canary");
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const [actionError, setActionError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      onRefresh?.();
    } catch (e) {
      setActionError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  const p = usePluginPath();
  const navigate = useNavigate();
  const { ns = "", name = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab =
    (DETAIL_TABS as readonly string[]).includes(requestedTab ?? "") &&
    (requestedTab !== "metrics" || !!experiment)
      ? (requestedTab as DetailTab)
      : "overview";
  const q = useQuery({
    queryKey: ["canary", api.mode, ns, name],
    enabled: !snapshot,
    queryFn: () => api.canary.get(ns, name),
  });

  if (!snapshot && q.isLoading)
    return <LoadingBlock text={t("common.loading")} className="min-h-64" />;
  if (q.error)
    return <ErrorNotice error={q.error} className="p-4 text-destructive" />;
  const canary = snapshot ?? q.data;
  if (!canary) {
    return (
      <div className="grid gap-2 p-4">
        <p>{t("common.missing")}</p>
        <Link to={p("")} className="text-sm text-primary hover:underline">
          {t("common.back")}
        </Link>
      </div>
    );
  }

  const ready = canary.status?.arms?.filter((a) => a.ready).length ?? 0;
  const target = `${canary.spec.targetRef.kind}/${canary.spec.targetRef.namespace ?? canary.metadata.namespace}/${canary.spec.targetRef.name}`;
  const historical = experiment?.state === "Stopped";
  const status = phaseStatus(
    canary.status?.phase,
    historical,
    t("experiments.Stopped"),
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {experiment && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{t(`experiments.${experiment.state}`)}</Badge>
          <span className="text-xs">
            ID: {experiment.id} · UID: {experiment.uid ?? "—"} ·{" "}
            {t("experiments.snapshot")}:{" "}
            {t(
              `experiments.${experiment.snapshot === "pending" && experiment.state === "Running" ? "collecting" : experiment.snapshot}`,
            )}
          </span>
          {canWrite && (
            <>
              {experiment.cleanup !== "complete" && (
                <Button
                  disabled={busy || experiment.state === "Stopping"}
                  onClick={() =>
                    void action(() => api.experiments.stop(experiment.id))
                  }
                >
                  {t("experiments.stop")}
                </Button>
              )}
              {experiment.state === "Stopped" && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void action(() =>
                      api.experiments.archive(
                        experiment.id,
                        !experiment.archived,
                      ),
                    )
                  }
                >
                  {t(
                    experiment.archived
                      ? "experiments.unarchive"
                      : "experiments.archive",
                  )}
                </Button>
              )}
              {experiment.snapshot === "failed" && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void action(() => api.experiments.snapshot(experiment.id))
                  }
                >
                  {t("experiments.retry")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {(actionError || experiment?.error) && (
        <ErrorNotice error={actionError ?? experiment?.error} />
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if ((DETAIL_TABS as readonly string[]).includes(value))
            setSearchParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("tab", value);
                return next;
              },
              { replace: true },
            );
        }}
        className="flex-col gap-4"
      >
        <DetailHeader
          onBack={() => navigate(p(""))}
          backLabel={t("common.back")}
          title={canary.metadata.name}
          subtitle={<span className="font-mono text-xs">{target}</span>}
          status={status}
          meta={[
            { label: t("create.namespace"), value: canary.metadata.namespace },
            {
              label: t("list.target"),
              value: <span className="font-mono text-xs">{target}</span>,
            },
            {
              label: t("detail.gatewayCard"),
              value: (
                <span className="font-mono text-xs">{`${canary.spec.gateway.namespace}/${canary.spec.gateway.name}`}</span>
              ),
            },
            {
              label: t("list.arms"),
              value: `${ready}/${canary.spec.arms.length}`,
            },
          ]}
          metaColumns={4}
        />
        <PanelTabs
          items={[
            { value: "overview", label: t("detail.overview") },
            {
              value: "arms",
              label: t("detail.arms"),
              count: canary.spec.arms.length,
            },
            { value: "traffic", label: t("detail.traffic") },
            { value: "spec", label: t("detail.spec") },
            ...(experiment
              ? [{ value: "metrics", label: t("experiments.metrics") }]
              : []),
          ]}
        />

        {experiment && (
          <TabsContent value="metrics">
            <MetricsPanel experiment={experiment} />
          </TabsContent>
        )}
        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard
              title={historical ? t("detail.historicalStatus") : "Status"}
            >
              {historical && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("detail.historicalHint")}
                </p>
              )}
              <PropertyList
                columns={1}
                labelClassName="w-40 shrink-0"
                valueClassName="whitespace-normal break-all"
                items={[
                  { label: "phase", value: canary.status?.phase ?? "—" },
                  {
                    label: "routePath",
                    value: mono(canary.status?.routePath ?? "—"),
                  },
                  {
                    label: "routeName",
                    value: mono(canary.status?.routeName ?? "—"),
                  },
                  {
                    label: "gateway",
                    value: mono(
                      `${canary.spec.gateway.namespace}/${canary.spec.gateway.name}`,
                    ),
                  },
                  {
                    label: "arms ready",
                    value: `${ready}/${canary.spec.arms.length}`,
                  },
                  {
                    label: "armsReadySince",
                    value: canary.status?.armsReadySince ?? "—",
                  },
                  {
                    label: "generation",
                    value: `${canary.status?.observedGeneration ?? "—"} / ${canary.metadata.generation ?? "—"}`,
                  },
                  ...(canary.status?.drainInFlight != null
                    ? [
                        {
                          label: "drainInFlight",
                          value: String(canary.status.drainInFlight),
                        },
                      ]
                    : []),
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {t("detail.comparable")}
              </p>
            </SectionCard>
            <SectionCard title={t("detail.conditions")}>
              <div className="grid gap-2">
                {(canary.status?.conditions ?? []).map((c) => (
                  <div
                    key={c.type}
                    className="rounded-lg bg-muted/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          c.status === "True"
                            ? "success"
                            : c.status === "False"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {c.status}
                      </Badge>
                      <span className="font-medium">{c.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.reason}
                      </span>
                    </div>
                    {c.message ? (
                      c.status === "True" ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.message}
                        </p>
                      ) : (
                        <ErrorNotice
                          error={c.message}
                          fallback="condition"
                          className="mt-1 text-xs text-muted-foreground"
                        />
                      )
                    ) : null}
                  </div>
                ))}
                {canary.spec.guardrails ? (
                  <p className="text-xs text-muted-foreground">
                    {t("detail.notEnforced")}
                  </p>
                ) : null}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="arms">
          <div className="grid gap-4">
            {canary.spec.arms.map((arm) => {
              const st = canary.status?.arms?.find((a) => a.name === arm.name);
              const proxy = canary.status?.canaryProxies?.find(
                (a) => a.arm === arm.name,
              );
              return (
                <SectionCard
                  key={arm.name}
                  title={<span className="font-mono">{arm.name}</span>}
                  summary={
                    arm.source
                      ? `${t("detail.lineage")}: ${arm.source.model} ${arm.source.variant}@${arm.source.version}`
                      : "No catalog lineage on this arm."
                  }
                  actions={
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant={st?.ready ? "success" : "warning"}>
                        {st?.ready ? t("detail.ready") : "not ready"}
                      </Badge>
                      <Badge variant="outline">
                        {arm.chart.name}:{arm.chart.version}
                      </Badge>
                    </span>
                  }
                >
                  {proxy ? (
                    <p className="mb-2 text-xs text-muted-foreground">
                      proxy {proxy.name}
                    </p>
                  ) : null}
                  <CodeBlock
                    language="yaml"
                    value={toYaml(arm.values)}
                    maxHeight="16rem"
                  />
                </SectionCard>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="traffic">
          <TrafficPanel canary={canary} />
        </TabsContent>

        <TabsContent value="spec">
          <CodeBlock
            language="yaml"
            value={toYaml(canary)}
            downloadName={`${canary.metadata.name}.yaml`}
            maxHeight="28rem"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TrafficPanel({ canary }: { canary: LLMCanary }) {
  const { t } = useTranslation("canary");
  const routeOn = canary.spec.route.enabled ?? true;
  const path = canary.spec.route.path ?? "—";
  const observedPath = canary.status?.routePath;
  const port = canary.spec.route.servicePort;

  return (
    <div className="grid gap-4">
      <SectionCard
        title={`${t("detail.split")} ${canary.spec.traffic.production}:${canary.spec.traffic.canary}`}
        hint={t("detail.splitHint")}
      >
        <div className="grid gap-3">
          <TrafficBar
            production={canary.spec.traffic.production}
            canary={canary.spec.traffic.canary}
          />
          <PropertyList
            columns={2}
            items={[
              {
                label: t("create.weightProd"),
                value: String(canary.spec.traffic.production),
              },
              {
                label: t("create.weightCanary"),
                value: String(canary.spec.traffic.canary),
              },
            ]}
          />
        </div>
      </SectionCard>
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard
          title={t("detail.gatewayCard")}
          summary={`${canary.spec.gateway.namespace}/${canary.spec.gateway.name}`}
        >
          <PropertyList
            columns={1}
            labelClassName="w-44 shrink-0"
            valueClassName="whitespace-normal break-all"
            items={[
              {
                label: t("create.gatewayName"),
                value: mono(canary.spec.gateway.name),
              },
              {
                label: t("create.gatewayNs"),
                value: mono(canary.spec.gateway.namespace),
              },
              {
                label: t("create.hostname"),
                value: mono(canary.spec.gateway.hostname || t("detail.unset")),
              },
              {
                label: t("create.sectionName"),
                value: mono(
                  canary.spec.gateway.sectionName || t("detail.unset"),
                ),
              },
              {
                label: `${t("detail.observed")} gatewayNamespace`,
                value: mono(canary.status?.gatewayNamespace ?? "—"),
              },
            ]}
          />
        </SectionCard>
        <SectionCard
          title={t("detail.routeCard")}
          summary={<span className="font-mono">{path}</span>}
          actions={
            <Badge variant={routeOn ? "success" : "warning"}>
              {routeOn ? t("detail.routeOn") : t("detail.routeOff")}
            </Badge>
          }
        >
          <PropertyList
            columns={1}
            labelClassName="w-44 shrink-0"
            valueClassName="whitespace-normal break-all"
            items={[
              { label: "route.enabled", value: String(routeOn) },
              { label: t("create.routePath"), value: mono(path) },
              {
                label: `${t("detail.observed")} routePath`,
                value: mono(observedPath ?? "—"),
              },
              {
                label: "routeName",
                value: mono(canary.status?.routeName ?? "—"),
              },
              {
                label: t("create.openresty"),
                value: mono(canary.spec.route.productionOpenrestyService),
              },
              {
                label: t("create.servicePort"),
                value: mono(port ? String(port) : t("detail.dispatchPort")),
              },
              {
                label: t("create.forceHeader"),
                value: mono(
                  canary.spec.route.forceHeader
                    ? `${canary.spec.route.forceHeader.name}: ${canary.spec.route.forceHeader.value}`
                    : t("detail.unset"),
                ),
              },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}

function mono(value: string): ReactNode {
  return <span className="font-mono text-xs">{value}</span>;
}
