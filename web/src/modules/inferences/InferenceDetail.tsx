import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, DetailHeader, PanelTabs, SectionCard, Skeleton, Tabs, TabsContent } from "@modelsphere/ui";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api } from "@swiss/lib/api";
import { isUninstalling } from "@swiss/lib/phase";
import { useReleaseObjects } from "@swiss/components/ReleaseObjects";
import { ReleaseObjects } from "@swiss/components/ReleaseObjects";
import { Endpoint } from "@swiss/components/Endpoint";
import { Provenance } from "@swiss/components/Provenance";
import { useT } from "@/modules/inferences/i18n";
import { modelLine, parseTab, releaseState, sloBlocked, visibleTabs, type Tab } from "@/modules/inferences/lib";
import { statusOf } from "@/modules/inferences/components/StatusDot";
import { DeploySheet } from "@/modules/inferences/components/DeploySheet";
import { UninstallDialog } from "@/modules/inferences/components/UninstallDialog";
import { SLOSheet } from "@/modules/inferences/components/SLOSheet";
import { Overview } from "@/modules/inferences/tabs/Overview";
import { Instances } from "@/modules/inferences/tabs/Instances";
import { Versions } from "@/modules/inferences/tabs/Versions";
import { Runs } from "@/modules/inferences/tabs/Runs";
import { Logs } from "@/modules/inferences/tabs/Logs";
import { Events } from "@/modules/inferences/tabs/Events";

