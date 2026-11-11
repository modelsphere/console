import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  FloatingField,
  SectionCard,
  Sheet,
  SheetBody,
  SheetCancelButton,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
  Switch,
  cn,
  useAnchorNav,
  useDirty,
} from "@modelsphere/ui";
import { ArrowRight, FlaskConical, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, deployApi, type ApplyResult, type ApplyWith, type CatalogModel, type DiffResult, type Plan } from "@swiss/lib/api";
import { applyFlags, imageOf, reseed, siteSwitchDefaults, switchDefaults, type Form, type SwitchDefaults } from "@swiss/components/DeploySettings";
import { EMPTY, formFromPlan, planRequest } from "../deployment-settings";
import { releaseCatalog } from "@swiss/components/CatalogChoice";
import { Provenance } from "@swiss/components/Provenance";
import { DiffView } from "@swiss/components/DiffView";
import { deployCapacity, gpuShort, pickableProducts, productChoices, unlistedProducts, vendorResources } from "@swiss/lib/gpu";
import { isChartRange, movableCatalogs } from "@swiss/lib/upgrade";
import { CHECK_MS, inputRows, inputsAnswered, siteSaves, type SiteSave } from "@swiss/lib/inputs";
import { affinityInvalid } from "@swiss/lib/affinity";
import { saveSiteAnswers } from "@swiss/lib/siteAnswers";
import { messageOf, useToast } from "@swiss/components/ui/toast";
import { useDebounced } from "@swiss/lib/useDebounced";
import { cacheCard } from "@swiss/lib/cache";
import { installMethod, llmsvcBlock } from "@swiss/lib/applyWith";
import { useT } from "@/modules/inferences/i18n";
import { detailPath, sloEnabled } from "@/modules/inferences/lib";
import { SECTIONS, chartChoice, defaultServiceId, pipelineState, serviceIdError, whatMoves, type Section } from "@/modules/inferences/deploy-lib";
import { DeployForm } from "@/modules/inferences/components/DeployForm";
import type { HelmValuesSource } from "@/modules/inferences/components/OverrideYaml";
import { ExperimentalBadge } from "@/modules/inferences/components/InstallMethodLabel";
import { AdaptivePlanChangedError, composeAdaptivePlan, composeReferencedPlan, isAdaptiveOption, withAdaptiveConcurrency } from "../adaptive-concurrency";
import { composeRecoveryPlan, composeRecoveryValuesRequest, RecoveryPlanChangedError } from "../recovery-compose";
import { RecoveryFields } from "./RecoveryFields";
import { mergeValues, planValues, recoveryError, recoveryInputError, recoverySettings, withRecovery } from "../recovery";
import { serviceRelationship } from "../service-relationship";
import { assertProductionBinding, ProductionBindingChangedError } from "../production-binding";
import { readRouteOptions } from "@/modules/inferences/api";

export type DeployTarget =
  | { kind: "deploy"; model: string; catalog: string; version?: string; variant?: string }
  | { kind: "upgrade"; namespace: string; release: string };

const KEEP = "__keep";
const ID_PREFIX = "deploy-sec-";
const OPEN: Record<Section, boolean> = { basic: true, resources: true, routing: false, advanced: false };
const REFRESH = [["status"], ["revisions"], ["releasePlan"], ["release-plan"], ["runs"], ["deployments"], ["objects"]];

export function DeploySheet({ target, onClose }: { target: DeployTarget | null; onClose: () => void }) {
  return target ? <DeploySheetBody key={JSON.stringify(target)} target={target} onClose={onClose} /> : null;
}

