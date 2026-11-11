import type { ReactNode } from "react";
import { Badge, FieldInput, FieldSelect, FloatingField, FormSection, Switch, cn } from "@modelsphere/ui";
import type { ClusterInfo, Preset } from "@swiss/lib/api";
import { unlistedProducts } from "@swiss/lib/gpu";
import type { InputRow } from "@swiss/lib/inputs";
import { videoGpus, videoProblem, type PoolForm, type VideoForm } from "@swiss/lib/video";
import { DEFAULTS, POOLS, type Pool } from "@swiss/lib/videoChart";
import { useT } from "@/modules/inferences/i18n";
import { serviceIdError, type Section } from "@/modules/inferences/deploy-lib";
import { InputFields, PresetField, Suggest, Tolerations } from "./DeployForm";
import { OverrideYaml } from "./OverrideYaml";

export interface VideoDeployFormProps {
  form: VideoForm;
  onChange: (patch: Partial<VideoForm>) => void;
  upgrade?: boolean;
  submitted: boolean;
  target: ReactNode;
  cluster?: ClusterInfo;
  defaultServiceId?: string;
  gpuOptions: string[];
  gpuListed?: string[];
  expanded: Record<Section, boolean>;
  onExpand: (s: Section, open: boolean) => void;
  idPrefix: string;
  inputs?: InputRow[];
  remember?: Record<string, boolean>;
  onRemember?: (key: string, on: boolean) => void;
  presets?: Record<string, Preset>;
}