export function InferenceDetail() {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const location = useLocation();
  const { release = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const namespace = search.get("namespace") ?? "";
  const [uninstalling, setUninstalling] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [editingSLO, setEditingSLO] = useState(false);
  // Set by the deploy sheet after a first install with SLO on.
  const [sloSetup, setSloSetup] = useState(() => (location.state as { sloSetup?: boolean } | null)?.sloSetup === true);

  // Query keys match swiss's pages, so the two views share one cache.
  const status = useQuery({
    queryKey: ["status", namespace, release],
    queryFn: () => api.status(namespace, release),
    refetchInterval: 15_000,
    enabled: !!namespace,
  });
  // A release swiss did not deploy has no plan beside it: untracked, not an error.
  const plan = useQuery({
    queryKey: ["releasePlan", namespace, release],
    queryFn: () => api.releasePlan(namespace, release),
    retry: false,
    enabled: !!namespace,
  });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const objects = useReleaseObjects(namespace, release);
  const revisions = useQuery({
    queryKey: ["revisions", namespace, release],
    queryFn: () => api.revisions(namespace, release),
    enabled: !!namespace,
  });

  const s = status.data;
  const visible = visibleTabs({ plan: !!plan.data });
  const tab = parseTab(search.get("tab"), visible);
  const setTab = (next: Tab, pod?: string) =>
    setSearch(
      (q) => {
        if (next === "overview") q.delete("tab");
        else q.set("tab", next);
        if (pod) q.set("pod", pod);
        else q.delete("pod");
        return q;
      },
      { replace: true },
    );

  const back = (
    <Link to={p("")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {t("detail.back")}
    </Link>
  );

  if (!namespace || status.isPending) {
    return (
      <Page>
        {back}
        <Skeleton className="h-32 w-full" />
      </Page>
    );
  }
  if (status.error || !s) {
    return (
      <Page>
        {back}
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{String(status.error?.message ?? status.error)}</AlertDescription>
        </Alert>
      </Page>
    );
  }

  const readOnly = cluster.data ? !cluster.data.allowDeploy : false;
  const removing = isUninstalling(s);
  const blockedWrite = readOnly ? t("disabled.readOnly") : removing ? t("disabled.uninstalling") : false;
  const source = plan.data?.source;
  const model = modelLine(source ?? {}) || s.model;
  const pods = s.pods.map((p) => p.name);
  const blocked = sloBlocked(s, plan.data);
  const sloOpen = !removing && (editingSLO || (sloSetup && blocked !== "off" && s.planStatus?.phase !== "failed"));
  const closeSLO = () => {
    setEditingSLO(false);
    if (!sloSetup) return;
    setSloSetup(false);
    navigate(location, { replace: true, state: null });
  };
  const counts: Partial<Record<Tab, number>> = { instances: s.pods.length, versions: revisions.data?.revisions.length };

  return (
    <Page>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex-col gap-4">
        <DetailHeader
          onBack={() => navigate(p(""))}
          backLabel={t("detail.back")}
          title={release}
          status={statusOf(releaseState(s), t, s.total > 0 ? `${s.ready}/${s.total}` : undefined)}
          notice={!plan.data && plan.isError ? { tone: "warning", title: t("detail.untracked") } : undefined}
          actions={[
            { key: "check", label: t("actions.check"), onClick: () => setTab("check") },
            {
              key: "slo",
              label: t("actions.slo"),
              disabled: blockedWrite || (blocked === "off" ? t("disabled.sloOff") : blocked === "pending" ? t("disabled.sloPending") : false),
              onClick: () => setEditingSLO(true),
            },
            {
              key: "upgrade",
              label: t("actions.upgrade"),
              disabled: blockedWrite || (!plan.data ? t("disabled.untracked") : false),
              onClick: () => setUpgrading(true),
            },
            {
              key: "uninstall",
              label: t("actions.uninstall"),
              danger: true,
              disabled: blockedWrite || !s.exists,
              onClick: () => setUninstalling(true),
            },
          ]}
          meta={[
            { label: t("detail.fields.namespace"), value: namespace },
            { label: t("detail.fields.model"), value: <span title={model}>{model || "-"}</span> },
            { label: t("detail.fields.chart"), value: plan.data ? `${plan.data.chart.name}-${plan.data.chart.version}` : "-" },
            { label: t("detail.fields.instances"), value: `${s.ready}/${s.total}` },
          ]}
          metaColumns={4}
        />
        <PanelTabs items={visible.map((key) => ({ value: key, label: t(`tabs.${key}`), count: counts[key] }))} />

        <TabsContent value="overview">
          <Overview namespace={namespace} release={release} status={s} plan={plan.data} objects={objects.data?.objects} objectsUnreadable={objects.isError} onAllRuns={() => setTab("runs")} onAllEvents={() => setTab("events")} onViewInstances={() => setTab("instances")} />
        </TabsContent>
        <TabsContent value="instances">
          <Instances status={s} onLogs={(pod) => setTab("logs", pod)} />
        </TabsContent>
        <TabsContent value="logs">
          <Logs key={search.get("pod") ?? ""} namespace={namespace} release={release} statusPods={pods} initialPod={search.get("pod") ?? undefined} />
        </TabsContent>
        <TabsContent value="events">
          <Events namespace={namespace} release={release} pods={pods} />
        </TabsContent>
        <TabsContent value="resources">
          <ReleaseObjects namespace={namespace} release={release} />
        </TabsContent>
        <TabsContent value="check">
          <Endpoint namespace={namespace} release={release} status={s} access={false} />
        </TabsContent>
        <TabsContent value="versions">
          <Versions namespace={namespace} release={release} rollbackBlocked={removing ? t("disabled.uninstalling") : readOnly || !plan.data ? t("disabled.readOnly") : false} />
        </TabsContent>
        <TabsContent value="runs">
          <Runs namespace={namespace} release={release} />
        </TabsContent>
        {plan.data && (
          <TabsContent value="plan">
            <SectionCard title={t("plan.title")} summary={t("plan.description")}>
              <Provenance plan={plan.data} />
            </SectionCard>
          </TabsContent>
        )}
      </Tabs>

      <SLOSheet target={sloOpen ? { namespace, release } : null} canEdit={!readOnly && !removing} setup={sloSetup} waiting={blocked === "pending"} onClose={closeSLO} />
      <DeploySheet target={upgrading ? { kind: "upgrade", namespace, release } : null} onClose={() => setUpgrading(false)} />
      <UninstallDialog
        target={uninstalling ? { namespace, release } : null}
        onClose={() => setUninstalling(false)}
        onDone={() => navigate(p(""))}
      />
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto bg-surface-page">
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}