function DeploySheetBody({ target, onClose }: { target: DeployTarget; onClose: () => void }) {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const upgrade = target.kind === "upgrade";

  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, retry: false });
  // A fresh deploy's switches start from the site's defaults; a profile it
  // cannot read leaves them at EMPTY's. An upgrade starts from its own plan.
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile, retry: false });
  const current = useQuery({
    queryKey: ["releasePlan", upgrade ? target.namespace : "", upgrade ? target.release : ""],
    queryFn: () => api.releasePlan((target as { namespace: string }).namespace, (target as { release: string }).release),
    enabled: upgrade,
    retry: false,
  });
  const catalogs = cluster.data?.catalogs ?? [];
  const recorded = current.data?.source;
  const ownCatalog = upgrade ? (recorded ? releaseCatalog(catalogs, recorded) : undefined) : target.catalog;
  const modelName = upgrade ? recorded?.model : target.model;

  const [version, setVersion] = useState(upgrade ? "" : (target.version ?? ""));
  const [variant, setVariant] = useState(upgrade ? "" : (target.variant ?? ""));
  const [moveTo, setMoveTo] = useState("");
  const [chartVersion, setChartVersion] = useState("");
  const [picked, setPicked] = useState<ApplyWith>();
  const catalogName = moveTo || ownCatalog;

  const indexes = useQueries({
    queries: catalogs.map((c) => ({ queryKey: ["catalog", c.name], queryFn: () => api.catalog(c.name), enabled: upgrade || c.name === ownCatalog })),
  });
  const modelIn = (name?: string): CatalogModel | undefined =>
    indexes[catalogs.findIndex((c) => c.name === name)]?.data?.models.find((m) => m.name === modelName);
  const { movable } = upgrade ? movableCatalogs(catalogs, recorded ?? {}, ownCatalog, (c) => modelIn(c)?.source.hf) : { movable: [] as string[] };
  const im = modelIn(catalogName);
  // The variants as listed now; a version is the chosen variant's, from its
  // history: on v2 versions are per variant, on v1 the model's.
  const listed = im?.variants ?? [];
  const keptVariant = variant || (upgrade ? recorded?.variant : im?.defaultVariant ?? listed[0]?.id) || "";
  const latest = listed.find((x) => x.id === keptVariant)?.version;
  const history = useQuery({
    queryKey: ["history", catalogName, modelName, keptVariant],
    queryFn: () => api.history(modelName!, { catalog: catalogName, variant: keptVariant }),
    enabled: !!modelName && !!catalogName && !!latest,
    retry: false,
  });
  const versions = history.data?.revisions.map((r) => r.version) ?? (latest ? [latest] : []);

  const entry = useQuery({
    queryKey: ["model", catalogName, modelName, keptVariant, version],
    queryFn: () => api.model(modelName!, { catalog: catalogName, variant: keptVariant || undefined, version: version || undefined }),
    enabled: !!modelName && !!catalogName,
  });
  const v = entry.data?.variant;
  const chartRange = !!v && isChartRange(v.chart.version);
  const chartList = useQuery({
    queryKey: ["chart-versions", catalogName, modelName, version, keptVariant],
    queryFn: () => api.chartVersions(modelName!, { catalog: catalogName, version: version || undefined, variant: keptVariant }),
    enabled: !!modelName && !!catalogName && chartRange,
    retry: false,
  });
  const chart = chartChoice(chartList, chartVersion, upgrade ? current.data?.chart : undefined);
  const running = upgrade ? current.data?.chart : undefined;
  const cache = cacheCard(
    profile.data?.profile,
    v,
    { name: v?.chart.name ?? running?.name, version: chart.resolved ?? v?.chart.version ?? running?.version },
  );
  const llm = cluster.data?.llmservice;
  const block = llmsvcBlock(llm, entry.data?.schema);
  const method = installMethod(picked, llm, entry.data?.schema);

  // Seeded once. A later read of the plan (window focus, swissd's PD autoscaler) or a new target
  // object from a polling parent must not reset what is being typed.
  const [seedPlan, setSeedPlan] = useState<Plan>();
  if (current.data && !seedPlan) setSeedPlan(current.data);
  const deployModel = upgrade ? "" : target.model;
  const initial = useMemo<Form>(() => (upgrade ? (seedPlan ? formFromPlan(seedPlan) : EMPTY) : { ...EMPTY, serviceId: defaultServiceId(deployModel) }), [upgrade, seedPlan, deployModel]);
  const initialRecovery = useMemo(() => recoverySettings(
    upgrade && seedPlan ? planValues(seedPlan) : mergeValues(entry.data?.variant.values, profile.data?.profile?.extra),
  ), [upgrade, seedPlan, entry.data?.variant.values, profile.data?.profile?.extra]);
  const [recoveryPatch, setRecoveryPatch] = useState<Partial<ReturnType<typeof recoverySettings>>>({});
  const recovery = { ...initialRecovery, ...recoveryPatch };
  const [form, setForm] = useState<Form>(initial);
  const checkedInputs = useDebounced(form.inputs, CHECK_MS);
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const catalogRoute = upgrade && current.data ? initial.route || initial.serviceId || target.release : undefined;
  const routeOptions = useQuery({
    queryKey: ["route-options", catalogRoute ?? ""],
    queryFn: ({ signal }) => readRouteOptions(catalogRoute, signal),
    enabled: !upgrade || !!current.data,
    staleTime: 30_000,
    retry: false,
  });
  useEffect(() => setForm(initial), [initial]);
  const [seed, setSeed] = useState<SwitchDefaults | null>(null);
  const dirty = useDirty({ form, version, variant, moveTo, chartVersion, recovery }, { form: seed ? reseed(initial, {}, seed) : initial, version: upgrade ? "" : (target.version ?? ""), variant: upgrade ? "" : (target.variant ?? ""), moveTo: "", chartVersion: "", recovery: initialRecovery });

  const [step, setStep] = useState<"form" | "review">("form");
  const [submitted, setSubmitted] = useState(false);
  const [expanded, setExpanded] = useState(OPEN);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [note, setNote] = useState("");
  const [force, setForce] = useState(false);
  const nav = useAnchorNav({ ids: [...SECTIONS], idPrefix: ID_PREFIX, enabled: step === "form", onExpand: (id) => setExpanded((e) => ({ ...e, [id]: true })) });

  // The form shows only once the entry and profile have loaded, so the first
  // seed lands before any plan; a later one is another variant or version, and
  // a plan composed from the old switches goes with it.
  const seedReady = !upgrade && !!entry.data && !profile.isPending;
  const siteDefaults = useMemo(() => siteSwitchDefaults(profile.data), [profile.data]);
  const variantValues = entry.data?.variant.values;
  useEffect(() => {
    if (!seedReady) return;
    const next = switchDefaults(siteDefaults, variantValues);
    if (seed && JSON.stringify(seed) === JSON.stringify(next)) return;
    setForm((f) => reseed(f, seed ?? {}, next));
    setSeed(next);
    if (seed) {
      setPlan(null);
      setDiff(null);
      setStep("form");
    }
  }, [seedReady, siteDefaults, variantValues, seed]);

  const release = upgrade ? target.release : form.serviceId || defaultServiceId(target.model);
  const namespace = upgrade ? target.namespace : form.namespace || cluster.data?.namespace || "";
  const live = useQuery({ queryKey: ["status", namespace, release], queryFn: () => api.status(namespace, release), enabled: (upgrade || step === "review") && !!release && !!namespace });

  // A product the variant does not list is one swissd takes only as forced.
  const forceGpuProducts = unlistedProducts(v?.requires.gpuProduct, form.gpuProducts).length > 0;
  const productionReferenced = upgrade && serviceRelationship(live.data ?? {}).productionReferenced;
  const adaptiveOnly = upgrade && serviceRelationship(live.data ?? {}).adaptiveOnly;
  const assignmentBlocked = serviceRelationship(live.data ?? {}).owned || serviceRelationship(live.data ?? {}).assignmentLocked && !adaptiveOnly;
  const change = (patch: Partial<Form>) => setForm((f) => adaptiveOnly ? {
    ...f,
    adaptiveCc: patch.adaptiveCc ?? f.adaptiveCc,
    adaptiveCcMinFrac: patch.adaptiveCcMinFrac ?? f.adaptiveCcMinFrac,
    nginxExtras: patch.nginxExtras ? [...f.nginxExtras.filter(row => !isAdaptiveOption(row.key, routeOptions.data)), ...patch.nginxExtras.filter(row => row.key.startsWith("adaptive_cc_"))] : f.nginxExtras,
  } : { ...f, ...patch });
  const inputs = inputRows(v?.inputs, profile.data?.profile, entry.data?.model.source?.hf ?? "", modelName ?? "", v?.values, upgrade ? current.data?.layers?.form : undefined);
  // A profile swissd did not parse is not written to from here.
  const canRemember = !adaptiveOnly && profile.data?.yaml !== undefined && !profile.data.error && !!cluster.data?.allowDeploy;
  const saves = canRemember ? siteSaves(inputs, form.inputs, remember) : [];
  // What a compose of f sends; the Override YAML editor's preview sends the same.
  const requestFor = (f: Form) => planRequest(
    { ...f, serviceId: f.serviceId || (upgrade ? f.serviceId : defaultServiceId(target.model)) },
    upgrade
      ? { model: recorded!.model, version: version || undefined, variant: variant || undefined, catalog: moveTo || undefined, chartVersion: chartVersion || undefined, fromRelease: target.release, cacheUnsupported: !!cache.unsupported, forceGpuProducts, inputs: v?.inputs, formLayer: seedPlan?.layers?.form }
      : { model: target.model, version, variant: keptVariant, catalog: target.catalog, chartVersion: chartVersion || undefined, cacheUnsupported: !!cache.unsupported, forceGpuProducts, inputs: v?.inputs },
    profile.data?.profile,
  );
  // The chart's values and swissd's layers for this form, without the
  // overrides, which the editor merges itself. Cached per request while the
  // sheet is open, so saving the overrides and editing them again does not
  // read the chart again.
  const compositionError = (error: unknown) => {
    if (error instanceof ProductionBindingChangedError) return new Error(t("deploy.fields.productionBindingLocked"));
    if (error instanceof RecoveryPlanChangedError) return new Error(t("deploy.recovery.errors.changedPlan"));
    if (error instanceof AdaptivePlanChangedError) return new Error(t("deploy.fields.adaptiveChanged"));
    return error;
  };
  const valuesForm = { ...form, edits: "" };
  const valuesRequest = adaptiveOnly || (upgrade && !recorded) ? undefined : withAdaptiveConcurrency(withRecovery(requestFor(valuesForm), recovery), valuesForm, routeOptions.data);
  const helmValues = useQuery({
    queryKey: ["helmValues", JSON.stringify(valuesRequest ?? null)],
    queryFn: async () => {
      try {
        const request = await composeRecoveryValuesRequest(requestFor(valuesForm), recovery, (next) => composeAdaptivePlan(next, valuesForm, routeOptions.data, deployApi.plan, catalogName), catalogName);
        return await deployApi.helmValues(request);
      } catch (error) {
        throw compositionError(error);
      }
    },
    enabled: false,
    staleTime: Infinity,
    // Dropped when the sheet closes: they last one install or upgrade.
    gcTime: 0,
    retry: false,
  });
  const valuesSource: HelmValuesSource = {
    data: helmValues.data,
    loading: helmValues.isFetching,
    error: helmValues.error,
    load: async () => (valuesRequest ? (await helmValues.refetch()).data : undefined),
  };
  const compose = useMutation({
    mutationFn: async () => {
      try {
        if (adaptiveOnly) {
          if (!current.data) throw new AdaptivePlanChangedError();
          return await composeReferencedPlan(current.data, form, routeOptions.data, deployApi.plan);
        }
        const inputError = recoveryInputError(recovery);
        if (inputError) throw new Error(t(`deploy.recovery.errors.${inputError}`));
        const proposed = await composeRecoveryPlan(requestFor(form), recovery, (request) => composeAdaptivePlan(request, form, routeOptions.data, deployApi.plan, catalogName), catalogName);
        const invalid = recoveryError(proposed, recovery);
        if (invalid) throw new Error(t(`deploy.recovery.errors.${invalid}`));
        if (productionReferenced) {
          if (!current.data) throw new ProductionBindingChangedError();
          assertProductionBinding(current.data, proposed);
        }
        return proposed;
      } catch (error) {
        throw compositionError(error);
      }
    },
    onSuccess: (pl) => {
      setPlan(pl);
      setDiff(null);
      setStep("review");
      dryRun.mutate(pl);
    },
  });
  // The form is fixed while a plan is on screen, so its flags are the ones
  // the plan was composed beside.
  const flags = applyFlags(form);
  const dryRun = useMutation({ mutationFn: (pl: Plan) => deployApi.diff({ planHash: pl.hash, applyFlags: flags }), onSuccess: setDiff });
  const state = pipelineState({ diff, exists: live.data?.exists, applied: !!applied });
  const apply = useMutation({
    mutationFn: () => (state.action === "install" ?
      deployApi.install(plan!.hash, note.trim(), method, flags) :
      deployApi.apply(plan!.hash, diff?.revision, note.trim(), force ? { ...flags, forceConflicts: true } : flags)
    ),
    onSuccess: (r) => {
      setApplied(r);
      for (const key of REFRESH) qc.invalidateQueries({ queryKey: key });
      // After the deploy, not before: one abandoned at review leaves the profile as it was.
      if (saves.length)
        saveSiteAnswers(saves).then(
          (saved) => {
            qc.setQueryData(["profile"], saved);
            toast.success(t("deploy.review.siteSaved", { keys: saves.map((s) => s.key).join(", ") }));
          },
          (e) => toast.error(t("deploy.review.siteNotSaved", { error: messageOf(e) })),
        );
      onClose();
      if (!upgrade) navigate(p(detailPath(plan!.release.name, plan!.release.namespace)), { state: { sloSetup: state.action === "install" && sloEnabled(plan!) } });
    },
  });

  const submit = () => {
    setSubmitted(true);
    apply.reset();
    if (!upgrade && serviceIdError(form.serviceId || defaultServiceId(target.model))) {
      setExpanded((e) => ({ ...e, basic: true }));
      nav.go("basic");
      return;
    }
    compose.mutate();
  };

  const readOnly = !cluster.data?.allowDeploy || assignmentBlocked || (upgrade && (live.isPending || !!live.error));
  // An upgrade waits for the profile too: it decides Monitor (planRequest).
  const loading = cluster.isPending || (upgrade && current.isPending) || (!adaptiveOnly && (profile.isPending || entry.isPending));
  const error = cluster.error ?? current.error ?? (adaptiveOnly ? null : entry.error);
  const keepOption = (label: string) => ({ value: KEEP, label });

  const targetFields = (
    <>
      {upgrade && (movable.length > 0 || moveTo) && (
        <FloatingField label={t("deploy.fields.catalog")}>
          <FieldSelect
            value={moveTo || KEEP}
            onValueChange={(c) => {
              setMoveTo(c === KEEP ? "" : c);
              setVersion("");
              setVariant("");
              setChartVersion("");
            }}
            options={[keepOption(t("deploy.fields.keep", { v: ownCatalog ?? "-" })), ...movable.map((c) => ({ value: c, label: t("deploy.fields.moveTo", { catalog: c }) }))]}
          />
        </FloatingField>
      )}
      <div className={cn("grid gap-3", upgrade ? "grid-cols-2" : "grid-cols-3")}>
        {!upgrade && (
          <FloatingField label={t("deploy.fields.model")} disabled>
            <FieldInput value={entry.data?.model.displayName || target.model} readOnly disabled />
          </FloatingField>
        )}
        <FloatingField label={t("deploy.fields.variant")}>
          <FieldSelect
            value={variant || (upgrade ? KEEP : keptVariant)}
            onValueChange={(x) => {
              setVariant(x === KEEP ? "" : x);
              // On v2 another variant has versions of its own.
              setVersion("");
              setChartVersion("");
            }}
            options={[
              ...(upgrade ? [keepOption(t("deploy.fields.keep", { v: recorded?.variant ?? "-" }))] : []),
              ...listed.map((x) => ({ value: x.id, label: x.id, description: `${x.engine} · ${gpuShort(x.requires)}` })),
            ]}
          />
        </FloatingField>
        {/* Empty is the variant's latest, on an upgrade as on a deploy. */}
        <FloatingField
          label={t(entry.data?.schema === "v2" ? "deploy.fields.variantVersion" : "deploy.fields.version")}
          hint={history.error ? t("deploy.fields.versionError", { error: history.error.message }) : undefined}
        >
          <FieldSelect
            value={version || latest || ""}
            onValueChange={(x) => {
              setVersion(x === latest ? "" : x);
              setChartVersion("");
            }}
            options={versions.map((x) => ({
              value: x,
              label:
                x === latest
                  ? `${x} (${t("model.latest")})`
                  : upgrade && x === recorded?.version && keptVariant === recorded?.variant
                    ? `${x} (${t("deploy.fields.deployed")})`
                    : x,
            }))}
          />
        </FloatingField>
      </div>
      {v && (
        <div className="grid grid-cols-2 gap-3">
          <FloatingField label={t("deploy.fields.chart")} disabled>
            <FieldInput value={v.chart.name} readOnly disabled />
          </FloatingField>
          {chartRange ? (
            <FloatingField
              label={t("deploy.fields.chartVersion")}
              hint={chart.error ? t("deploy.fields.chartError", { error: chart.error }) : chart.range && t("deploy.fields.chartRange", { range: chart.range })}
              error={chart.error ? t("deploy.fields.chartError", { error: chart.error }) : undefined}
            >
              {chart.error ? (
                <FieldInput value={chartVersion} onChange={(e) => setChartVersion(e.target.value.trim())} />
              ) : (
                <FieldSelect
                  value={chartVersion || KEEP}
                  onValueChange={(x) => setChartVersion(x === KEEP ? "" : x)}
                  disabled={chart.loading || chart.pinned}
                  options={[
                    keepOption(
                      chart.loading
                        ? t("deploy.fields.chartListing")
                        : !chart.fallback
                          ? t("deploy.fields.chartNone")
                          : t(chart.keep ? "deploy.fields.chartKeep" : chart.pinned ? "deploy.fields.chartPinned" : "deploy.fields.chartNewest", { v: chart.fallback }),
                    ),
                    ...chart.options.map((x) => ({ value: x, label: x })),
                  ]}
                />
              )}
            </FloatingField>
          ) : (
            <FloatingField label={t("deploy.fields.chartVersion")} disabled>
              <FieldInput value={v.chart.version} readOnly disabled />
            </FloatingField>
          )}
        </div>
      )}
      {!upgrade && (
        <FloatingField label={t("deploy.fields.applyWith")} hint={block ? t(`deploy.fields.applyWithBlocked.${block}`) : t("deploy.fields.applyWithHint")}>
          <FieldSelect
            value={method}
            onValueChange={(x) => x && setPicked(x as ApplyWith)}
            options={(["helm", "llmsvc"] as const).map((m) => {
              const isDefault = m === installMethod(undefined, llm, "v2");
              return {
                value: m,
                label: t(`deploy.fields.applyWithMethod.${m}`),
                description: t(`deploy.fields.applyWithDesc.${m}`),
                badge:
                  m === "llmsvc" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <ExperimentalBadge />
                      {isDefault && t("deploy.fields.applyWithDefault")}
                    </span>
                  ) : isDefault ? (
                    t("deploy.fields.applyWithDefault")
                  ) : undefined,
                disabled: m === "llmsvc" && !!block,
              };
            })}
          />
        </FloatingField>
      )}
      {/* The select shows only the label once closed, so the mark is repeated here. */}
      {!upgrade && method === "llmsvc" && (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-warning">
          <FlaskConical className="size-3.5 shrink-0" />
          {t("deploy.fields.applyWithExperimentalNote")}
        </p>
      )}
    </>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dirty={dirty && step === "form"} onDiscard={onClose}>
    <SheetContent size="2xl" className="gap-0">
      <SheetHeader className="border-b px-5 py-3.5">
        <SheetTitle>{upgrade ? t("deploy.titleUpgrade", { release: target.release }) : t("deploy.title")}</SheetTitle>
        <SheetDescription>{upgrade ? t("deploy.descriptionUpgrade") : t("deploy.description")}</SheetDescription>
      </SheetHeader>

      {step === "form" && !loading && !error && (
        <div className={cn("flex gap-1 border-b px-5 py-2", nav.scrolled && "shadow-sm")}>
          {SECTIONS.map((s) => (
            <Button key={s} variant="ghost" size="sm" className={cn("text-muted-foreground", nav.active === s && "bg-muted text-foreground")} onClick={() => nav.go(s)}>
              {t(`deploy.sections.${upgrade && s === "basic" ? "target" : s}`)}
            </Button>
          ))}
        </div>
      )}

      <SheetBody ref={step === "form" ? nav.ref : undefined} className="relative min-h-0 flex-1 space-y-4 overflow-auto bg-surface-page px-5 py-4">
        {readOnly && (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>{t("deploy.review.readOnly")}</AlertDescription>
          </Alert>
        )}
        {productionReferenced && <Alert><AlertDescription>{t("deploy.fields.productionBindingLocked")}</AlertDescription></Alert>}
        {adaptiveOnly && <Alert><AlertDescription>{t("deploy.fields.assignedAdaptiveOnly")}</AlertDescription></Alert>}
        {routeOptions.error && (
          <Alert variant="warning"><TriangleAlert /><AlertDescription>{t("deploy.routeOptions.error", { error: routeOptions.error.message })}</AlertDescription></Alert>
        )}
        {(error || compose.error || apply.error) && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{(error ?? compose.error ?? apply.error)?.message}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : step === "form" ? (
          <>
            <DeployForm
              form={form}
              onChange={change}
              upgrade={upgrade}
              adaptiveOnly={adaptiveOnly}
              bindingLocked={productionReferenced}
              submitted={submitted}
              recovery={<RecoveryFields disabled={adaptiveOnly} settings={recovery} onChange={(patch) => setRecoveryPatch((previous) => ({ ...previous, ...patch }))} />}
              target={targetFields}
              cluster={cluster.data}
              defaults={{ serviceId: upgrade ? undefined : defaultServiceId(target.model), localPath: entry.data?.localPath, localPathTemplate: entry.data?.pathTemplate, image: imageOf(v, entry.data?.imageRepository), cache }}
              gpuOptions={productChoices(v?.requires.gpuProduct, pickableProducts(nodes.data?.nodes, v?.requires.vendor, profile.data?.profile?.nodes?.gpus, form.gpuResource), form.gpuProducts)}
              gpuListed={v?.requires.gpuProduct}
              gpuResources={v?.requires.gpus && profile.data?.profile?.nodes?.gpus ? vendorResources(profile.data.profile.nodes.gpus, v.requires.vendor) : undefined}
              capacity={
                v?.requires.gpus
                  ? { ...deployCapacity(v.requires, form, nodes.data?.nodes, profile.data?.profile?.nodes?.gpus), refreshing: nodes.isFetching, onRefresh: () => nodes.refetch() }
                  : undefined
              }
              expanded={expanded}
              onExpand={(s, o) => setExpanded((e) => ({ ...e, [s]: o }))}
              routeOptions={routeOptions.isSuccess ? routeOptions.data : undefined}
              catalogRoute={catalogRoute}
              idPrefix={ID_PREFIX}
              helmValues={readOnly || adaptiveOnly ? undefined : valuesSource}
              inputs={inputs}
              remember={canRemember ? remember : undefined}
              onRemember={(key, on) => setRemember((r) => ({ ...r, [key]: on }))}
              presets={upgrade ? undefined : profile.data?.profile?.presets}
            />
            <div style={{ height: nav.tailSpace }} aria-hidden />
          </>
        ) : (
          plan && (
            <Review
              upgrade={upgrade}
              current={current.data}
              currentCatalog={ownCatalog}
              plan={plan}
              diff={diff}
              diffing={dryRun.isPending}
              diffError={dryRun.error?.message}
              state={adaptiveOnly ? { ...state, canForce: false } : state}
              note={note}
              onNote={setNote}
              force={force}
              onForce={setForce}
              method={state.action === "install" ? method : live.data?.backend}
              siteSaves={saves}
            />
          )
        )}
      </SheetBody>

      <SheetFooter className="flex-row justify-end border-t">
        {step === "form" ? (
          <>
            <SheetCancelButton />
            <Button onClick={submit} disabled={!!readOnly || loading || compose.isPending || (!adaptiveOnly && (!inputsAnswered(inputs, checkedInputs) || affinityInvalid(form.affinity)))}>
              {compose.isPending ? t("deploy.review.composing") : t("deploy.review.compose")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => (setStep("form"), setDiff(null), setPlan(null), apply.reset(), dryRun.reset())} disabled={apply.isPending}>
              {t("deploy.review.back")}
            </Button>
            <Button onClick={() => apply.mutate()} disabled={!state.canApply || apply.isPending || !!readOnly}>
              {apply.isPending ? t("deploy.review.busy") : t(`deploy.review.${state.action}`)}
            </Button>
          </>
        )}
      </SheetFooter>
    </SheetContent>
    </Sheet>
  );
}