// The deploy form for a video variant: the same sections as DeployForm, none
// of its LLM settings (SLO, CART, compile cache, engine image, route tuning).
export function VideoDeployForm({ form, onChange, upgrade, submitted, target, cluster, defaultServiceId, gpuOptions, gpuListed, expanded, onExpand, idPrefix, inputs, remember, onRemember, presets }: VideoDeployFormProps) {
  const t = useT();
  const f = (k: string, o?: Record<string, unknown>) => t(`deploy.video.${k}`, o);
  const g = (k: string) => t(`deploy.fields.${k}`);
  const gpus = videoGpus(form);
  const forced = unlistedProducts(gpuListed, form.gpuProducts);
  const idError = submitted ? serviceIdError(form.serviceId || defaultServiceId || "") : undefined;
  const problem = submitted ? videoProblem({ ...form, serviceId: form.serviceId || defaultServiceId || "" }) : undefined;
  const shown = (value: string, fallback?: string) => value || fallback || "";
  const setPool = (p: Pool, patch: Partial<PoolForm>) => onChange({ pools: { ...form.pools, [p]: { ...form.pools[p], ...patch } } });
  const digits = (p: Pool, k: keyof Omit<PoolForm, "enabled">) => ({
    value: form.pools[p][k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPool(p, { [k]: e.target.value.replace(/\D/g, "") }),
    inputMode: "numeric" as const,
  });
  const section = (id: Section, children: ReactNode) => (
    <div id={`${idPrefix}${id}`}>
      <FormSection id={`${idPrefix}${id}-section`} title={t(`deploy.sections.${upgrade && id === "basic" ? "target" : id}`)} expanded={expanded[id]} onExpandedChange={(o) => onExpand(id, o)}>
        <div className="flex flex-col gap-3">{children}</div>
      </FormSection>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="video-deploy-form">
      {section(
        "basic",
        <>
          {target}
          <FloatingField value={shown(form.serviceId, defaultServiceId)} label={g("serviceId")} required hint={upgrade ? g("serviceIdLocked") : f("serviceIdHint")} error={idError && t(`deploy.errors.${idError}`)} disabled={upgrade}>
            <Suggest value={form.serviceId} onChange={(serviceId) => onChange({ serviceId })} suggestion={defaultServiceId} disabled={upgrade} />
          </FloatingField>
          <FloatingField
            layout="inline"
            label={g("modelRoute")}
            hint={f("routeHint")}
            expanded={form.modelRoute}
            expandedContent={
              <div className="pb-3">
                <Suggest bare value={form.route} onChange={(route) => onChange({ route })} suggestion={form.serviceId || defaultServiceId} aria-label={g("route")} />
              </div>
            }
          >
            <Switch aria-label={g("modelRoute")} checked={form.modelRoute} onCheckedChange={(v) => onChange(v ? { modelRoute: true } : { modelRoute: false, route: "" })} />
          </FloatingField>
          <div className={cn(!upgrade && "grid grid-cols-2 gap-3")}>
            <FloatingField value={shown(form.namespace, cluster?.namespace)} label={g("namespace")} hint={upgrade ? g("namespaceLocked") : undefined} disabled={upgrade}>
              <Suggest value={form.namespace} onChange={(namespace) => onChange({ namespace })} suggestion={cluster?.namespace} disabled={upgrade} />
            </FloatingField>
            {!upgrade && (
              <FloatingField layout="inline" label={g("createNamespace")} hint={g("createNamespaceHint")}>
                <Switch aria-label={g("createNamespace")} checked={form.createNamespace} onCheckedChange={(createNamespace) => onChange({ createNamespace })} />
              </FloatingField>
            )}
          </div>
          <FloatingField value={shown(form.storageClass, upgrade ? f("databaseKept") : f("storageClassDefault"))} label={f("storageClass")} hint={upgrade ? f("storageClassLocked") : f("storageClassHint")} disabled={upgrade}>
            <FieldInput value={form.storageClass} onChange={(e) => onChange({ storageClass: e.target.value })} placeholder={upgrade ? f("databaseKept") : f("storageClassDefault")} disabled={upgrade} />
          </FloatingField>
          <FloatingField value={shown(form.storageSize, upgrade ? f("databaseKept") : DEFAULTS.storageSize)} label={f("storageSize")} hint={upgrade ? f("storageSizeGrowOnly") : f("storageSizeHint")}>
            <FieldInput value={form.storageSize} onChange={(e) => onChange({ storageSize: e.target.value })} placeholder={upgrade ? f("databaseKept") : DEFAULTS.storageSize} />
          </FloatingField>
          <FloatingField value={shown(form.databaseUrl, form.databaseKept ? f("databaseKept") : f("databaseDefault"))} label={f("database")} hint={form.databaseKept ? f("databaseKeptHint") : f("databaseHint")}>
            <FieldInput type="password" autoComplete="off" value={form.databaseUrl} onChange={(e) => onChange({ databaseUrl: e.target.value })} placeholder={form.databaseKept ? f("databaseKept") : f("databaseDefault")} />
          </FloatingField>
          {inputs && <InputFields inputs={inputs} values={form.inputs} onChange={(v) => onChange({ inputs: v })} remember={remember} onRemember={onRemember} />}
        </>,
      )}

      {section(
        "resources",
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="video-total-gpus">
            <span className="font-medium">{f("totalGpus", { n: gpus.total })}</span>
          </div>
          {problem && problem.code !== "serviceId" && <p className="text-sm text-destructive">{f(`problems.${problem.code}`)}</p>}
          {POOLS.map((p) => {
            const pf = form.pools[p];
            return (
              <div key={p} className="flex flex-col gap-3 rounded-lg border bg-background p-3">
                <FloatingField layout="inline" label={f(`pools.${p}.title`)} hint={f(`pools.${p}.hint`)} description={pf.enabled ? f("perPod", { n: gpus.perPod[p] }) : f("poolOff")}>
                  <Switch aria-label={f(`pools.${p}.title`)} checked={pf.enabled} onCheckedChange={(enabled) => setPool(p, { enabled })} />
                </FloatingField>
                {pf.enabled && (
                  <div className="grid grid-cols-3 gap-3">
                    <FloatingField value={shown(pf.replicaCount, String(DEFAULTS.replicaCount))} label={f("replicas")}>
                      <FieldInput {...digits(p, "replicaCount")} placeholder={String(DEFAULTS.replicaCount)} />
                    </FloatingField>
                    <FloatingField value={shown(pf.tpSize, String(DEFAULTS.tpSize))} label={f("tpSize")} hint={f("parallelHint")}>
                      <FieldInput {...digits(p, "tpSize")} placeholder={String(DEFAULTS.tpSize)} />
                    </FloatingField>
                    <FloatingField value={shown(pf.ulyssesDegree, String(DEFAULTS.ulyssesDegree))} label={f("ulyssesDegree")} hint={f("parallelHint")}>
                      <FieldInput {...digits(p, "ulyssesDegree")} placeholder={String(DEFAULTS.ulyssesDegree)} />
                    </FloatingField>
                  </div>
                )}
                {p === "ref2va" && pf.enabled && (
                  <FloatingField layout="inline" label={f("turbo")} hint={f("turboHint")}>
                    <Switch aria-label={f("turbo")} checked={form.turbo} onCheckedChange={(turbo) => onChange({ turbo })} />
                  </FloatingField>
                )}
              </div>
            );
          })}
          <FloatingField layout="inline" label={f("autoscale")} hint={f("autoscaleHint")}>
            <Switch aria-label={f("autoscale")} checked={form.autoscale} onCheckedChange={(autoscale) => onChange({ autoscale })} />
          </FloatingField>
          <FloatingField label={g("gpuProducts")} hint={f("gpuProductsHint")} notice={forced.length > 0 ? t("deploy.fields.gpuForced", { products: forced.join(", ") }) : undefined}>
            <FieldSelect multiple values={form.gpuProducts} onValuesChange={(v) => onChange({ gpuProducts: v })} options={gpuOptions.map((o) => ({ value: o, label: o, badge: unlistedProducts(gpuListed, [o]).length ? <Badge variant="warning">{g("gpuUnverified")}</Badge> : <Badge variant="success">{g("gpuVerified")}</Badge> }))} placeholder={gpuOptions.length ? undefined : g("gpuProductsEmpty")} disabled={!gpuOptions.length} />
          </FloatingField>
          {presets && Object.keys(presets).length > 0 && <PresetField presets={presets} value={form.preset} onChange={(preset) => onChange({ preset })} />}
          <Tolerations rows={form.tolerations} onChange={(tolerations) => onChange({ tolerations })} />
          <div className="grid grid-cols-2 gap-3">
            <FloatingField value={shown(form.priorityClassName, cluster?.priorityClassName)} label={g("priorityClass")}>
              <Suggest value={form.priorityClassName} onChange={(priorityClassName) => onChange({ priorityClassName })} suggestion={cluster?.priorityClassName} />
            </FloatingField>
            <FloatingField value={shown(form.schedulerName, cluster?.schedulerName)} label={g("scheduler")}>
              <Suggest value={form.schedulerName} onChange={(schedulerName) => onChange({ schedulerName })} suggestion={cluster?.schedulerName} />
            </FloatingField>
          </div>
        </>,
      )}

      {section(
        "advanced",
        <>
          <FloatingField layout="inline" label={g("skipSchemaValidation")} hint={g("skipSchemaValidationHint")}>
            <Switch aria-label={g("skipSchemaValidation")} checked={form.skipSchemaValidation} onCheckedChange={(skipSchemaValidation) => onChange({ skipSchemaValidation })} />
          </FloatingField>
          <OverrideYaml value={form.edits} onChange={(edits) => onChange({ edits })} />
        </>,
      )}
    </div>
  );
}

// The sections the video form has: no routing tuning.
export const VIDEO_SECTIONS: Section[] = ["basic", "resources", "advanced"];
