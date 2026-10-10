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
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, deployApi, type ApplyResult, type DiffResult, type IndexModel, type Plan } from "@swiss/lib/api";
import { EMPTY, formFromPlan, imageOf, planRequest, type Form } from "@swiss/components/DeploySettings";
import { releaseCatalog } from "@swiss/components/CatalogChoice";
import { Provenance } from "@swiss/components/Provenance";
import { DiffView } from "@swiss/components/DiffView";
import { gpuShort } from "@swiss/lib/gpu";
import { isChartRange, movableCatalogs } from "@swiss/lib/upgrade";
import { useT } from "@/modules/inferences/i18n";
import { detailPath } from "@/modules/inferences/lib";
import { SECTIONS, chartChoice, defaultServiceId, gpuOptions, pipelineState, serviceIdError, whatMoves, type Section } from "@/modules/inferences/deploy-lib";
import { DeployForm } from "@/modules/inferences/components/DeployForm";

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
  const upgrade = target.kind === "upgrade";

  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, retry: false });
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
  const catalogName = moveTo || ownCatalog;

  const indexes = useQueries({
    queries: catalogs.map((c) => ({ queryKey: ["catalog", c.name], queryFn: () => api.catalog(c.name), enabled: upgrade || c.name === ownCatalog })),
  });
  const modelIn = (name?: string): IndexModel | undefined =>
    indexes[catalogs.findIndex((c) => c.name === name)]?.data?.index.models.find((m) => m.name === modelName);
  const { movable } = upgrade ? movableCatalogs(catalogs, recorded ?? {}, ownCatalog, (c) => modelIn(c)?.source.hf) : { movable: [] as string[] };
  const im = modelIn(catalogName);
  const versions = im?.versions.map((v) => v.version) ?? [];
  const listed = im?.versions.find((v) => v.version === (version || (upgrade ? recorded?.version : undefined) || im.latest))?.variants ?? [];
  const keptVariant = variant || (upgrade ? recorded?.variant : listed.find((v) => v.default)?.id ?? listed[0]?.id) || "";

  const entry = useQuery({
    queryKey: ["model", modelName, version, catalogName],
    queryFn: () => api.model(modelName!, version || undefined, catalogName),
    enabled: !!modelName && !!catalogName,
  });
  const v = entry.data?.entry.variants.find((x) => x.id === keptVariant) ?? entry.data?.entry.variants[0];
  const chartRange = !!v && isChartRange(v.chart.version);
  const chartList = useQuery({
    queryKey: ["chart-versions", catalogName, modelName, version, keptVariant],
    queryFn: () => api.chartVersions(modelName!, { catalog: catalogName, version: version || undefined, variant: keptVariant }),
    enabled: !!modelName && !!catalogName && chartRange,
    retry: false,
  });
  const chart = chartChoice(chartList, chartVersion, upgrade ? current.data?.chart : undefined);

  const initial = useMemo<Form>(() => (upgrade ? (current.data ? formFromPlan(current.data) : EMPTY) : { ...EMPTY, serviceId: defaultServiceId(target.model) }), [upgrade, current.data, target]);
  const [form, setForm] = useState<Form>(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = useDirty({ form, version, variant, moveTo, chartVersion }, { form: initial, version: upgrade ? "" : (target.version ?? ""), variant: upgrade ? "" : (target.variant ?? ""), moveTo: "", chartVersion: "" });

  const [step, setStep] = useState<"form" | "review">("form");
  const [submitted, setSubmitted] = useState(false);
  const [expanded, setExpanded] = useState(OPEN);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [note, setNote] = useState("");
  const [force, setForce] = useState(false);
  const nav = useAnchorNav({ ids: [...SECTIONS], idPrefix: ID_PREFIX, enabled: step === "form", onExpand: (id) => setExpanded((e) => ({ ...e, [id]: true })) });

  const release = upgrade ? target.release : form.serviceId || defaultServiceId(target.model);
  const namespace = upgrade ? target.namespace : form.namespace || cluster.data?.namespace || "";
  const live = useQuery({ queryKey: ["status", namespace, release], queryFn: () => api.status(namespace, release), enabled: step === "review" && !!release && !!namespace });

  const change = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const compose = useMutation({
    mutationFn: () =>
      deployApi.plan(
        planRequest(
          { ...form, serviceId: form.serviceId || (upgrade ? form.serviceId : defaultServiceId(target.model)) },
          upgrade
            ? { model: recorded!.model, version: version || undefined, variant: variant || undefined, catalog: moveTo || undefined, chartVersion: chartVersion || undefined, fromRelease: target.release }
            : { model: target.model, version, variant: keptVariant, catalog: target.catalog, chartVersion: chartVersion || undefined },
        ),
      ),
    onSuccess: (pl) => {
      setPlan(pl);
      setDiff(null);
      setStep("review");
      dryRun.mutate(pl);
    },
  });
  const dryRun = useMutation({ mutationFn: (pl: Plan) => deployApi.diff({ planHash: pl.hash }), onSuccess: setDiff });
  const state = pipelineState({ diff, exists: live.data?.exists, applied: !!applied });
  const apply = useMutation({
    mutationFn: () => (state.action === "install" ? deployApi.install(plan!.hash, note.trim()) : deployApi.apply(plan!.hash, diff?.revision, note.trim(), force)),
    onSuccess: (r) => {
      setApplied(r);
      for (const key of REFRESH) qc.invalidateQueries({ queryKey: key });
      onClose();
      if (!upgrade) navigate(p(detailPath(plan!.release.name, plan!.release.namespace)));
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

  const readOnly = cluster.data && !cluster.data.allowDeploy;
  const loading = cluster.isPending || (upgrade && current.isPending) || entry.isPending;
  const error = cluster.error ?? current.error ?? entry.error;
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
      {!upgrade && (
        <FloatingField label={t("deploy.fields.model")} disabled>
          <FieldInput value={entry.data?.entry.displayName || target.model} readOnly disabled />
        </FloatingField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FloatingField label={t("deploy.fields.version")}>
          <FieldSelect
            value={version || (upgrade ? KEEP : im?.latest ?? "")}
            onValueChange={(x) => {
              setVersion(x === KEEP || (!upgrade && x === im?.latest) ? "" : x);
              setVariant("");
              setChartVersion("");
            }}
            options={[...(upgrade ? [keepOption(t("deploy.fields.keep", { v: recorded?.version ?? "-" }))] : []), ...versions.map((x) => ({ value: x, label: x === im?.latest ? `${x} (${t("model.latest")})` : x }))]}
          />
        </FloatingField>
        <FloatingField label={t("deploy.fields.variant")}>
          <FieldSelect
            value={variant || (upgrade ? KEEP : keptVariant)}
            onValueChange={(x) => {
              setVariant(x === KEEP ? "" : x);
              setChartVersion("");
            }}
            options={[
              ...(upgrade ? [keepOption(t("deploy.fields.keep", { v: recorded?.variant ?? "-" }))] : []),
              ...listed.map((x) => ({ value: x.id, label: x.id, description: `${x.engine} · ${gpuShort(x.requires)}` })),
            ]}
          />
        </FloatingField>
      </div>
      {chartRange && (
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
              submitted={submitted}
              target={targetFields}
              cluster={cluster.data}
              defaults={{ serviceId: upgrade ? undefined : defaultServiceId(target.model), localPath: entry.data?.localPath, localPathTemplate: entry.data?.pathTemplate, image: imageOf(v, entry.data?.imageRepository) }}
              gpuOptions={gpuOptions(v?.requires.gpuProduct, nodes.data?.nodes.map((n) => n.GPUProduct))}
              expanded={expanded}
              onExpand={(s, o) => setExpanded((e) => ({ ...e, [s]: o }))}
              idPrefix={ID_PREFIX}
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
              state={state}
              note={note}
              onNote={setNote}
              force={force}
              onForce={setForce}
            />
          )
        )}
      </SheetBody>

      <SheetFooter className="flex-row justify-end border-t">
        {step === "form" ? (
          <>
            <SheetCancelButton />
            <Button onClick={submit} disabled={!!readOnly || loading || compose.isPending}>
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
