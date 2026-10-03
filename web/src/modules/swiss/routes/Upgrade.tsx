import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "@swiss/lib/host";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, TriangleAlert } from "lucide-react";
import {
  api,
  deployApi,
  type ApplyResult,
  type DiffResult,
  type IndexVariant,
  type Node,
  type Plan,
  type Tuning,
} from "@swiss/lib/api";
import { Badge } from "@swiss/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import {
  DeploySettings,
  EMPTY,
  formFromPlan,
  imageOf,
  planRequest,
  type Form,
} from "@swiss/components/DeploySettings";
import { Pipeline } from "@swiss/components/Pipeline";
import { ErrorState, Loading } from "@swiss/components/States";
import { CatalogBadge, releaseCatalog as catalogOfRelease } from "@swiss/components/CatalogChoice";
import { movableCatalogs } from "@swiss/lib/upgrade";
import { chartVersionChoice, Select, TargetRow } from "@swiss/components/ChartVersion";
import { VariantCard } from "@swiss/components/VariantCard";
import { Dialog } from "@swiss/components/ui/dialog";
import { gpuCount } from "@swiss/lib/gpu";
import { Button } from "@swiss/components/ui/button";
import { comparison, formatUplift, reportLink, variantKind, workloadSummary } from "@swiss/lib/catalog";

