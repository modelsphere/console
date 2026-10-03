import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Badge, Button, Card, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@modelsphere/ui";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api } from "@swiss/lib/api";
import { useReleaseObjects } from "@swiss/components/ReleaseObjects";
import { ReleaseObjects } from "@swiss/components/ReleaseObjects";
import { Endpoint } from "@swiss/components/Endpoint";
import { SLOCard } from "@swiss/components/SLOCard";
import { Provenance } from "@swiss/components/Provenance";
import { useT } from "@/modules/inferences/i18n";
import { modelLine, parseTab, releaseState, showSLO, swissLinks, visibleTabs, type Tab } from "@/modules/inferences/lib";
import { StatusDot } from "@/modules/inferences/components/StatusDot";
import { Section } from "@/modules/inferences/components/Section";
import { InSwiss, swissBase } from "@/modules/inferences/components/SwissScope";
import { UninstallDialog } from "@/modules/inferences/components/UninstallDialog";
import { Overview } from "@/modules/inferences/tabs/Overview";
import { Instances } from "@/modules/inferences/tabs/Instances";
import { Versions } from "@/modules/inferences/tabs/Versions";
import { Runs } from "@/modules/inferences/tabs/Runs";

// One release: a header card with what it is and what can be done to it, then
// one tab per concern instead of every panel stacked down the page.
export function InferenceDetail() {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const { release = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const namespace = search.get("namespace") ?? "";
  const swiss = swissLinks(swissBase);
  const [uninstalling, setUninstalling] = useState(false);

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
  const visible = visibleTabs({ slo: !!s && showSLO(s, plan.data), plan: !!plan.data });
  const tab = parseTab(search.get("tab"), visible);
  const setTab = (next: Tab) =>
    setSearch(
      (q) => {
        if (next === "overview") q.delete("tab");
        else q.set("tab", next);
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
  const source = plan.data?.source;
  const model = modelLine(source ?? {}) || s.model;
  const counts: Partial<Record<Tab, number>> = { instances: s.pods.length, versions: revisions.data?.revisions.length };

  return (
    <Page>
      <Card className="gap-0 border-l-[3px] border-l-primary/70 py-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-4">
          <div className="min-w-0 space-y-3">
            {back}
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-lg font-semibold">{release}</h1>
              <StatusDot state={releaseState(s)} suffix={s.total > 0 ? `${s.ready}/${s.total}` : undefined} />
              {!plan.data && plan.isError && <Badge variant="warning">{t("detail.untracked")}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTab("check")}>
              {t("actions.check")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || !plan.data}
              title={readOnly ? t("disabled.readOnly") : !plan.data ? t("disabled.untracked") : undefined}
              onClick={() => navigate(swiss.upgrade(namespace, release))}
            >
              {t("actions.upgrade")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive enabled:hover:text-destructive"
              disabled={readOnly || !s.exists}
              title={readOnly ? t("disabled.readOnly") : undefined}
              onClick={() => setUninstalling(true)}
            >
              {t("actions.uninstall")}
            </Button>
          </div>
        </div>
        <dl className="mx-6 mt-4 grid grid-cols-2 gap-4 border-t py-4 md:grid-cols-4">
          <HeaderField label={t("detail.fields.namespace")} value={namespace} />
          <HeaderField label={t("detail.fields.model")} value={model} />
          <HeaderField label={t("detail.fields.chart")} value={plan.data ? `${plan.data.chart.name}-${plan.data.chart.version}` : undefined} />
          <HeaderField label={t("detail.fields.instances")} value={`${s.ready}/${s.total}`} />
        </dl>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <TabsList variant="line" className="h-9 border-b w-full justify-start rounded-none">
          {visible.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-none px-3">
              {t(`tabs.${key}`)}
              {counts[key] !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{counts[key]}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <Overview namespace={namespace} release={release} status={s} plan={plan.data} objects={objects.data?.objects} objectsUnreadable={objects.isError} onAllRuns={() => setTab("runs")} />
        </TabsContent>
        <TabsContent value="instances">
          <Instances status={s} />
        </TabsContent>
        <TabsContent value="resources">
          <InSwiss>
            <ReleaseObjects namespace={namespace} release={release} />
          </InSwiss>
        </TabsContent>
        <TabsContent value="check">
          <InSwiss>
            <Endpoint namespace={namespace} release={release} status={s} access={false} />
          </InSwiss>
        </TabsContent>
        {visible.includes("slo") && (
          <TabsContent value="slo">
            <InSwiss>
              <SLOCard namespace={namespace} release={release} canEdit={!readOnly} />
            </InSwiss>
          </TabsContent>
        )}
        <TabsContent value="versions">
          <Versions namespace={namespace} release={release} canRollBack={!readOnly && !!plan.data} />
        </TabsContent>
        <TabsContent value="runs">
          <Runs namespace={namespace} release={release} />
        </TabsContent>
        {plan.data && (
          <TabsContent value="plan">
            <Section title={t("plan.title")} hint={t("plan.description")}>
              <InSwiss>
                <Provenance plan={plan.data} />
              </InSwiss>
            </Section>
          </TabsContent>
        )}
      </Tabs>

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
    <div className="h-full overflow-auto">
      <div className="space-y-4 p-4">{children}</div>
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm" title={value}>
        {value || "-"}
      </dd>
    </div>
  );
}
