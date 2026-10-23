import { ErrorNotice, ErrorDetails } from "../components/ErrorNotice";
import { asError, describeError } from "../lib/errors";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "../lib/translation";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  CodeBlock,
  FieldInput,
  FieldNumber,
  FieldRepeater,
  FieldSelect,
  FieldTextarea,
  FloatingField,
  FormSection,
  PageBanner,
  SectionCard,
  cn,
} from "@modelsphere/ui";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { usePluginPath } from "../lib/host";
import { emptyDraft, emitManifests, layersFromVariant } from "../lib/emit";
import { applyProductionTarget, findProductionTarget } from "../lib/target";
import {
  WIZARD_STEPS,
  wizardStepComplete,
  type WizardStep,
} from "../lib/validate";
import { isExactChartVersion } from "../lib/values";
import { fromYamlObject, toYaml } from "../lib/yaml";
import type {
  ArmDraft,
  CanaryDraft,
  CatalogVariant,
  ChartVersions,
  JsonObject,
  Prepared,
} from "../types";
import { TrafficBar } from "../components/TrafficBar";
import { EnvironmentField } from "../components/EnvironmentField";

const STEPS = WIZARD_STEPS;
type Step = WizardStep;

function asWeight(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function nextArmName(arms: ArmDraft[]): string {
  if (!arms.some((a) => a.name === "baseline")) return "baseline";
  if (!arms.some((a) => a.name === "candidate")) return "candidate";
  let i = 3;
  while (arms.some((a) => a.name === `arm-${i}`)) i += 1;
  return `arm-${i}`;
}

function applyVariant(
  arm: ArmDraft,
  variant: CatalogVariant,
  replicaCount: number,
  catalog?: string,
): ArmDraft {
  return {
    ...arm,
    replicaCount,
    chart: { name: variant.chart.name, version: variant.resolvedChartVersion },
    source: {
      catalog,
      model: variant.model,
      version: variant.version,
      variant: variant.id,
      digest: variant.digest,
      hf: undefined,
    },
    layers: layersFromVariant(variant, replicaCount),
  };
}

function stepLabel(step: Step): `create.step${string}` {
  return `create.step${step[0].toUpperCase()}${step.slice(1)}`;
}

function removeArmEditor<T>(current: Record<string, T>, removed: number) {
  return Object.fromEntries(
    Object.entries(current).flatMap(([key, value]) => {
      const index = Number(key.slice(4));
      return index === removed
        ? []
        : [[`arm-${index > removed ? index - 1 : index}`, value]];
    }),
  );
}

export function CanaryCreate() {
  const { t } = useTranslation("canary");
  const api = useCanaryApi();
  const canWrite = useCanaryWrite();
  const p = usePluginPath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("target");
  const [maxReached, setMaxReached] = useState(0);
  const [creating, setCreating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [draft, setDraft] = useState<CanaryDraft>(emptyDraft);
  const [yamlTexts, setYamlTexts] = useState<Record<string, string>>({});
  const [yamlErrors, setYamlErrors] = useState<
    Record<string, Error | undefined>
  >({});
  const invalidYaml = Object.values(yamlErrors).some(Boolean);
  const config = useQuery({
    queryKey: ["canary", api.mode, "config"],
    queryFn: () => api.config(),
  });
  useEffect(() => {
    const namespaces = config.data?.namespaces ?? [];
    if (namespaces.length > 0) {
      setDraft((current) =>
        namespaces.includes(current.namespace)
          ? current
          : { ...current, namespace: namespaces[0] },
      );
    }
  }, [config.data]);
  const catalog = useQuery({
    queryKey: ["canary", api.mode, "catalog"],
    queryFn: () => api.catalog.index(),
  });
  const variants = useQuery({
    queryKey: ["canary", api.mode, "variants"],
    queryFn: () => api.catalog.variants(),
  });
  // Keep queries in the wizard so readiness remains valid when arm editors unmount.
  const chartVersions = useQueries({
    queries: draft.arms.map((arm) => ({
      queryKey: ["canary", api.mode, "chart-versions", arm.source?.catalog ?? catalog.data?.name,
        arm.source?.model, arm.source?.variant, arm.source?.version],
      queryFn: () => api.catalog.chartVersions({ ...arm.source!,
        catalog: arm.source?.catalog ?? catalog.data?.name }),
      enabled: !!catalog.data && !!arm.source?.model && !!arm.source?.variant && !!arm.source?.version,
      staleTime: 60_000,
      retry: false,
    })),
  });
  useEffect(() => {
    setDraft((current) => {
      // A new source has a new query key; previous-source results are never reused.
      if (current !== draft) return current;
      let changed = false;
      const arms = current.arms.map((arm, index) => {
        const result = chartVersions[index];
        const data = result?.isSuccess ? result.data : undefined;
        if (arm.chart.version || !data?.versions.length) return arm;
        changed = true;
        return { ...arm, chart: { ...arm.chart, name: data.chart, version: data.versions[0] } };
      });
      return changed ? { ...current, arms } : current;
    });
  }, [draft, chartVersions]);
  const chartVersionsReady = draft.arms.every((arm, index) => {
    const result = chartVersions[index];
    return result?.isSuccess && result.data.chart === arm.chart.name &&
      isExactChartVersion(arm.chart.version) && result.data.versions.includes(arm.chart.version);
  });
  const deployments = useQuery({
    queryKey: ["canary", api.mode, "deployments"],
    queryFn: () => api.swiss.deployments(),
  });

  const emitted = useMemo(() => emitManifests(draft), [draft]);
  useEffect(() => {
    setPrepared(null);
    setError(null);
  }, [draft]);
  const stepIndex = STEPS.indexOf(step);
  const armsYamlInvalid = Object.entries(yamlErrors).some(
    ([key, message]) => key.startsWith("arm-") && !!message,
  );
  // Keep navigation back to the arm editor available when its YAML is invalid.
  const stepYamlInvalid = step === "arms" && armsYamlInvalid;
  const targets = deployments.data ?? [];
  const selectedTarget = targets.find(
    (d) =>
      d.name === draft.targetRef.name &&
      d.namespace === (draft.targetRef.namespace ?? ""),
  );
  const stepReady =
    !stepYamlInvalid &&
    (step !== "arms" || chartVersionsReady) &&
    (step !== "target" ||
      (!!selectedTarget &&
        config.data?.namespaces.includes(draft.namespace))) &&
    (step === "arms" && api.mode === "live"
      ? draft.arms.length >= 2 &&
        draft.arms.every((a) => a.name && a.source?.version)
      : wizardStepComplete(step, draft));
  const targetName = draft.targetRef.name;
  const targetNamespace = draft.targetRef.namespace ?? "";
  const loadedTargets = deployments.data;

  useEffect(() => {
    const found = (loadedTargets ?? []).find(
      (d) => d.name === targetName && d.namespace === targetNamespace,
    );
    if (!found) return;
    setDraft((current) => {
      const next = applyProductionTarget(current, found);
      const same =
        next.gateway.name === current.gateway.name &&
        next.gateway.namespace === current.gateway.namespace &&
        next.gateway.hostname === current.gateway.hostname &&
        next.gateway.sectionName === current.gateway.sectionName &&
        next.route.path === current.route.path &&
        next.route.productionOpenrestyService ===
          current.route.productionOpenrestyService &&
        next.targetRef.kind === current.targetRef.kind &&
        next.targetRef.name === current.targetRef.name &&
        next.targetRef.namespace === current.targetRef.namespace;
      return same ? current : next;
    });
  }, [targetName, targetNamespace, loadedTargets]);

  function goTo(index: number) {
    if (index < 0 || index >= STEPS.length) return;
    if (index > maxReached && (index !== stepIndex + 1 || !stepReady)) return;
    setMaxReached((reached) => Math.max(reached, index));
    setStep(STEPS[index]);
  }

  function blocker(): string | null {
    if (invalidYaml) {
      return t("create.yamlBlocked", { steps: t("create.stepArms") });
    }
    if (stepReady || step === "review") return null;
    if (step === "target") return t("create.needTarget");
    if (step === "arms") return t("create.needArms");
    if (step === "traffic") return t("create.needTraffic");
    return t("create.needRoute");
  }

  function patch(partial: Partial<CanaryDraft>) {
    setDraft((d) => ({ ...d, ...partial }));
  }

  function editYaml(
    key: string,
    text: string,
    apply: (value?: JsonObject) => void,
  ) {
    setPrepared(null);
    setYamlTexts((current) => ({ ...current, [key]: text }));
    try {
      const value = text.trim() ? fromYamlObject(text) : undefined;
      setYamlErrors((current) => ({ ...current, [key]: undefined }));
      apply(value);
    } catch (error) {
      setYamlErrors((current) => ({ ...current, [key]: asError(error) }));
    }
  }

  async function prepareCanary() {
    if (invalidYaml || !chartVersionsReady) return;
    setPreparing(true);
    setError(null);
    try {
      setPrepared(
        await api.experiments.prepare({
          ...draft,
          compareArms:
            draft.compareArms ?? draft.arms.slice(0, 2).map((a) => a.name),
        }),
      );
    } catch (e) {
      setError(asError(e));
    } finally {
      setPreparing(false);
    }
  }
  async function createCanary() {
    if (creating || !prepared || !canWrite || !chartVersionsReady) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.experiments.create(prepared.id);
      await qc.invalidateQueries({ queryKey: ["experiments"] });
      navigate(p(`experiments/${created.id}`));
    } catch (e) {
      setError(asError(e));
    } finally {
      setCreating(false);
    }
  }

  function blankArm(name: string): ArmDraft {
    const first = variants.data?.[0];
    const base: ArmDraft = {
      name,
      chart: { name: "sglang", version: "0.8.0" },
      replicaCount: 1,
      layers: {
        form: { replicaCount: 1 },
        derived: {
          scaler: { enabled: false },
          cart: { enabled: true },
          sloRequirement: { enabled: false },
        },
      },
    };
    return first ? applyVariant(base, first, 1, catalog.data?.name) : base;
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageBanner
        title={t("create.title")}
        description={t("create.targetHint")}
        onBack={() => navigate(p(""))}
        icon={<Plus className="size-5" />}
      />

      {(error ||
        config.error ||
        catalog.error ||
        variants.error ||
        deployments.error) && (
        <ErrorNotice
          error={
            error ??
            config.error ??
            catalog.error ??
            variants.error ??
            deployments.error
          }
          className="p-4 text-destructive"
        />
      )}
      <div className="flex flex-wrap gap-1 border-b bg-card px-4 py-2">
        {STEPS.map((s, i) => {
          const open = i <= maxReached || (i === stepIndex + 1 && stepReady);
          const active = i === stepIndex;
          return (
            <Button
              key={s}
              type="button"
              variant="ghost"
              size="sm"
              disabled={!open}
              aria-current={active ? "step" : undefined}
              onClick={() => goTo(i)}
              className={cn(
                active
                  ? "bg-accent font-semibold text-foreground enabled:hover:bg-accent enabled:hover:text-foreground"
                  : open
                    ? "font-normal text-muted-foreground"
                    : "font-normal",
              )}
            >
              {i + 1}. {t(stepLabel(s))}
            </Button>
          );
        })}
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        {step === "target" && (
          <FormSection
            title={t("create.identity")}
            summary={t("create.pickTargetHint")}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <FloatingField
                label={t("create.pickTarget")}
                hint={t("create.pickTargetHint")}
                className="md:col-span-2"
              >
                <FieldSelect
                  value={
                    selectedTarget
                      ? `${selectedTarget.namespace}/${selectedTarget.name}`
                      : undefined
                  }
                  onValueChange={(value) => {
                    const found = findProductionTarget(targets, String(value));
                    if (found)
                      setDraft((current) =>
                        applyProductionTarget(current, found),
                      );
                  }}
                  options={targets.map((d) => ({
                    value: `${d.namespace}/${d.name}`,
                    label: d.name,
                    description: `${d.namespace} · ${d.model ?? ""} · ${d.variant ?? ""}@${d.version ?? ""} · ${d.gateway ? `${d.gateway.namespace}/${d.gateway.name}` : "—"} · /${d.route ?? ""} · ${d.openrestyService ?? ""}`,
                  }))}
                  placeholder={t("create.pickTarget")}
                />
              </FloatingField>
              <FloatingField label={t("create.name")}>
                <FieldInput
                  value={draft.name}
                  disabled={!selectedTarget}
                  placeholder={t("create.selectTargetFirst")}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </FloatingField>
              {config.data?.namespaces.length === 1 ? (
                <EnvironmentField
                  label={t("create.namespace")}
                  value={config.data.namespaces[0]}
                />
              ) : (
                <FloatingField label={t("create.namespace")}>
                  <FieldSelect
                    value={config.data ? draft.namespace : undefined}
                    disabled={
                      !config.data || config.data.namespaces.length === 0
                    }
                    options={(config.data?.namespaces ?? []).map(
                      (namespace) => ({
                        value: namespace,
                        label: namespace,
                      }),
                    )}
                    onValueChange={(value) =>
                      patch({ namespace: String(value) })
                    }
                  />
                </FloatingField>
              )}
              <EnvironmentField
                label={t("create.kind")}
                hint={t("create.targetFixedHint")}
                value={draft.targetRef.kind}
              />
              <EnvironmentField
                label={t("create.targetName")}
                value={selectedTarget?.name}
                emptyText={t("create.selectTargetFirst")}
              />
              <EnvironmentField
                label={t("create.targetNs")}
                value={selectedTarget?.namespace}
                emptyText={t("create.selectTargetFirst")}
              />
            </div>
          </FormSection>
        )}

        {step === "arms" && (
          <FormSection
            title={t("create.stepArms")}
            summary={t("create.armsHint")}
          >
            <FieldRepeater
              value={draft.arms}
              onChange={(arms) => {
                setDraft((d) => ({ ...d, arms }));
                if (arms.length < draft.arms.length) {
                  const removed = draft.arms.findIndex(
                    (arm, index) => arm !== arms[index],
                  );
                  setYamlTexts((current) => removeArmEditor(current, removed));
                  setYamlErrors((current) => removeArmEditor(current, removed));
                }
              }}
              newItem={() => blankArm(nextArmName(draft.arms))}
              addButtonText={t("create.addArm")}
              isComplete={(arm) => arm.name.trim() !== ""}
              renderRow={(arm, _index, patchArm) => (
                <ArmFields
                  arm={arm}
                  models={catalog.data?.models ?? []}
                  variants={variants.data ?? []}
                  catalogName={catalog.data?.name}
                  versions={chartVersions[_index]?.data}
                  versionsLoading={chartVersions[_index]?.isFetching ?? false}
                  versionsError={chartVersions[_index]?.error}
                  retryVersions={() => { void chartVersions[_index]?.refetch(); }}
                  onChange={(next) => {
                    if (
                      next.source?.model !== arm.source?.model ||
                      next.source?.variant !== arm.source?.variant
                    ) {
                      setYamlTexts((current) => {
                        const copy = { ...current };
                        delete copy[`arm-${_index}`];
                        return copy;
                      });
                      setYamlErrors((current) => ({
                        ...current,
                        [`arm-${_index}`]: undefined,
                      }));
                    }
                    patchArm(next);
                  }}
                  editText={yamlTexts[`arm-${_index}`]}
                  editError={yamlErrors[`arm-${_index}`]}
                  onEdit={(text) =>
                    editYaml(`arm-${_index}`, text, (edit) =>
                      patchArm({ ...arm, layers: { ...arm.layers, edit } }),
                    )
                  }
                />
              )}
            />
          </FormSection>
        )}

        {step === "traffic" && (
          <FormSection title={t("create.stepTraffic")}>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("create.trafficHint")}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <FloatingField label={t("create.weightProd")}>
                <FieldNumber
                  value={draft.traffic.production}
                  min={0}
                  step={1}
                  onValueChange={(value) =>
                    patch({
                      traffic: {
                        ...draft.traffic,
                        production: asWeight(String(value)),
                      },
                    })
                  }
                />
              </FloatingField>
              <FloatingField label={t("create.weightCanary")}>
                <FieldNumber
                  value={draft.traffic.canary}
                  min={0}
                  step={1}
                  onValueChange={(value) =>
                    patch({
                      traffic: {
                        ...draft.traffic,
                        canary: asWeight(String(value)),
                      },
                    })
                  }
                />
              </FloatingField>
              <div className="md:col-span-2">
                <TrafficBar
                  production={draft.traffic.production}
                  canary={draft.traffic.canary}
                />
              </div>
            </div>
          </FormSection>
        )}

        {step === "route" && (
          <FormSection
            title={t("create.stepRoute")}
            summary={t("create.routeHint")}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <EnvironmentField
                label={t("create.routePath")}
                hint={t("create.pathHint")}
                value={draft.route.path}
                emptyText={t("create.selectTargetFirst")}
              />
              <EnvironmentField
                label={t("create.openresty")}
                hint={t("create.openrestyHint")}
                value={draft.route.productionOpenrestyService}
                emptyText={t("create.selectTargetFirst")}
              />
            </div>
          </FormSection>
        )}

        {step === "review" && (
          <div className="grid gap-4">
            <SectionCard title={t("experiments.compare")}>
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1].map((i) => (
                  <FloatingField
                    key={i}
                    label={t(
                      i === 0 ? "experiments.control" : "experiments.candidate",
                    )}
                  >
                    <FieldSelect
                      value={
                        (draft.compareArms ??
                          draft.arms.slice(0, 2).map((a) => a.name))[i] ?? ""
                      }
                      options={draft.arms.map((a) => ({
                        value: a.name,
                        label: a.name,
                      }))}
                      onValueChange={(value) => {
                        const arms = [
                          ...(draft.compareArms ??
                            draft.arms.slice(0, 2).map((a) => a.name)),
                        ];
                        arms[i] = value;
                        patch({ compareArms: arms });
                      }}
                    />
                  </FloatingField>
                ))}
              </div>
            </SectionCard>
            {!chartVersionsReady && <p role="alert" className="text-sm text-destructive">
              {t("create.chartVersionsRequired")}
            </p>}
            <Button
              disabled={preparing || !canWrite || invalidYaml || !chartVersionsReady}
              onClick={() => void prepareCanary()}
            >
              {t("experiments.prepare")}
            </Button>
            {prepared && (
              <p className="text-sm text-success">
                {t("experiments.prepared")}: {prepared.id}
              </p>
            )}
            {prepared?.warnings.map((warning) => (
              <p key={warning} className="text-sm">
                {warning}
              </p>
            ))}
            {prepared?.economics && (
              <SectionCard title={t("economics.frozen")}>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(prepared.economics.arms).map(
                    ([name, economics]) => {
                      const rates =
                        economics.prices[prepared.economics!.currency];
                      return (
                        <div
                          key={name}
                          className="rounded-md border p-3 text-sm"
                        >
                          <strong>{name}</strong> · {t("economics.gpuTotal")}:{" "}
                          {economics.gpuCount ?? "—"}
                          <p>
                            {t("economics.pricingKey")}:{" "}
                            {economics.pricingKey || "—"} ·{" "}
                            {t(`economics.${economics.resolution}`)}
                          </p>
                          <p>
                            {rates
                              ? `${prepared.economics!.currency} / 1M · ${t("economics.inputPerMillion")} ${rates.inputPerMillion} · ${t("economics.cachedPerMillion")} ${rates.cachedPerMillion} · ${t("economics.outputPerMillion")} ${rates.outputPerMillion}`
                              : t("economics.unpriced")}
                          </p>
                        </div>
                      );
                    },
                  )}
                </div>
              </SectionCard>
            )}
            <SectionCard
              title={t("create.summary")}
              summary={`${draft.arms.length} arm${draft.arms.length === 1 ? "" : "s"} · ${draft.traffic.production}:${draft.traffic.canary} · ${draft.gateway.namespace || "—"}/${draft.gateway.name || "—"} · ${draft.route.path || "—"} · route.enabled=${String(draft.route.enabled)}`}
            >
              <TrafficBar
                production={draft.traffic.production}
                canary={draft.traffic.canary}
              />
            </SectionCard>
            <SectionCard title={t("create.issues")}>
              {prepared || emitted.issues.length === 0 ? (
                <p className="text-sm text-success">{t("create.valid")}</p>
              ) : (
                <ul className="grid gap-1 text-sm text-destructive">
                  {emitted.issues
                    .filter(
                      (issue) =>
                        api.mode === "fixture" ||
                        !issue.path.endsWith("chart.version"),
                    )
                    .map((issue) => (
                      <li key={`${issue.path}:${issue.message}`}>
                        <span className="font-mono text-xs">{issue.path}</span>{" "}
                        {describeError(issue.message, t).summary}
                      </li>
                    ))}
                </ul>
              )}
              {Object.entries(emitted.stripped).some(
                ([, keys]) => keys.length,
              ) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("create.owned")}:{" "}
                  {Object.entries(emitted.stripped)
                    .filter(([, keys]) => keys.length)
                    .map(([arm, keys]) => `${arm}: ${keys.join(", ")}`)
                    .join("; ")}
                </p>
              ) : null}
            </SectionCard>
            <SectionCard title={t("create.yaml")}>
              <CodeBlock
                language="yaml"
                value={prepared ? toYaml(prepared.canary) : emitted.yaml}
                downloadName={`${draft.name}.yaml`}
                maxHeight="28rem"
              />
            </SectionCard>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={stepIndex === 0}
            onClick={() => goTo(stepIndex - 1)}
          >
            {t("create.back")}
          </Button>
          <p className="text-xs text-muted-foreground">{blocker()}</p>
          {step === "review" ? (
            <Button
              type="button"
              disabled={creating || !prepared || !canWrite || invalidYaml || !chartVersionsReady}
              onClick={() => void createCanary()}
            >
              {t("create.submit")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!stepReady}
              onClick={() => goTo(stepIndex + 1)}
            >
              {t("create.next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ArmFields({
  arm,
  models,
  variants,
  catalogName,
  versions,
  versionsLoading,
  versionsError,
  retryVersions,
  onChange,
  editText,
  editError,
  onEdit,
}: {
  arm: ArmDraft;
  models: { name: string; displayName?: string; defaultVariant?: string }[];
  variants: CatalogVariant[];
  catalogName?: string;
  versions?: ChartVersions;
  versionsLoading: boolean;
  versionsError: Error | null | undefined;
  retryVersions: () => void;
  onChange: (arm: ArmDraft) => void;
  editText?: string;
  editError?: Error;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation("canary");
  const model = arm.source?.model ?? models[0]?.name ?? "";
  const modelVariants = variants.filter((v) => v.model === model);
  const selected =
    modelVariants.find(
      (v) => v.id === arm.source?.variant && v.version === arm.source?.version,
    ) ?? modelVariants.find((v) => v.id === arm.source?.variant) ?? modelVariants[0];
  const availableVersions = versions?.versions ?? [];
  const versionError = versionsLoading || versionsError || !versions
    ? undefined
    : !availableVersions.length
      ? t("create.chartVersionsEmpty")
      : arm.chart.version && !availableVersions.includes(arm.chart.version)
        ? t("create.chartVersionUnavailable")
        : undefined;
  const stub = emitManifests({
    ...emptyDraft(),
    name: "preview",
    namespace: "default",
    arms: [arm],
    targetRef: { kind: "HelmRelease", name: "x" },
  }).canary.spec.arms[0]?.values;

  return (
    <SectionCard
      title={
        <span className="font-mono">{arm.name || t("create.armName")}</span>
      }
      summary={
        selected
          ? `${t("create.chartPin", { name: `${arm.chart.name}@${arm.chart.version}` })} · ${t("create.variantPin", { name: `${arm.source?.variant ?? selected.id}@${arm.source?.version ?? selected.version}` })}`
          : t("create.pickVariant")
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FloatingField label={t("create.armName")}>
          <FieldInput
            value={arm.name}
            onChange={(e) => onChange({ ...arm, name: e.target.value })}
          />
        </FloatingField>
        <FloatingField label={t("economics.pricingKey")}>
          <FieldInput
            value={arm.pricingKey ?? ""}
            placeholder={arm.source?.model ?? ""}
            onChange={(e) => onChange({ ...arm, pricingKey: e.target.value })}
          />
        </FloatingField>
        <FloatingField label={t("economics.gpuOverride")}>
          <FieldInput
            type="number"
            min={1}
            max={1024}
            step={1}
            value={arm.gpuCount ?? ""}
            onChange={(e) =>
              onChange({
                ...arm,
                gpuCount:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </FloatingField>
        <p className="text-xs text-muted-foreground md:col-span-2">
          {t("economics.bindingHint")}
        </p>
        <FloatingField label={t("experiments.historicalVersion")}>
          <FieldInput
            value={arm.source?.version ?? ""}
            onChange={(e) => {
              if (arm.source)
                onChange({
                  ...arm,
                  chart: { ...arm.chart, version: "" },
                  source: {
                    ...arm.source,
                    version: e.target.value,
                    digest: undefined,
                  },
                });
            }}
          />
        </FloatingField>
        <FloatingField label={t("create.replicas")}>
          <FieldNumber
            value={arm.replicaCount}
            min={1}
            step={1}
            onValueChange={(value) => {
              const replicaCount =
                Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1;
              const layers = {
                ...arm.layers,
                form: { ...(arm.layers.form ?? {}), replicaCount },
              };
              onChange({ ...arm, replicaCount, layers });
            }}
          />
        </FloatingField>
        <FloatingField label={t("create.model")}>
          <FieldSelect
            value={model || undefined}
            onValueChange={(nextModel) => {
              // Re-selecting the current value still fires Base UI's
              // onValueChange; rebuilding the layers would drop `edit` while
              // the YAML textarea keeps showing it.
              if (nextModel === arm.source?.model) return;
              const v = variants.find((item) => item.model === nextModel);
              if (v)
                onChange(
                  applyVariant({ ...arm, name: arm.name }, v, arm.replicaCount, catalogName),
                );
            }}
            options={models.map((m) => ({
              value: m.name,
              label: m.displayName ?? m.name,
            }))}
          />
        </FloatingField>
        <FloatingField label={t("create.variant")}>
          <FieldSelect
            value={selected ? `${selected.id}@${selected.version}` : undefined}
            onValueChange={(value) => {
              if (value === `${arm.source?.variant}@${arm.source?.version}`) {
                return;
              }
              const [id, version] = value.split("@");
              const v = variants.find(
                (item) =>
                  item.model === model &&
                  item.id === id &&
                  item.version === version,
              );
              if (v) onChange(applyVariant(arm, v, arm.replicaCount, catalogName));
            }}
            options={modelVariants.map((v) => ({
              value: `${v.id}@${v.version}`,
              label: t("create.variantPin", { name: `${v.id}@${v.version}` }),
            }))}
          />
        </FloatingField>
        <FloatingField label={t("create.chart")}>
          <FieldInput readOnly value={versions?.chart ?? arm.chart.name} />
        </FloatingField>
        <FloatingField
          label={t("create.chartVersion")}
          hint={t("create.chartVersionHint")}
          error={versionError}
        >
          <FieldSelect
            value={availableVersions.includes(arm.chart.version) ? arm.chart.version : undefined}
            disabled={versionsLoading || !!versionsError || !availableVersions.length}
            searchable
            searchPlaceholder={t("create.searchChartVersions")}
            loading={versionsLoading}
            loadingText={t("create.chartVersionsLoading")}
            placeholder={t("create.selectChartVersion")}
            options={availableVersions.map((version) => ({ value: version, label: version }))}
            onValueChange={(version) => {
              if (versions?.versions.includes(version))
                onChange({ ...arm, chart: { ...arm.chart, name: versions.chart, version } });
            }}
          />
        </FloatingField>
        {versionsLoading && <p role="status" className="text-sm text-muted-foreground md:col-span-2">
          {t("create.chartVersionsLoading")}
        </p>}
        {versionsError && <div className="space-y-2 md:col-span-2">
          <p className="text-sm text-destructive">{t("create.chartVersionsFailed")}</p>
          <ErrorNotice error={versionsError} />
          <Button type="button" variant="outline" onClick={retryVersions}>{t("create.chartVersionsRetry")}</Button>
        </div>}
        {selected ? (
          <div className="flex flex-wrap gap-1 md:col-span-2">
            <Badge variant="info">{selected.engine}</Badge>
            <Badge variant="outline">
              {t("create.gpus")} {selected.requires.gpus}
            </Badge>
            <Badge variant="outline">{versions?.range ?? selected.chart.version}</Badge>
            {(selected.requires.gpuProduct ?? []).slice(0, 2).map((g) => (
              <Badge key={g} variant="secondary">
                {g}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="md:col-span-2">
          <FloatingField label={t("create.valuesStub")} multiline>
            <FieldTextarea
              readOnly
              rows={10}
              value={stub ? toYaml(stub) : ""}
            />
          </FloatingField>
        </div>
        <div className="md:col-span-2">
          <FloatingField
            label="edit layer (optional YAML overlay)"
            error={editError ? describeError(editError, t).summary : undefined}
            multiline
          >
            <FieldTextarea
              rows={6}
              value={
                editText ?? (arm.layers.edit ? toYaml(arm.layers.edit) : "")
              }
              onChange={(e) => onEdit(e.target.value)}
            />
          </FloatingField>
          {editError && <ErrorDetails error={editError} />}
        </div>
      </div>
    </SectionCard>
  );
}