export function Upgrade() {
  const { namespace = "", release = "" } = useParams();
  // A rollback is an upgrade whose plan is not composed: it comes back out of
  // the cluster exactly as it ran. One page, because the operator's question is
  // the same one either way -- what does this do to the live release -- and two
  // pages would be two chances to answer it differently.
  const [params] = useSearchParams();
  const rollbackTo = Number(params.get("rollback")) || 0;
  const [version, setVersion] = useState("");
  const [variant, setVariant] = useState("");
  // "" stays on the release's own catalog; the server's default for both.
  const [targetCatalog, setTargetCatalog] = useState("");
  const [chartVersion, setChartVersion] = useState("");
  const [picking, setPicking] = useState(false);

  const current = useQuery({
    queryKey: ["release-plan", namespace, release],
    queryFn: () => api.releasePlan(namespace, release),
  });
  // The plan that produced the revision being rolled back to, read from its
  // archive rather than recomposed: going back to what worked must not mean
  // going to whatever the catalog says that version is today. Archives are
  // immutable, so what is read is kept.
  const archived = useQuery({
    queryKey: ["revision-plan", namespace, release, rollbackTo],
    queryFn: () => api.revisionPlan(namespace, release, rollbackTo),
    enabled: rollbackTo > 0,
    staleTime: Infinity,
  });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes });
  const catalogs = cluster.data?.catalogs ?? [];
  const recorded = current.data?.source;
  const releaseCatalog = recorded ? catalogOfRelease(catalogs, recorded) : undefined;
  const catalogName = targetCatalog || releaseCatalog;
  const moving = !!targetCatalog && targetCatalog !== releaseCatalog;
  const indexes = useQueries({
    queries: catalogs.map((c) => ({
      queryKey: ["catalog", c.name],
      queryFn: () => api.catalog(c.name),
      enabled: !rollbackTo,
    })),
  });
  const modelIn = (name?: string) =>
    indexes[catalogs.findIndex((c) => c.name === name)]?.data?.index.models.find(
      (m) => m.name === recorded?.model,
    );
  const { hf, movable } = movableCatalogs(catalogs, recorded ?? {}, releaseCatalog, (c) => modelIn(c)?.source.hf);
  // For the model path default, which is the site's template resolved against
  // this model's hf -- the same value the deploy page shows.
  const entry = useQuery({
    queryKey: ["model", catalogName, current.data?.source.model ?? "", version],
    queryFn: () => api.model(current.data!.source.model, version || undefined, catalogName),
    enabled: !!current.data && !!catalogName,
  });
  const model = modelIn(catalogName);
  const versions = model?.versions.map((v) => v.version) ?? [];
  const variants = model?.versions.find((v) => v.version === (version || model.latest))?.variants ?? [];
  const keptVariant = variant || recorded?.variant || "";
  const variantMissing = !!model && !variants.some((v) => v.id === keptVariant);
  const chartVersions = useQuery({
    queryKey: ["chart-versions", catalogName, recorded?.model, version, keptVariant],
    queryFn: () =>
      api.chartVersions(recorded!.model, { catalog: catalogName, version: version || undefined, variant: keptVariant }),
    enabled: !!recorded && !!catalogName && !variantMissing && !rollbackTo,
    // A registry that refuses is not going to change its mind in a second.
    retry: false,
  });

  const [form, setForm] = useState<Form>(EMPTY);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [tab, setTab] = useState("plan");

  // Seed the form from what the release was deployed with, once -- or, on a
  // rollback, from the revision being restored, which is what would come back.
  // An upgrade whose form starts empty would silently propose dropping every
  // setting.
  useEffect(() => {
    const from = rollbackTo ? archived.data : current.data;
    if (from) setForm(formFromPlan(from));
  }, [current.data, archived.data, rollbackTo]);

  const reset = () => {
    setPlan(null);
    setDiff(null);
    setApplied(null);
    setTab((t) => (t === "status" ? t : "plan"));
  };
  const update = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    reset();
  };

  const planM = useMutation({
    mutationFn: () =>
      deployApi.plan(
        planRequest(form, {
          model: current.data!.source.model,
          version: version || undefined,
          variant: variant || undefined,
          catalog: moving ? targetCatalog : undefined,
          chartVersion: chartVersion || undefined,
          // The server carries forward anything the form does not cover, so a
          // value set once from a flag survives the upgrade instead of being
          // dropped by a form that never knew about it.
          fromRelease: release,
        }),
      ),
    // The previous plan is superseded the moment a recompose starts. Dropping
    // it here rather than on the way back means a failed compose leaves
    // nothing to act on, instead of a stale plan the error message sits behind.
    onMutate: () => {
      setPlan(null);
      setDiff(null);
    },
    onSuccess: (p) => {
      setPlan(p);
      setDiff(null);
    },
  });

  if (current.isPending) return <Loading what={release} />;
  if (current.error) return <ErrorState what={`the plan for ${release}`} error={current.error} />;
  if (rollbackTo > 0) {
    if (archived.isPending) return <Loading what={`revision ${rollbackTo}`} />;
    if (archived.error) {
      return <ErrorState what={`the plan for revision ${rollbackTo}`} error={archived.error} />;
    }
  }

  const cur = current.data;
  const targetVersion = version || model?.latest;
  const site = indexes[catalogs.findIndex((c) => c.name === catalogName)]?.data?.index.site;
  const optimized = targetVersion ? comparison(variants, targetVersion, model?.tuning) : null;
  const report = optimized && model ? reportLink(site, model.name, optimized.report) : undefined;
  const keptInfo = variants.find((v) => v.id === keptVariant);
  const pickVariant = (id: string) => {
    setVariant(id === cur.source.variant ? "" : id);
    setChartVersion("");
    setPicking(false);
    reset();
  };
  const chart = chartVersionChoice({
    running: cur.chart,
    list: chartVersions,
    value: chartVersion,
    onChange: (v) => {
      setChartVersion(v);
      reset();
    },
  });
  // What the pipeline acts on: a composed plan on an upgrade, the archive on a
  // rollback. Nothing else about the page differs.
  const target = rollbackTo ? (archived.data ?? null) : plan;

  if (!cluster.data?.allowDeploy) {
    return (
      <div className="space-y-4">
        <Back namespace={namespace} />
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>This swissd is read-only; upgrades and rollbacks are disabled.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Back namespace={namespace} />

      <div>
        <h1 className="text-xl font-semibold">
          {rollbackTo ? `Roll back ${release} to revision ${rollbackTo}` : `Upgrade ${release}`}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Badge variant="outline">{namespace}</Badge>
          <CatalogBadge name={releaseCatalog ?? ""} show={catalogs.length > 1} /> {cur.source.model}
          {cur.source.version && ` v${cur.source.version}`} · {cur.source.variant} · chart{" "}
          {cur.chart.name}-{cur.chart.version}
        </p>
        {rollbackTo > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            That is what is deployed now. Everything below is revision {rollbackTo}, as it ran
            — a rollback re-applies it forward as a new revision.
          </p>
        )}
      </div>

      {planM.error && <ErrorState what="the request" error={planM.error} />}

      {!rollbackTo && cluster.data && !releaseCatalog && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <div className="font-medium">This release's catalog is not configured</div>
              {recorded?.catalogName ? (
                <p className="mt-1 text-muted-foreground">
                  It was deployed from catalog <code>{recorded.catalogName}</code>, which this site no
                  longer lists. Add it back to the site profile, or upgrade from another catalog with
                  the same model below. Rollbacks still work.
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Its plan names no catalog this site lists
                  {recorded?.catalog && (
                    <>
                      {" "}
                      (it records <code className="break-all">{recorded.catalog}</code>)
                    </>
                  )}
                  , and there is no default to stand in. Mark one catalog default in the site profile,
                  or upgrade from another catalog with the same model below. Rollbacks still work.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!rollbackTo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upgrade target</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every row starts on what is deployed. Engine flags, probes and the image follow the
              model version and variant.
            </p>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {(catalogs.length > 1 || !releaseCatalog) && (
              <TargetRow
                label="Catalog"
                hint="Another catalog is offered only when its model has the same HF repo: the same model id elsewhere may be different weights."
                from={releaseCatalog ?? recorded?.catalogName ?? "unlisted"}
                changing={moving}
                caption={catalogCaption(hf, movable)}
              >
                <Select
                  value={targetCatalog}
                  onChange={(v) => {
                    setTargetCatalog(v);
                    setVersion("");
                    setVariant("");
                    setChartVersion("");
                    reset();
                  }}
                  options={movable}
                  emptyLabel={releaseCatalog ? `keep ${releaseCatalog}` : "choose a catalog"}
                  disabled={movable.length === 0}
                />
              </TargetRow>
            )}
            <TargetRow
              label="Model version"
              from={cur.source.version ?? "unpinned"}
              changing={!!targetVersion && targetVersion !== cur.source.version}
            >
              <Select
                value={version}
                onChange={(v) => {
                  setVersion(v);
                  setChartVersion("");
                  reset();
                }}
                options={versions}
                emptyLabel={model?.latest ? `latest (${model.latest})` : "latest"}
              />
            </TargetRow>
            <TargetRow
              label="Variant"
              hint="Parallelism and hardware. Moving to another catalog keeps the engine, so variants on another one are disabled."
              from={cur.source.variant}
              changing={!!variant && variant !== cur.source.variant}
              caption={variantMissing ? `${catalogName} has no ${keptVariant} in this version: choose another.` : undefined}
              tone="warning"
            >
              <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                <span className="truncate font-mono">{keptVariant}</span>
                {keptInfo && (
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {keptInfo.engine} · {gpuCount(keptInfo.requires)}
                  </span>
                )}
                {!variant && <Badge variant="muted">kept</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7"
                  disabled={variants.length === 0}
                  onClick={() => setPicking(true)}
                >
                  Change…
                </Button>
              </div>
            </TargetRow>
            <TargetRow
              label="Chart version"
              hint="Left on keep, the running chart stays while the catalog allows it; otherwise the newest it allows is taken."
              from={cur.chart.version}
              changing={!!chart.resolved && chart.resolved !== cur.chart.version}
              caption={chart.caption}
              tone={chart.tone}
            >
              {chart.control}
            </TargetRow>
          </CardContent>
        </Card>
      )}

      {!rollbackTo && (
        <Dialog
          open={picking}
          onClose={() => setPicking(false)}
          title="Choose a variant"
          subtitle={
            <>
              {cur.source.model}
              {targetVersion && ` v${targetVersion}`}
              {catalogs.length > 1 && catalogName && ` · ${catalogName}`}
              {moving && ` · a catalog move keeps ${cur.engine}`}
            </>
          }
          footer={
            variant && (
              <Button variant="outline" size="sm" onClick={() => pickVariant(cur.source.variant)}>
                Keep {cur.source.variant}
              </Button>
            )
          }
        >
          <VariantChoices
            variants={variants}
            current={cur}
            moving={moving}
            selected={keptVariant}
            onPick={pickVariant}
            tuning={model?.tuning}
            version={targetVersion}
            report={report}
            nodes={nodes.data?.nodes}
          />
        </Dialog>
      )}

      {/* The same form as the deploy page, seeded from the release. Editing it
          here means the upgrade moves the catalog and the settings together,
          which is two changes in one diff -- so the diff is the thing that has
          to be read, and the pipeline below is the same one.

          On a rollback it is the same form with nothing editable: the archived
          plan is re-applied as it ran, so a field that could be typed into
          would promise a change the rollback would not make. */}
      <DeploySettings
        form={form}
        onChange={update}
        cluster={cluster.data}
        supportedGPUs={variants.find((v) => v.id === (variant || cur.source.variant))?.requires.gpuProduct}
        clusterGPUs={nodes.data?.nodes.map((n) => n.GPUProduct)}
        localPathDefault={entry.data?.localPath}
        localPathPlaceholder={entry.data?.pathTemplate}
        image={imageOf(
          entry.data?.entry.variants.find((v) => v.id === (variant || cur.source.variant)),
          entry.data?.imageRepository,
        )}
        lockIdentity
        readOnly={rollbackTo > 0}
      />

      <Pipeline
        namespace={namespace}
        release={release}
        plan={target}
        rollbackTo={rollbackTo || undefined}
        diff={diff}
        applied={applied}
        tab={tab}
        onTab={setTab}
        onCompose={() => planM.mutate()}
        composing={planM.isPending}
        composeLabel={planM.isPending ? "Composing…" : plan ? "Recompose upgrade" : "Compose upgrade"}
        onDiff={setDiff}
        onApplied={setApplied}
      >
        {target && (
          <WhatMoves
            current={cur}
            currentCatalog={cur.source.catalogName ?? releaseCatalog}
            proposed={target}
            rollback={rollbackTo > 0}
          />
        )}
      </Pipeline>
    </div>
  );
}

// The cards the model page shows, as an upgrade's choice: the deployed one
// tagged, the chosen one ringed, and on a catalog move the variants on another
// engine dimmed, since swissd refuses them.
export function VariantChoices({
  variants,
  current,
  moving,
  selected,
  onPick,
  tuning,
  version,
  report,
  nodes,
}: {
  variants: IndexVariant[];
  current: Plan;
  moving: boolean;
  selected: string;
  onPick: (id: string) => void;
  tuning?: Tuning[];
  version?: string;
  report?: string;
  nodes?: Node[];
}) {
  const cmp = version ? comparison(variants, version, tuning) : null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {variants.map((v) => {
        const otherEngine = moving && v.engine !== current.engine;
        const optimized = cmp?.optimized === v.id;
        return (
          <VariantCard
            key={v.id}
            v={v}
            kind={variantKind(v, tuning)}
            uplift={
              optimized && cmp.uplift != null
                ? formatUplift(cmp.uplift) + (cmp.version !== version ? ` on v${cmp.version}` : "")
                : undefined
            }
            upliftTitle={optimized && cmp.workloads.length ? workloadSummary(cmp) : undefined}
            report={optimized ? report : undefined}
            workloads={optimized && cmp.workloads.length ? cmp.workloads : undefined}
            nodes={nodes}
            tags={!moving && v.id === current.source.variant && <Badge variant="outline">deployed</Badge>}
            selected={v.id === selected}
            disabled={otherEngine ? `Runs on ${v.engine}; a catalog move keeps ${current.engine}` : undefined}
            action={
              v.id === selected ? (
                <Badge variant="success">Selected</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={otherEngine} onClick={() => onPick(v.id)}>
                  Select
                </Button>
              )
            }
          />
        );
      })}
    </div>
  );
}

