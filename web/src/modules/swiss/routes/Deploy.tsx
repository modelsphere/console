import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "@swiss/lib/host";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { api, deployApi, type ApplyResult, type ApplyWith, type DiffResult, type Plan } from "@swiss/lib/api";
import { Badge } from "@swiss/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { DeploySettings, EMPTY, imageOf, planRequest, reseed, siteSwitchDefaults, switchDefaults, type Form, type SwitchDefaults } from "@swiss/components/DeploySettings";
import { Pipeline } from "@swiss/components/Pipeline";
import { ErrorState, Loading } from "@swiss/components/States";
import { CatalogBadge, CatalogGate, SchemaBadge, useCatalogChoice, withCatalog } from "@swiss/components/CatalogChoice";
import { chartVersionChoice, Select, TargetRow } from "@swiss/components/ChartVersion";
import { isChartRange } from "@swiss/lib/upgrade";
import { cacheCard } from "@swiss/lib/cache";
import { unlistedProducts, vendorProducts } from "@swiss/lib/gpu";
import { installMethod, llmsvcBlock } from "@swiss/lib/applyWith";
import { InstallMethodChoice } from "@swiss/components/InstallMethod";

export function Deploy() {
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const variantId = params.get("variant") ?? "";
  const version = params.get("version") ?? "";
  // The catalog is chosen before anything is composed: the same model name in
  // two catalogs is two different models.
  const choice = useCatalogChoice();
  const catalog = choice.selected;

  // The variant resolved at the version picked, its current one by default:
  // on v2 a version is the variant's own, on v1 its entry's.
  const model = useQuery({
    queryKey: ["model", catalog, name, variantId, version],
    queryFn: () => api.model(name, { catalog, variant: variantId || undefined, version: version || undefined }),
    enabled: !!catalog,
    // Picking another version keeps the page, and the form, while it resolves.
    placeholderData: keepPreviousData,
  });
  const history = useQuery({
    queryKey: ["history", catalog, name, variantId],
    queryFn: () => api.history(name, { catalog, variant: variantId || undefined }),
    enabled: !!catalog,
    retry: false,
  });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  // The site's defaults, which the form's switches start from. A profile it
  // cannot read leaves the switches at EMPTY's.
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile, retry: false });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes });
  const chartVariant = model.data?.variant;
  const chartRange = !!chartVariant && isChartRange(chartVariant.chart.version);
  const chartVersions = useQuery({
    queryKey: ["chart-versions", catalog, name, version, chartVariant?.id],
    queryFn: () => api.chartVersions(name, { catalog, version: version || undefined, variant: chartVariant?.id }),
    enabled: chartRange,
    retry: false,
  });
  const pickVersion = (v: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("version", v);
      else next.delete("version");
      return next;
    });
    update({});
  };
  const [chartVersion, setChartVersion] = useState("");
  useEffect(() => setChartVersion(""), [catalog, name, version, variantId]);
  const [picked, setPicked] = useState<ApplyWith>();

  const [form, setForm] = useState<Form>({ ...EMPTY, serviceId: name });
  // serviceId is the identity everything else is named after: the helm release,
  // the openresty route, the LLMScaler and the LLMSLORequirement.
  const release = form.serviceId;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [tab, setTab] = useState("plan");

  // The form renders only once the model and profile have loaded, so the first
  // seed lands before any plan; a later one is another variant or version, and
  // the plan composed from the old switches goes with it.
  const loaded = !!model.data && !profile.isPending;
  const siteDefaults = useMemo(() => siteSwitchDefaults(profile.data), [profile.data]);
  const variantValues = model.data?.variant.values;
  const seeded = useRef<SwitchDefaults | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const next = switchDefaults(siteDefaults, variantValues);
    const prev = seeded.current;
    seeded.current = next;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    setForm((f) => reseed(f, prev ?? {}, next));
    if (prev) {
      setPlan(null);
      setDiff(null);
    }
  }, [loaded, siteDefaults, variantValues]);

  // A diff is bound to the plan it was computed from, so touching the form
  // invalidates both, and the pipeline walks back to Plan rather than leaving a
  // pane open over a plan that no longer exists.
  const update = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setPlan(null);
    setDiff(null);
    setApplied(null);
    setTab((t) => (t === "status" ? t : "plan"));
  };

  const planM = useMutation({
    mutationFn: () =>
      deployApi.plan(
        planRequest(form, {
          model: name,
          version,
          variant: variantId,
          catalog,
          chartVersion: chartVersion || undefined,
          forceGpuProducts: unlistedProducts(model.data?.variant.requires.gpuProduct, form.gpuProducts).length > 0,
          cacheUnsupported: !!cache.unsupported,
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

  if (choice.isPending) return <Loading what="catalogs" />;
  if (!catalog) {
    return <CatalogGate catalogs={choice.catalogs} named={choice.named} choose={choice.choose} what={`deploy ${name} from`} />;
  }
  if (model.isPending || cluster.isPending || profile.isPending) return <Loading what="the model" />;
  if (model.error) return <ErrorState what={name} error={model.error} />;

  const { model: m, variant, schema } = model.data;
  const current = m.variants.find((v) => v.id === variant.id)?.version;
  const llm = cluster.data?.llmservice;
  const method = installMethod(picked, llm, schema);
  const chart = chartVersionChoice({
    list: chartVersions,
    value: chartVersion,
    onChange: (v) => {
      setChartVersion(v);
      update({});
    },
  });
  const cache = cacheCard(
    profile.data?.profile,
    variant,
    { name: variant.chart.name, version: chart.resolved ?? variant.chart.version },
  );

  if (!cluster.data?.allowDeploy) {
    return (
      <div className="space-y-4">
        <Back name={name} catalog={catalog} />
        <ReadOnly />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Back name={name} catalog={catalog} />

      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          Deploy {m.displayName ?? m.name}
          <CatalogBadge name={catalog} show={choice.several} />
          <SchemaBadge schema={schema} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Badge variant="outline">{variant.id}</Badge>{" "}
          <Badge variant="muted">v{variant.version}</Badge>{" "}
          {variant.engine} · {variant.requires.gpus} GPU
          {variant.requires.nodes && variant.requires.nodes > 1
            ? ` × ${variant.requires.nodes} nodes`
            : ""}{" "}
          · chart {variant.chart.name}
          {chartRange ? ` ${variant.chart.version}` : `-${variant.chart.version}`}
        </p>
      </div>

      {planM.error && <ErrorState what="the request" error={planM.error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version</CardTitle>
          <p className="text-sm text-muted-foreground">
            The plan records the version and its digest
            {chartRange && `, and the exact ${variant.chart.name} chart installed from the range the catalog allows`}.
            Later upgrades keep both until asked to move.
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          <TargetRow
            label={schema === "v2" ? "Variant version" : "Model version"}
            hint={
              schema === "v2"
                ? "Each variant of a v2 catalog has its own versions."
                : "A v1 version is the model's: every variant of it moves together."
            }
            changing={!!version && version !== current}
            caption={history.error ? `Could not list versions: ${history.error.message}` : undefined}
            tone={history.error ? "destructive" : "muted"}
          >
            <Select
              value={version}
              onChange={pickVersion}
              options={(history.data?.revisions ?? [])
                .filter((r) => r.version !== current)
                .map((r) => ({ value: r.version, label: r.releaseDate ? `${r.version} · ${r.releaseDate}` : r.version }))}
              emptyLabel={current ? `latest (${current})` : "latest"}
            />
          </TargetRow>
          {chartRange && (
            <TargetRow
              label="Chart version"
              hint="Left on the default, the newest version the catalog allows is installed."
              changing={!!chartVersion}
              caption={chart.caption}
              tone={chart.tone}
            >
              {chart.control}
            </TargetRow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Install method</CardTitle>
          <p className="text-sm text-muted-foreground">
            How a new release is stored. It is fixed at install: upgrades and rollbacks stay on it,
            and an existing release keeps its own.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <InstallMethodChoice
            value={method}
            onChange={setPicked}
            blocked={llmsvcBlock(llm, schema)}
            fallback={installMethod(undefined, llm, "v2")}
          />
        </CardContent>
      </Card>

      {/* The settings are the page. Plan, diff and apply are what is done with
          them, so they sit below as tabs rather than holding the form inside
          one of them. */}
      <DeploySettings
        form={form}
        onChange={update}
        cluster={cluster.data}
        serviceIdPlaceholder={name}
        localPathDefault={model.data.localPath}
        localPathPlaceholder={model.data.pathTemplate}
        image={imageOf(variant, model.data.imageRepository)}
        supportedGPUs={variant?.requires.gpuProduct}
        clusterGPUs={vendorProducts(nodes.data?.nodes, variant?.requires.vendor)}
        cache={cache}
      />

      <Pipeline
        namespace={form.namespace || cluster.data.namespace || ""}
        release={release}
        plan={plan}
        diff={diff}
        applied={applied}
        tab={tab}
        onTab={setTab}
        onCompose={() => planM.mutate()}
        composing={planM.isPending}
        composeDisabled={!form.serviceId}
        applyWith={method}
        onDiff={setDiff}
        onApplied={setApplied}
      />
    </div>
  );
}

function ReadOnly() {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <div className="font-medium">This swissd is read-only</div>
          <p className="mt-1 text-muted-foreground">
            Set <code>server.allowDeploy</code> and grant <code>rbac.allowDeploy</code>, then
            restart. Deploying from here does nothing until both are on.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Back({ name, catalog }: { name: string; catalog: string }) {
  return (
    <Link
      to={withCatalog(`/catalog/${encodeURIComponent(name)}`, catalog)}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" /> {name}
    </Link>
  );
}
