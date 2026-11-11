import { ChevronDown } from "lucide-react";
import type { ClusterInfo, Preset } from "@swiss/lib/api";
import { productChoices } from "@swiss/lib/gpu";
import type { InputRow } from "@swiss/lib/inputs";
import { toYaml } from "@swiss/lib/yaml";
import { videoGpus, videoProblem, type PoolForm, type VideoForm, type VideoProblem } from "@swiss/lib/video";
import { DEFAULTS, KEYS, POOL_LABELS, POOLS, type Pool } from "@swiss/lib/videoChart";
import { InputFields, PathInput, Products, Row, Suggest, Tolerations } from "@swiss/components/DeploySettings";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { Input } from "@swiss/components/ui/input";
import { Switch } from "@swiss/components/ui/switch";

// The deploy form for a video variant. It shares the generic rows with the LLM
// form and none of the LLM sections: a video chart has no tokens to route on,
// no compile cache and no engine image to override.
export function VideoSettings({
  form,
  onChange,
  cluster,
  serviceIdPlaceholder,
  inputs,
  remember,
  onRemember,
  supportedGPUs,
  clusterGPUs,
  presets,
  lockIdentity = false,
  readOnly = false,
}: {
  form: VideoForm;
  onChange: (patch: Partial<VideoForm>) => void;
  cluster?: ClusterInfo;
  serviceIdPlaceholder?: string;
  inputs?: InputRow[];
  remember?: Record<string, boolean>;
  onRemember?: (key: string, on: boolean) => void;
  supportedGPUs?: string[];
  clusterGPUs?: string[];
  presets?: Record<string, Preset>;
  lockIdentity?: boolean;
  readOnly?: boolean;
}) {
  const gpus = videoGpus(form);
  const problem = videoProblem(form);
  const picked = presets?.[form.preset];
  const setPool = (p: Pool, patch: Partial<PoolForm>) => onChange({ pools: { ...form.pools, [p]: { ...form.pools[p], ...patch } } });
  const digits = (p: Pool, k: keyof Omit<PoolForm, "enabled">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPool(p, { [k]: e.target.value.replace(/\D/g, "") });

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Video deploy settings</CardTitle>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "What this revision ran with, exactly as it ran. A rollback re-applies it verbatim — to change any of it, upgrade instead."
              : "A video generation service: a router, and a pool of server and SGLang pods per capability. Models and SGLang flags come from the catalog."}
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          <Row
            label="Service ID"
            note={lockIdentity ? "fixed for the life of the release" : "names the helm release and the route"}
          >
            <Suggest
              value={form.serviceId}
              onChange={(v) => onChange({ serviceId: v })}
              disabled={lockIdentity}
              suggestion={serviceIdPlaceholder}
              placeholder={serviceIdPlaceholder}
            />
          </Row>

          <Row
            label="Route path"
            note="publishes a video ModelRoute on the shared openresty; empty uses the service ID"
            toggle={<Switch checked={form.modelRoute} onChange={(v) => onChange(v ? { modelRoute: true } : { modelRoute: false, route: "" })} label="publish a route" />}
          >
            {form.modelRoute && (
              <PathInput
                value={form.route}
                onChange={(v) => onChange({ route: v })}
                suggestion={form.serviceId}
                placeholder={form.serviceId || "the service ID"}
              />
            )}
          </Row>

          <Row label="Namespace" note={lockIdentity ? "moving a release between namespaces installs a second one" : undefined}>
            <Suggest
              value={form.namespace}
              onChange={(v) => onChange({ namespace: v })}
              disabled={lockIdentity}
              suggestion={cluster?.namespace}
              placeholder={cluster?.namespace ?? "the site profile's"}
            />
          </Row>

          {!lockIdentity && (
            <Row
              label="Create namespace"
              note="helm creates it during install"
              toggle={<Switch checked={form.createNamespace} onChange={(v) => onChange({ createNamespace: v })} label="create the namespace" />}
            />
          )}

          {inputs && <InputFields inputs={inputs} values={form.inputs} onChange={(v) => onChange({ inputs: v })} remember={remember} onRemember={onRemember} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
            Pools
            <span className="text-sm font-normal text-muted-foreground" data-testid="video-total-gpus">
              {gpus.total} GPU{gpus.total === 1 ? "" : "s"} in total
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Each pod is one server and one SGLang on tp × ulysses GPUs, running one generation at a time: more
            concurrency is more replicas.
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {problem && problem.code !== "serviceId" && <p className="py-2 text-sm text-destructive">{problemText(problem)}</p>}
          {POOLS.map((p) => {
            const pf = form.pools[p];
            return (
              <div key={p} className="py-1">
                <Row
                  label={POOL_LABELS[p].title}
                  note={`${POOL_LABELS[p].note} (${KEYS.pool(p).enabled})`}
                  caption={pf.enabled ? `${gpus.perPod[p]} GPUs per pod` : "off"}
                  toggle={<Switch checked={pf.enabled} onChange={(v) => setPool(p, { enabled: v })} label={`enable ${p}`} />}
                >
                  {pf.enabled && (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                      <Labeled label="replicas">
                        <Input value={pf.replicaCount} onChange={digits(p, "replicaCount")} inputMode="numeric" aria-label={`${p} replicas`} placeholder={String(DEFAULTS.replicaCount)} />
                      </Labeled>
                      <Labeled label="tp">
                        <Input value={pf.tpSize} onChange={digits(p, "tpSize")} inputMode="numeric" aria-label={`${p} tp size`} placeholder={String(DEFAULTS.tpSize)} />
                      </Labeled>
                      <Labeled label="ulysses">
                        <Input value={pf.ulyssesDegree} onChange={digits(p, "ulyssesDegree")} inputMode="numeric" aria-label={`${p} ulysses degree`} placeholder={String(DEFAULTS.ulyssesDegree)} />
                      </Labeled>
                    </div>
                  )}
                </Row>
                {p === "ref2va" && pf.enabled && (
                  <Row
                    label="Turbo"
                    note="the 8-step Turbo LoRA and its sampling; off serves the base model"
                    toggle={<Switch checked={form.turbo} onChange={(v) => onChange({ turbo: v })} label="turbo" />}
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Autoscaling</CardTitle>
          <p className="text-sm text-muted-foreground">
            Deploys a scaler and an SLO requirement for each pool. A pool is not scaled until its SLO has a maximum:
            set that, and the queue depth that scales it, in the SLO card once the release is up.
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          <Row
            label="Autoscale / SLO"
            note={`${KEYS.scaler} and ${KEYS.sloRequirement}`}
            toggle={<Switch checked={form.autoscale} onChange={(v) => onChange({ autoscale: v })} label="autoscale" />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage and database</CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          <Row
            label="Storage class"
            note={
              lockIdentity
                ? "fixed: the shared volume already exists, and a PVC's storage class cannot change"
                : "the shared asset volume; must support ReadWriteMany (CephFS, NFS). Empty uses the cluster default"
            }
          >
            <Input value={form.storageClass} onChange={(e) => onChange({ storageClass: e.target.value })} disabled={lockIdentity} aria-label="storage class" placeholder={lockIdentity ? "kept" : "cluster default"} />
          </Row>
          <Row
            label="Storage size"
            note={
              lockIdentity
                ? "can only grow: the volume is kept across upgrades and uninstalls, and a PVC never shrinks. Empty keeps it"
                : "a quota, not a reservation; a CephFS volume grows in place but never shrinks"
            }
          >
            <Input value={form.storageSize} onChange={(e) => onChange({ storageSize: e.target.value })} aria-label="storage size" placeholder={lockIdentity ? "kept" : DEFAULTS.storageSize} />
          </Row>
          <Row
            label="Database URL"
            note={
              form.databaseKept
                ? "the release sets one already: empty keeps it"
                : "empty uses the chart's default, the platform's PostgreSQL"
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={form.databaseUrl}
              onChange={(e) => onChange({ databaseUrl: e.target.value })}
              aria-label="database URL"
              placeholder={form.databaseKept ? "kept" : "postgresql://user:password@host:5432/minimaxh3"}
            />
          </Row>
        </CardContent>
      </Card>

      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Advanced
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y border-t px-4">
          <Row label="GPU product" note="restricts the GPU pods to these products; any one will do">
            <Products
              selected={form.gpuProducts}
              onChange={(v) => onChange({ gpuProducts: v })}
              options={productChoices(supportedGPUs, clusterGPUs, form.gpuProducts)}
              listed={supportedGPUs}
            />
          </Row>
          {presets && Object.keys(presets).length > 0 && (
            <Row label="Preset" note="site profile values merged into this deploy's: a list keeps both sides' items, a value set here wins">
              <div className="w-full min-w-0 space-y-1.5 py-1">
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.preset}
                  onChange={(e) => onChange({ preset: e.target.value })}
                  aria-label="Preset"
                >
                  <option value="">none</option>
                  {Object.keys(presets).sort().map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {picked?.description && <p className="text-xs text-muted-foreground">{picked.description}</p>}
                {picked && <pre className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-snug">{toYaml(picked.values ?? {})}</pre>}
              </div>
            </Row>
          )}
          <Row label="Tolerations" note="the GPU pods' tolerations; the list replaces the chart's">
            <Tolerations rows={form.tolerations} onChange={(v) => onChange({ tolerations: v })} />
          </Row>
          <Row label="Priority class" note="of the GPU pods">
            <Suggest
              value={form.priorityClassName}
              onChange={(v) => onChange({ priorityClassName: v })}
              suggestion={cluster?.priorityClassName}
              placeholder={cluster?.priorityClassName ?? "the chart's default"}
            />
          </Row>
          <Row label="Scheduler" note="of the GPU pods; use the one the other GPU workloads use">
            <Suggest
              value={form.schedulerName}
              onChange={(v) => onChange({ schedulerName: v })}
              suggestion={cluster?.schedulerName}
              placeholder={cluster?.schedulerName ?? "the chart's default"}
            />
          </Row>
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan editor</CardTitle>
          <p className="text-sm text-muted-foreground">Any values key, applied after every layer, shown as its own edit layer.</p>
        </CardHeader>
        <CardContent>
          <textarea
            value={form.edits}
            onChange={(e) => onChange({ edits: e.target.value })}
            spellCheck={false}
            rows={8}
            placeholder={EDITS_PLACEHOLDER}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
          />
        </CardContent>
      </Card>
    </fieldset>
  );
}

const EDITS_PLACEHOLDER = `# last word, any key
server:
  config:
    queueTimeoutSeconds: 3600`;

function problemText(p: VideoProblem): string {
  if (p.code === "noPool") return "Enable at least one pool.";
  return "A service ID is required.";
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 basis-24 items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