export function Review({
  upgrade,
  rollback,
  current,
  currentCatalog,
  plan,
  diff,
  diffing,
  diffError,
  state,
  note,
  onNote,
  force,
  onForce,
  method,
  siteSaves,
}: {
  upgrade: boolean;
  rollback?: boolean;
  current?: Plan;
  currentCatalog?: string;
  plan: Plan;
  diff: DiffResult | null;
  diffing: boolean;
  diffError?: string;
  state: ReturnType<typeof pipelineState>;
  note: string;
  onNote: (v: string) => void;
  force: boolean;
  onForce: (v: boolean) => void;
  // The install method: the one picked on an install, the release's own otherwise.
  method?: ApplyWith;
  // Typed answers saved to the site profile once this applies.
  siteSaves?: SiteSave[];
}) {
  const t = useT();
  const moves = current && (upgrade || rollback) ? whatMoves(current, plan, currentCatalog) : null;
  return (
    <>
      {moves && (
        <SectionCard title={t(rollback ? "deploy.review.comesBack" : "deploy.review.moves")}>
          <div className="space-y-1.5 text-sm">
            {moves.map((m) => (
              <div key={m.key} className="grid grid-cols-[7rem_1fr] items-center gap-3">
                <span className="text-muted-foreground">{t(`deploy.review.change.${m.key}`)}</span>
                <span className={cn("inline-flex min-w-0 items-center gap-2 font-mono text-xs", m.changed ? "text-foreground" : "text-muted-foreground")}>
                  <span className="truncate">{m.from || "-"}</span>
                  {m.changed && (
                    <>
                      <ArrowRight className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate font-medium">{m.to || "-"}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
            {current && current.hash === plan.hash && <p className="pt-1 text-muted-foreground">{t("deploy.review.identical")}</p>}
          </div>
        </SectionCard>
      )}
      {!!siteSaves?.length && (
        <SectionCard title={t("deploy.review.siteProfile")}>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t("deploy.review.siteProfileHint")}</p>
            {siteSaves.map((s) => (
              <div key={s.key} className="font-mono text-xs">
                <div className="break-all">{s.key}</div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 ps-4">
                  {s.replaces && (
                    <>
                      <span className="break-all text-muted-foreground">{s.replaces}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-primary" />
                    </>
                  )}
                  <span className="break-all font-medium">{s.text}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
      <SectionCard title={t("deploy.review.diff")}>
        {diffing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" /> {t("deploy.review.dryRun")}
          </div>
        ) : diffError ? (
          <p className="text-sm text-destructive">{diffError}</p>
        ) : diff ? (
          state.nothingToDo ? (
            <p className="text-sm text-muted-foreground">{t("deploy.review.noChange")}</p>
          ) : (
            <DiffView output={diff.output} />
          )
        ) : null}
      </SectionCard>
      {!rollback && (
        <SectionCard title={t("deploy.review.plan")} collapsible defaultExpanded={false}>
          <Provenance plan={plan} />
        </SectionCard>
      )}
      {method && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {t(state.action === "install" ? "deploy.review.applyWith" : "deploy.review.applyWithKept", { method: t(`deploy.fields.applyWithMethod.${method}`) })}
          {method === "llmsvc" && <ExperimentalBadge />}
        </p>
      )}
      <FloatingField label={t("deploy.review.note")} hint={t("deploy.review.noteHint")} multiline>
        <FieldTextarea value={note} onChange={(e) => onNote(e.target.value)} rows={3} />
      </FloatingField>
      {state.canForce && (
        <FloatingField layout="inline" label={t("deploy.review.force")} hint={t("deploy.review.forceHint")}>
          <Switch aria-label={t("deploy.review.force")} checked={force} onCheckedChange={onForce} />
        </FloatingField>
      )}
    </>
  );
}