// WhatMoves names the catalog change before anything else on the Plan tab. The
// settings above are editable now, so this is also where an operator sees that
// an upgrade they meant as a version bump is carrying a form change with it.
//
// A rollback reads the same table in the other direction: from what is running
// to what is coming back.
function WhatMoves({
  current,
  currentCatalog,
  proposed,
  rollback,
}: {
  current: Plan;
  currentCatalog?: string;
  proposed: Plan;
  rollback?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {rollback ? "What comes back" : "What moves"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Change label="Catalog" from={currentCatalog} to={proposed.source.catalogName ?? currentCatalog} />
        <Change label="Model version" from={current.source.version} to={proposed.source.version} />
        <Change
          label="Chart"
          from={`${current.chart.name}-${current.chart.version}`}
          to={`${proposed.chart.name}-${proposed.chart.version}`}
        />
        <Change
          label="Entry digest"
          from={current.source.digest?.slice(7, 19)}
          to={proposed.source.digest?.slice(7, 19)}
        />
        <Change label="Variant" from={current.source.variant} to={proposed.source.variant} />
        {current.hash === proposed.hash && (
          <p className="pt-1 text-sm text-muted-foreground">
            Identical to what is deployed — {rollback ? "this revision is what is running." : "nothing to upgrade."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Change({ label, from, to }: { label: string; from?: string; to?: string }) {
  const same = from === to;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono">{from || "—"}</span>
      {!same && (
        <>
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <span className="font-mono font-medium text-success">{to || "—"}</span>
        </>
      )}
      {same && <Badge variant="muted">unchanged</Badge>}
    </div>
  );
}

function catalogCaption(hf: string | undefined, movable: string[]) {
  if (!hf) return "Its model's HF repo is unknown, so no other catalog can be offered.";
  if (movable.length === 0) return `No other catalog has ${hf}.`;
  return undefined;
}

function Back({ namespace }: { namespace: string }) {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" /> Deployments in {namespace}
    </Link>
  );
}
