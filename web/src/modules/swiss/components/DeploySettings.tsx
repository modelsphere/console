import { useState } from "react";
import { ChevronDown, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { ApplyFlags, ClusterInfo, Input as CatalogInput, Plan, PlanRequest, Preset, ProfileResponse, Variant } from "@swiss/lib/api";
import { cn } from "@swiss/lib/utils";
import { cacheFieldError, type CacheCard, type CacheDefaults } from "@swiss/lib/cache";
import { productChoices, unlistedProducts, type GPUCapacity } from "@swiss/lib/gpu";
import { CHECK_MS, inputError, inputProblem, rememberable, setInputOverrides, type InputChoice, type InputRow } from "@swiss/lib/inputs";
import { useDebounced } from "@swiss/lib/useDebounced";
import { PRODUCT_KEY, affinityRules, editRule, listLabel, setAffinity, type AffinityRule } from "@swiss/lib/affinity";
import { envBase, overlay, withEnv, withPreset } from "@swiss/lib/formLayer";
import { applyImageEdits, dropClearedImages, imageEditsFromLayer, imageRows, joinImage, type ImageSlot, type ImageSlotKind } from "@swiss/lib/imageSlots";
import { toYaml } from "@swiss/lib/yaml";
import { FEATURES, featureOn } from "@swiss/lib/profile";
import { layersOf } from "@swiss/components/Provenance";
import { Select as SourceSelect } from "@swiss/components/ChartVersion";
import {
  DIRECTIVES,
  DIRECTIVES_BY_KEY,
  MAX_VALUES,
  directiveGroups,
  rejectKey,
} from "@swiss/lib/routeDirectives";
import { Button } from "@swiss/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { Dialog } from "@swiss/components/ui/dialog";
import { Input } from "@swiss/components/ui/input";
import { HoverHint } from "@swiss/components/ui/hint";
import { Switch } from "@swiss/components/ui/switch";

// One form, two routes. Deploy composes it against a catalog model and Upgrade
// against a release's stored plan, but a setting that means one thing on one
// page and another on the other is how the two drift into disagreeing about
// what a deploy is.
export interface Toleration {
  key: string;
  operator: "Exists" | "Equal";
  value: string;
  effect: string;
  // The toleration as the release's form layer has it, sent as is while the
  // fields still match it: keys no field shows, tolerationSeconds, survive.
  raw?: Record<string, unknown>;
}

export interface Form {
  edits: string;
  gpuProducts: string[];
  // The resource picked among the vendor's; empty lets swissd pick.
  gpuResource: string;
  tolerations: Toleration[];
  // A site profile preset, by name, merged into a deploy's form values. An
  // upgrade has none: the release's form layer already carries its values.
  preset: string;
  // The rules the release's form layer's affinities carry, on an upgrade:
  // each one edited or removed in place.
  affinity: AffinityRule[];
  priorityClassName: string;
  schedulerName: string;
  cart: boolean;
  modelRoute: boolean;
  slo: boolean;
  serviceMonitor: boolean;
  namespace: string;
  // createNamespace: the install creates the namespace. applyFlags sends it
  // with the install, and planRequest the deprecated createNamespace beside
  // it, for a swissd older than applyFlags.
  createNamespace: boolean;
  serviceId: string;
  localPath: string;
  // By chart path, as typed. Empty is the row's answer (InputRow).
  inputs: Record<string, string>;
  scaler: boolean;
  // The LLMScaler's bounds. Empty leaves the chart's own.
  scalerMin: string;
  scalerMax: string;
  replicaCount: string;
  route: string;
  // image is repository:tag for the engine on this deploy alone. Empty leaves
  // the catalog's tag and the site's mirror.
  image: string;
  // Other image slots, by values path. "" is an explicit clear: on an upgrade
  // that drops the form-layer override. A path that is absent was not edited.
  images: Record<string, string>;
  // Named model-route knobs. Empty number fields leave chart defaults.
  exposeRoutedPeer: boolean;
  backendMaxConcurrency: string;
  cartMaxLoad: string;
  ttftLimitMs: string;
  tpsLimitTps: string;
  adaptiveCc: boolean;
  adaptiveCcMinFrac: string;
  // Everything else openresty takes, added a row at a time rather than listed:
  // there are thirty of them, two are usually set, and a form that shows all
  // thirty is a form nobody reads. Ordered, so a row stays where it was added.
  nginxExtras: { key: string; value: string }[];
  monitor: boolean;
  monitorModel: string;
  monitorGpuType: string;
  // The sglang chart's compile cache. Empty fields leave the site's, else the
  // chart's.
  cache: boolean;
  cacheHostPath: string;
  cacheHostPathSuffix: string;
  cacheHistoryLimit: string;
  cacheMaxSlots: string;
  // Apply without checking the values against the chart's values.schema.json:
  // the way out for a variant carrying a key its chart's schema refuses, or a
  // site's cache on a chart without one. Not composed: applyFlags sends it
  // with the diff and the apply. The swiss pages leave it off and ask in the
  // apply dialog instead.
  skipSchemaValidation: boolean;
}

export const EMPTY: Form = {
  edits: "",
  gpuProducts: [],
  gpuResource: "",
  tolerations: [],
  preset: "",
  affinity: [],
  priorityClassName: "",
  schedulerName: "",
  cart: true,
  modelRoute: false,
  slo: true,
  serviceMonitor: true,
  namespace: "",
  createNamespace: false,
  serviceId: "",
  localPath: "",
  inputs: {},
  scaler: true,
  scalerMin: "",
  scalerMax: "",
  replicaCount: "",
  route: "",
  image: "",
  images: {},
  exposeRoutedPeer: true,
  backendMaxConcurrency: "",
  cartMaxLoad: "",
  ttftLimitMs: "",
  tpsLimitTps: "",
  adaptiveCc: true,
  adaptiveCcMinFrac: "",
  nginxExtras: [],
  monitor: true,
  monitorModel: "",
  monitorGpuType: "",
  cache: false,
  cacheHostPath: "",
  cacheHostPathSuffix: "",
  cacheHistoryLimit: "",
  cacheMaxSlots: "",
  skipSchemaValidation: false,
};

// The switches swissd gives a default for, by chart section.
const DEFAULTED_SWITCHES = { modelRoute: "modelRoute", scaler: "scaler", cart: "cart", slo: "sloRequirement", serviceMonitor: "serviceMonitor", cache: "cache" } as const;
type DefaultedSwitch = keyof typeof DEFAULTED_SWITCHES;
export type SwitchDefaults = Partial<Pick<Form, DefaultedSwitch>>;

// switchDefaults is where a fresh deploy's switches start: the variant's own
// <section>.enabled where it sets one, else the site's resolved default from
// /api/profile. modelRoute is the site's alone, as compose has it, and a site
// cache that is on wins over the variant's, since its layer is the higher one.
// A switch neither names keeps EMPTY's.
export function switchDefaults(site: Record<string, boolean> | undefined, values: Record<string, unknown> | undefined): SwitchDefaults {
  const out: SwitchDefaults = {};
  for (const [field, section] of Object.entries(DEFAULTED_SWITCHES) as [DefaultedSwitch, string][]) {
    const v = section === "modelRoute" ? undefined : values?.[section];
    const own = v && typeof v === "object" ? (v as Record<string, unknown>).enabled : undefined;
    const on = section === "cache" && site?.cache ? true : typeof own === "boolean" ? own : site?.[section];
    if (typeof on === "boolean") out[field] = on;
  }
  return out;
}

// siteSwitchDefaults is the site half of switchDefaults: defaults.features with
// unset as on, the rule the profile editor shows, modelRoute from route.enabled
// and cache from cache.enabled. Undefined when the profile is unread or does
// not parse.
export function siteSwitchDefaults(r: ProfileResponse | undefined): Record<string, boolean> | undefined {
  const p = r?.profile;
  if (!p) return undefined;
  return { ...Object.fromEntries(FEATURES.map((k) => [k, featureOn(p.defaults, k)])), modelRoute: !!p.route?.enabled, cache: !!p.cache?.enabled };
}

// reseed moves the switches from prev's defaults to next's, keeping any
// the operator has flipped since. It returns form itself when nothing moves.
export function reseed(form: Form, prev: SwitchDefaults, next: SwitchDefaults): Form {
  let out = form;
  for (const field of Object.keys(DEFAULTED_SWITCHES) as DefaultedSwitch[]) {
    const want = next[field] ?? EMPTY[field];
    if (form[field] === (prev[field] ?? EMPTY[field]) && form[field] !== want) {
      out = { ...out, [field]: want };
    }
  }
  return out;
}

export function DeploySettings({
  form,
  onChange,
  cluster,
  serviceIdPlaceholder,
  localPathDefault,
  localPathPlaceholder,
  inputs,
  image,
  slots,
  slotsError,
  supportedGPUs,
  clusterGPUs,
  gpuResources,
  capacity,
  cache,
  // Upgrade locks the namespace: it names the helm release being upgraded, and
  // changing it does not move the release, it installs a second one.
  lockIdentity = false,
  // Rollback shows the form and lets nothing be typed into it: it re-applies an
  // archived plan verbatim, so an editable field beside it would promise a
  // change that the rollback would then not make.
  readOnly = false,
  remember,
  onRemember,
  presets,
}: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  cluster?: ClusterInfo;
  serviceIdPlaceholder?: string;
  // What the site's template resolves to for this model, and the template
  // itself for when it does not resolve. Only the first is a value Tab can fill
  // a field with.
  localPathDefault?: string;
  localPathPlaceholder?: string;
  inputs?: InputRow[];
  // The engine image the catalog pins, and what the site's mirror rewrites it
  // to. Equal when this site mirrors nothing, which is when there is no rewrite
  // to offer a choice about.
  image?: { catalog: string; site: string };
  // Every image the chart renders, from the compose dry run. Absent until that
  // returns; the engine row still shows from `image`.
  slots?: ImageSlot[];
  slotsError?: string;
  lockIdentity?: boolean;
  readOnly?: boolean;
  // Products the chosen variant declares, and those this cluster reports on
  // nodes of the variant's vendor. Every one of the second is offered; one the
  // first does not name is marked, and selecting it is a forced deploy.
  supportedGPUs?: string[];
  clusterGPUs?: string[];
  // The resources the site lists for the variant's vendor, its default first;
  // absent for a variant without GPUs or a profile this page cannot read.
  gpuResources?: string[];
  // What the picked resource and products can land on; absent without GPUs.
  capacity?: CapacityProps;
  cache?: CacheCard;
  // Which typed answers to save to the site profile once the deploy applies; absent where it cannot be saved.
  remember?: Record<string, boolean>;
  onRemember?: (key: string, on: boolean) => void;
  // The site profile's presets, on a deploy.
  presets?: Record<string, Preset>;
}) {
  const checked = useDebounced(form.inputs, CHECK_MS);
  const picked = presets?.[form.preset];
  const set =
    (k: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ [k]: e.target.value } as Partial<Form>);
  const toggle = (k: keyof Form) => (v: boolean) => onChange({ [k]: v } as Partial<Form>);
  // Replica counts: a digit that is not typed cannot be negative, so the field
  // refuses the sign rather than a submit refusing the form.
  const count =
    (k: "replicaCount" | "scalerMin" | "scalerMax") => (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ [k]: e.target.value.replace(/\D/g, "") } as Partial<Form>);
  const on = effective(form);

  return (
    // One disabled fieldset rather than a disabled prop threaded through every
    // control: the browser already disables everything inside one, and a form
    // that is read-only in fifteen places is read-only in fourteen after the
    // next field is added.
    <fieldset disabled={readOnly} className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deploy settings</CardTitle>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "What this revision ran with, exactly as it ran. A rollback re-applies it verbatim — to change any of it, upgrade instead."
              : "Engine flags, probes and the image come from the catalog. Pick another variant to change those."}
          </p>
        </CardHeader>
        {/* One label column for every row, toggles included. Mixing
            label-above fields with label-beside checkboxes gives a form three
            alignment axes and no two rows that line up. */}
        {/* One label column for every row, switches included. Guidance lives
            in the box it applies to; the label carries the longer note for the
            rows whose control is a switch and has no box to put it in. */}
        {/* One label column for every row, switches included. Guidance lives
            in the box it applies to; the label carries the longer note for the
            rows whose control is a switch and has no box to put it in. */}
        <CardContent className="divide-y pt-0">
          {/* Locked on an upgrade, like the namespace: the route, the scaler
              and the SLO are all named after it, and changing it renames none
              of them -- helm renders a second set and orphans the first. The
              server refuses it either way; disabling the box is so nobody
              types a rename and reads the refusal as a bug. */}
          <Row
            label="Service ID"
            note={
              lockIdentity
                ? "fixed for the life of the release: the route, the scaler and the SLO are named after it"
                : "names the helm release, the route, the scaler and the SLO"
            }
          >
            <Suggest
              value={form.serviceId}
              onChange={(v) => onChange({ serviceId: v })}
              disabled={lockIdentity}
              suggestion={serviceIdPlaceholder}
              placeholder={serviceIdPlaceholder}
            />
          </Row>

          {/* The path and the switch that publishes it are one decision: a
              path typed under a disabled switch published nothing. */}
          <Row
            label="Route path"
            note="publishes a modelRoute to openresty and the monitor"
            toggle={
              <Switch
                checked={on.modelRoute}
                onChange={(v) =>
                  onChange(v ? { modelRoute: true } : { modelRoute: false, route: "" })
                }
                label="publish a route"
              />
            }
          >
            {on.modelRoute && (
              <PathInput
                value={form.route}
                onChange={(v) => onChange({ route: v })}
                suggestion={form.serviceId}
                placeholder={form.serviceId || "the service ID"}
              />
            )}
          </Row>

          <Row label="Model path" note="overrides the site's path template">
            <Suggest
              value={form.localPath}
              onChange={(v) => onChange({ localPath: v })}
              suggestion={localPathDefault}
              placeholder={localPathDefault ?? localPathPlaceholder}
            />
          </Row>

          {inputs?.map((row) => {
            const { input, answer, from, choices, site } = row;
            const value = form.inputs[input.key] ?? "";
            const typed = checked[input.key] ?? "";
            const error = inputError({ input, answer }, typed);
            const problem = error === "required" ? "required" : error && inputProblem(input, typed.trim() || answer || "");
            return (
              <Row
                key={input.key}
                label={input.title}
                note={
                  from === "release"
                    ? "the release's answer, kept unless you change it"
                    : from === "site"
                      ? "the site profile's answer, unless you change it"
                      : from === "variant"
                        ? "the variant's default, unless you change it"
                        : "unanswered: the variant has no default, and the site profile no answer"
                }
                hint={input.description ? `${input.description} (${input.key})` : input.key}
                aside={`e.g. ${String(input.example)}`}
              >
                <div className="min-w-0 flex-1">
                  <Suggest
                    value={value}
                    onChange={(v) => onChange({ inputs: { ...form.inputs, [input.key]: v } })}
                    suggestion={answer}
                    placeholder={answer}
                    invalid={!!error}
                    choices={choices?.map((c) => ({ value: c.answer, label: FROM[c.from] }))}
                  />
                  {problem && <p className="mt-1 text-[11px] text-destructive">{problem}</p>}
                  {remember && onRemember && rememberable(row, typed) && (
                    <label className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input type="checkbox" className="size-3.5 accent-primary" checked={!!remember[input.key]} onChange={(e) => onRemember(input.key, e.target.checked)} />
                      <HoverHint text="Every variant that declares this key, for any model, will take it.">
                        <span>Save to the site profile</span>
                      </HoverHint>
                      {site && <span className="break-all">· replaces the site's answer {site.written}</span>}
                    </label>
                  )}
                </div>
              </Row>
            );
          })}

          <Row
            label="Autoscale"
            note="on by default — an LLMScaler owns the replica count between min and max; empty keeps the chart's bounds"
            toggle={
              <Switch checked={form.scaler} onChange={toggle("scaler")} label="autoscale" />
            }
          >
            {form.scaler ? (
              <div className="flex w-full min-w-0 items-center gap-2">
                <Input
                  value={form.scalerMin}
                  onChange={count("scalerMin")}
                  inputMode="numeric"
                  aria-label="minimum replicas"
                  placeholder="min"
                  className="min-w-0 flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground">to</span>
                <Input
                  value={form.scalerMax}
                  onChange={count("scalerMax")}
                  inputMode="numeric"
                  aria-label="maximum replicas"
                  placeholder="max"
                  className="min-w-0 flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground">replicas</span>
              </div>
            ) : (
              <Input
                value={form.replicaCount}
                onChange={count("replicaCount")}
                inputMode="numeric"
                aria-label="replicas"
                placeholder="replicas"
              />
            )}
          </Row>

          <Row
            label="Namespace"
            note={lockIdentity ? "moving a release between namespaces installs a second one" : undefined}
          >
            <Suggest
              value={form.namespace}
              onChange={(v) => onChange({ namespace: v })}
              disabled={lockIdentity}
              suggestion={cluster?.namespace}
              placeholder={cluster?.namespace ?? "the site profile's"}
            />
          </Row>

          {/* Sent twice: applyFlags.createNamespace with the install, and the
              deprecated createNamespace composed into the plan, which renders
              as helmDefaults.createNamespace in its helmfile. A swissd older
              than applyFlags reads only the second.

                Hidden on an upgrade: the live release is in that namespace already.
              */}
          {!lockIdentity && (
            <Row
              label="Create namespace"
              note="helm creates it during install — helmDefaults.createNamespace in the plan's helmfile"
              toggle={
                <Switch
                  checked={form.createNamespace}
                  onChange={(v) => onChange({ createNamespace: v })}
                  label="create the namespace"
                />
              }
            />
          )}

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Routing options</CardTitle>
          <p className="text-sm text-muted-foreground">
            SLO-first latency and throughput: LLMSLORequirement declares ttft_metrics / tps_metrics for openresty.
            Static TTFT/TPS limits are fallback when nothing is declared. Empty number fields leave the chart default.
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          <Row
            label="Expose routed peer"
            note="echoes the chosen backend as X-Routed-Peer — chart default on"
            toggle={
              <Switch
                checked={form.exposeRoutedPeer}
                onChange={toggle("exposeRoutedPeer")}
                label="expose routed peer"
              />
            }
          />

          <Row
            label="Backend concurrency"
            note="per-backend peer max concurrency — empty keeps the chart default"
          >
            <Input
              value={form.backendMaxConcurrency}
              onChange={set("backendMaxConcurrency")}
              inputMode="numeric"
              aria-label="backend concurrency"
              placeholder="omit"
            />
          </Row>

          <Row
            label="CART"
            note="Cache-aware router"
            toggle={
              <Switch checked={form.cart} onChange={toggle("cart")} label="CART" />
            }
          />

          <Row
            label="CART max load"
            note={
              form.cart
                ? "per-worker max load — empty keeps the chart default"
                : "enable CART to edit"
            }
            muted={!form.cart}
          >
            <Input
              value={form.cartMaxLoad}
              onChange={set("cartMaxLoad")}
              inputMode="numeric"
              aria-label="CART max load"
              placeholder="omit"
              disabled={!form.cart}
            />
          </Row>

          <Row
            label="SLO requirement"
            note="primary — LLMSLORequirement declares ttft_metrics / tps_metrics for openresty (beats static limits)"
            hint="Primary source for TTFT/TPS decisions. openresty priority: declared metrics (from this CR) > runtime override > static ttft_limit_ms / tps_limit_tps"
            caption="primary — declares ttft_metrics / tps_metrics for openresty"
            toggle={
              <Switch checked={form.slo} onChange={toggle("slo")} label="SLO requirement" />
            }
          />

          <Row
            label={form.slo ? "TTFT limit (fallback)" : "TTFT limit (ms)"}
            note={
              form.slo
                ? "static fallback — ttft_limit_ms only when SLO declares no ttft_metrics; empty omits"
                : "static threshold (SLO off) — empty omits"
            }
            hint={
              form.slo
                ? "Emergency static fallback. openresty: declared ttft_metrics > override > static ttft_limit_ms. Editable while SLO is on for bare-metal / no-metrics cases."
                : "Primary static TTFT threshold while SLO is off (no LLMSLORequirement → no declared metrics)."
            }
            caption={
              form.slo
                ? "static fallback when no declared ttft_metrics"
                : "static threshold — SLO is off"
            }
          >
            <Input
              value={form.ttftLimitMs}
              onChange={set("ttftLimitMs")}
              inputMode="numeric"
              aria-label="TTFT limit ms"
              placeholder="omit"
            />
          </Row>

          <Row
            label={form.slo ? "TPS limit (fallback)" : "TPS limit (tok/s)"}
            note={
              form.slo
                ? "static fallback — tps_limit_tps only when SLO declares no tps_metrics; empty omits"
                : "static threshold (SLO off) — empty omits"
            }
            hint={
              form.slo
                ? "Emergency static fallback. openresty: declared tps_metrics > override > static tps_limit_tps. AIMD (Adaptive concurrency) also reads the effective TPS threshold."
                : "Primary static TPS threshold while SLO is off (no LLMSLORequirement → no declared metrics)."
            }
            caption={
              form.slo
                ? "static fallback when no declared tps_metrics"
                : "static threshold — SLO is off"
            }
          >
            <Input
              value={form.tpsLimitTps}
              onChange={set("tpsLimitTps")}
              inputMode="numeric"
              aria-label="TPS limit tok/s"
              placeholder="omit"
            />
          </Row>

          <Row
            label="Adaptive concurrency"
            note="AIMD on the effective TPS signal — defaults on; stays next to TPS"
            toggle={
              <Switch
                checked={form.adaptiveCc}
                onChange={(v) =>
                  onChange(v ? { adaptiveCc: true } : { adaptiveCc: false, adaptiveCcMinFrac: "" })
                }
                label="adaptive concurrency"
              />
            }
          />

          {/* The floor, as a fraction of the static peer max. The absolute
              floor is the other half of the same decision and lives in Added
              settings: one of the two is usually enough, and this is the one
              that applies when neither is set. */}
          <Row
            label="Adaptive floor fraction"
            note={
              !form.adaptiveCc
                ? "enable Adaptive concurrency to edit"
                : fracOutOfRange(form.adaptiveCcMinFrac)
                  ? "must be over 0 and at most 1 — openresty ignores anything else"
                  : extraValue(form, "adaptive_cc_min")
                    ? "unused while Adaptive floor is set"
                    : "adaptive_cc_min_frac — empty leaves openresty's 0.4"
            }
            hint={
              form.adaptiveCc
                ? "adaptive_cc_min_frac — the floor as a fraction of the static peer max, used only when the absolute Adaptive floor is unset. 0 < frac <= 1; openresty's default is 0.4, so a route switching to adaptive drops to 40% of static capacity and climbs back at about +2%/20s. Out of range is not an error there: it logs and silently uses 0.4."
                : "enable Adaptive concurrency to edit"
            }
            muted={!form.adaptiveCc || !!extraValue(form, "adaptive_cc_min")}
          >
            <Input
              value={form.adaptiveCcMinFrac}
              onChange={set("adaptiveCcMinFrac")}
              inputMode="decimal"
              aria-label="adaptive floor fraction"
              placeholder="0.4"
              disabled={!form.adaptiveCc}
            />
          </Row>

          {form.nginxExtras.map((row, i) => (
            <ExtraRow
              key={`${row.key}-${i}`}
              row={row}
              adaptiveOn={form.adaptiveCc}
              onChange={(value) =>
                onChange({
                  nginxExtras: form.nginxExtras.map((r, j) => (j === i ? { ...r, value } : r)),
                })
              }
              onRemove={() =>
                onChange({ nginxExtras: form.nginxExtras.filter((_, j) => j !== i) })
              }
            />
          ))}

          <AddSetting
            taken={form.nginxExtras.map((r) => r.key)}
            used={NAMED_VALUES.size + form.nginxExtras.length}
            onAdd={(key) =>
              onChange({
                nginxExtras: [...form.nginxExtras, { key, value: initialValue(key) }],
              })
            }
          />

          <Row
            label="Monitor"
            note="writes backends into monitor's config"
            toggle={
              <Switch
                checked={form.monitor}
                onChange={toggle("monitor")}
                label="monitor"
              />
            }
          />

          <Row
            label="Monitor model"
            note={
              form.monitor
                ? "served-model-name on monitor service rows — empty uses chart default (model.name / serviceId)"
                : "enable Monitor to edit"
            }
            hint={
              form.monitor
                ? "modelRoute.monitor.model — ConfigMap is keyed per model, not route; two releases sharing this value clobber each other's row. Empty omits; chart defaults to model.name."
                : "enable Monitor to edit"
            }
            muted={!form.monitor}
          >
            <Input
              value={form.monitorModel}
              onChange={set("monitorModel")}
              aria-label="monitor model"
              placeholder="omit"
              disabled={!form.monitor}
            />
          </Row>

          <Row
            label="Monitor GPU type"
            note={
              form.monitor
                ? "gpu_type on monitor service rows — empty lets autoconfig derive from node GPU label"
                : "enable Monitor to edit"
            }
            muted={!form.monitor}
          >
            <Suggest
              value={form.monitorGpuType}
              onChange={(v) => onChange({ monitorGpuType: v })}
              placeholder="omit"
              disabled={!form.monitor}
            />
          </Row>
        </CardContent>
      </Card>

      {/* Folded away, but every flag is still written into the plan either
          way -- a section nobody opens must not hand the decision back to a
          chart default. */}
      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Advanced
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y border-t px-4">
          <Row
            label="ServiceMonitor"
            note="Prometheus metrics scraped alongside the release"
            toggle={
              <Switch
                checked={form.serviceMonitor}
                onChange={toggle("serviceMonitor")}
                label="ServiceMonitor"
              />
            }
          />

          {gpuResources && (
            <Row
              label="GPU resource"
              note={gpuResources.length > 1 ? "the extended resource pods request; auto takes the one the products' nodes report" : "the only one the site lists for this vendor"}
            >
              {gpuResources.length > 1 ? (
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 font-mono text-xs"
                  value={form.gpuResource}
                  onChange={(e) => onChange({ gpuResource: e.target.value })}
                  aria-label="GPU resource"
                >
                  <option value="">auto · default {gpuResources[0]}</option>
                  {[...new Set([...gpuResources, form.gpuResource].filter(Boolean))].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : gpuResources.length === 1 ? (
                <span className="font-mono text-xs text-muted-foreground">{gpuResources[0]}</span>
              ) : (
                <span className="text-xs text-warning">the site profile lists no GPU resource for this vendor</span>
              )}
            </Row>
          )}
          <Row label="GPU product" note="restricts scheduling to these products; any one will do">
            <Products
              selected={form.gpuProducts}
              onChange={(v) => onChange({ gpuProducts: v })}
              options={productChoices(supportedGPUs, clusterGPUs, form.gpuProducts)}
              listed={supportedGPUs}
            />
          </Row>
          {capacity && (
            <Row label="On this cluster" note="nodes with this resource and product, and what is free on them">
              <CapacityLine {...capacity} />
            </Row>
          )}
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
          <Row label="Tolerations" note="lets this deploy land on tainted GPU nodes">
            <Tolerations
              rows={form.tolerations}
              onChange={(v) => onChange({ tolerations: v })}
            />
          </Row>
          {form.affinity.length > 0 && (
            <Row label="Affinity" note="exactly as this release's form values set it; edit or remove each rule">
              <AffinityRules rules={form.affinity} onChange={(affinity) => onChange({ affinity })} />
            </Row>
          )}
          <Row label="Priority class">
            <Suggest
              value={form.priorityClassName}
              onChange={(v) => onChange({ priorityClassName: v })}
              suggestion={cluster?.priorityClassName}
              placeholder={cluster?.priorityClassName ?? "the chart's default"}
            />
          </Row>
          <Row label="Scheduler">
            <Suggest
              value={form.schedulerName}
              onChange={(v) => onChange({ schedulerName: v })}
              suggestion={cluster?.schedulerName}
              placeholder={cluster?.schedulerName ?? "the chart's default"}
            />
          </Row>
          {cache && (
            <Row
              label="Compile cache"
              note="keeps compiled kernels on the node, so a restarted pod skips the 20–40 minute recompile; empty fields keep the site's, else the chart's. Off writes nothing, so a site that turns it on still applies: set cache.enabled: false in the plan editor to force it off"
              caption={unsupportedCaption(cache)}
              muted={!!cache.unsupported}
              toggle={
                <Switch
                  checked={!cache.unsupported && form.cache}
                  onChange={toggle("cache")}
                  label="compile cache"
                  disabled={!!cache.unsupported}
                />
              }
            >
              {!cache.unsupported && form.cache && <CacheFields form={form} onChange={onChange} defaults={cache.defaults} />}
            </Row>
          )}

        </div>

      </details>

      <ImagesSection form={form} onChange={onChange} image={image} slots={slots} error={slotsError} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan editor</CardTitle>
          <p className="text-sm text-muted-foreground">
            Any values key, applied after every layer and exempt from layer ownership. Shown as
            its own <span className="font-medium">edit</span> layer in the composed plan, so it
            is never invisible.
          </p>
        </CardHeader>
        <CardContent>
          <textarea
            value={form.edits}
            onChange={set("edits")}
            spellCheck={false}
            rows={10}
            placeholder={EDITS_PLACEHOLDER}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
          />
        </CardContent>
      </Card>
    </fieldset>
  );
}

// Three columns: label, switch, control. The switch column is reserved so a
// switch beside an input never shoves that input sideways. Every box fills
// the control column, so they share one left edge and one right edge.
function Row({
  label,
  note,
  hint,
  caption,
  aside,
  toggle,
  children,
  muted,
}: {
  label: string;
  // Muted text after the label's hint icon, e.g. an input's example.
  aside?: string;
  note?: string;
  // Longer hover text when note stays short (or when note is absent).
  hint?: string;
  // Optional visible subline under the label (Routing SLO/fallback rows).
  caption?: string;
  toggle?: React.ReactNode;
  children?: React.ReactNode;
  muted?: boolean;
}) {
  // undefined children = switch-only row: put the switch in the control
  // column so it shares a start edge with number inputs. false/element means
  // the row owns a control slot (even when conditionally empty), so the switch
  // stays in its reserved column and does not jump when the input appears.
  const hasControl = children !== undefined;
  return (
    <div
      className={cn(
        "relative grid gap-x-3 gap-y-1 py-2.5 hover:z-30 sm:grid-cols-[11rem_3rem_minmax(0,1fr)] sm:items-center",
      )}
    >
      <div className={cn("min-w-0", muted && "opacity-60")}>
        <HoverHint text={hint ?? note}>
          <span className={cn("text-sm font-medium", label.includes("(fallback)") && "text-warning")}>
            {label}
          </span>
        </HoverHint>
        {aside && <span className="ml-1.5 break-all text-xs text-muted-foreground">{aside}</span>}
        {caption ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{caption}</p>
        ) : null}
      </div>
      <div className="flex min-h-9 items-center">{hasControl ? toggle : null}</div>
      <div className={cn("flex min-h-9 min-w-0 items-center", muted && "opacity-60")}>
        {hasControl ? children : toggle}
      </div>
    </div>
  );
}

function imagePatch(form: Form, path: string, value: string): Partial<Form> {
  const images = { ...form.images, [path]: value };
  return path === "image" ? { image: value, images } : { images };
}

// One row per chart image. Empty leaves the value to whichever layer set it;
// a typed ref is the form layer. The engine row keeps the mirror choice.
function ImagesSection({
  form,
  onChange,
  image,
  slots,
  error,
}: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  image?: { catalog: string; site: string };
  slots?: ImageSlot[];
  error?: string;
}) {
  const rows = imageRows(slots, image);
  if (!rows.length && !error) return null;
  const edited = (path: string) => (path === "image" ? form.image : (form.images[path] ?? ""));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Images</CardTitle>
        <p className="text-sm text-muted-foreground">
          Each row is a values path. Empty leaves that image to the layer named beside it; a value is written on the form layer.
        </p>
      </CardHeader>
      <CardContent className="divide-y pt-0">
        {error && <p className="py-2 text-xs text-warning">{error}</p>}
        {rows.map((slot) => {
          const value = edited(slot.path);
          return (
            <Row key={slot.path} label={slot.path} caption={`set by ${slot.layer}`}>
              <div className="w-full min-w-0 space-y-1.5 py-1">
                {slot.value && slot.value !== value.trim() && (
                  <div className="truncate font-mono text-xs text-muted-foreground" title={slot.value}>
                    {slot.value}
                  </div>
                )}
                <Input
                  value={value}
                  onChange={(e) => onChange(imagePatch(form, slot.path, e.target.value))}
                  placeholder={slot.value || "repository:tag"}
                  aria-label={slot.path}
                  className="font-mono text-xs"
                />
                {slot.path === "image" && image && (
                  <ImageSource image={image} value={value} onPick={(v) => onChange(imagePatch(form, "image", v))} />
                )}
              </div>
            </Row>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ImageSource({ image, value, onPick }: { image: { catalog: string; site: string }; value: string; onPick: (ref: string) => void }) {
  const choices = imageChoices(image);
  if (!choices.length) return null;
  const selected = choices.find((c) => c.ref === value.trim())?.ref ?? "";
  return (
    <SourceSelect
      ariaLabel="engine image source"
      value={selected}
      onChange={onPick}
      options={choices.map((c) => ({ value: c.ref, label: c.key === "site" ? "site mirror" : "catalog original" }))}
      emptyLabel={value.trim() ? "custom" : "inherited"}
    />
  );
}

function unsupportedCaption(c: CacheCard): string | undefined {
  const u = c.unsupported;
  if (!u?.chart) return undefined;
  const why = u.since ? `not supported by the ${u.chart} chart before ${u.since}` : `not supported by the ${u.chart} chart`;
  return c.siteOn ? `${why}: the site turns it on, so the plan still carries the site's cache values, which this chart's schema refuses. Turn on Skip values schema beside the dry run to deploy` : why;
}

function CacheFields({ form, onChange, defaults }: { form: Form; onChange: (patch: Partial<Form>) => void; defaults: CacheDefaults }) {
  const digits = (k: "cacheHistoryLimit" | "cacheMaxSlots") => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [k]: e.target.value.replace(/\D/g, "") });
  const field = (label: string, control: React.ReactNode, error?: string) => (
    <label className="min-w-0 space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {control}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </label>
  );
  return (
    <div className="my-1 grid w-full gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
      {field(
        "Host path",
        <Input value={form.cacheHostPath} onChange={(e) => onChange({ cacheHostPath: e.target.value })} placeholder={defaults.hostPath} className="font-mono text-xs" />,
      )}
      {field(
        "Subdirectory",
        <Input value={form.cacheHostPathSuffix} onChange={(e) => onChange({ cacheHostPathSuffix: e.target.value })} placeholder="the model name" className="font-mono text-xs" />,
      )}
      {field(
        "Templates kept",
        <Input value={form.cacheHistoryLimit} onChange={digits("cacheHistoryLimit")} inputMode="numeric" placeholder={String(defaults.historyLimit)} />,
        cacheFieldError("historyLimit", form.cacheHistoryLimit) ? "at least 1" : undefined,
      )}
      {field(
        "Pods per node",
        <Input value={form.cacheMaxSlots} onChange={digits("cacheMaxSlots")} inputMode="numeric" placeholder={String(defaults.maxSlotsPerNode)} />,
        cacheFieldError("maxSlotsPerNode", form.cacheMaxSlots) ? "1 to 64" : undefined,
      )}
    </div>
  );
}

const TOLERATION_FIELDS = ["key", "operator", "value", "effect"];

// What a toleration's row shows. An operator left out is Equal, as Kubernetes reads it.
function tolerationRow(r: Record<string, unknown>): Toleration {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return { key: str(r.key), operator: r.operator === "Exists" ? "Exists" : "Equal", value: str(r.value), effect: str(r.effect), raw: r };
}

// The keys of a deployed toleration no row field shows, as "k: v".
export function tolerationExtras(t: Toleration): string[] {
  return Object.entries(t.raw ?? {})
    .filter(([k]) => !TOLERATION_FIELDS.includes(k))
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

function tolerationsOf(o: Record<string, unknown>): Toleration[] {
  if (!Array.isArray(o.tolerations)) return [];
  return o.tolerations.flatMap((t): Toleration[] => (t && typeof t === "object" && !Array.isArray(t) ? [tolerationRow(t as Record<string, unknown>)] : []));
}

// A row with no key is a half-typed one, unless it is a deployed toleration
// that has none: that one tolerates every taint.
function tolerationValue(t: Toleration): Record<string, unknown> | undefined {
  const raw = t.raw;
  if (raw) {
    const was = tolerationRow(raw);
    if (TOLERATION_FIELDS.every((k) => was[k as keyof Toleration] === t[k as keyof Toleration])) return raw;
  }
  const key = t.key.trim();
  if (!key && !(raw && !raw.key)) return undefined;
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(raw ?? {}).filter(([k]) => !TOLERATION_FIELDS.includes(k)));
  if (key) out.key = key;
  out.operator = t.operator;
  if (t.operator === "Equal" && t.value.trim()) out.value = t.value.trim();
  if (t.effect) out.effect = t.effect;
  return out;
}

// The products sit in a required nodeAffinity term under a vendor-specific
// label key, so match the key by suffix rather than guessing the vendor.
function gpuProductsOf(o: Record<string, unknown>): string[] {
  const dig = (v: unknown, k: string): unknown =>
    v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  const req = dig(
    dig(o.affinity, "nodeAffinity"),
    "requiredDuringSchedulingIgnoredDuringExecution",
  );
  const terms = dig(req, "nodeSelectorTerms");
  if (!Array.isArray(terms)) return [];
  for (const term of terms) {
    const exprs = dig(term, "matchExpressions");
    if (!Array.isArray(exprs)) continue;
    for (const e of exprs) {
      const key = dig(e, "key");
      const vals = dig(e, "values");
      if (
        typeof key === "string" &&
        PRODUCT_KEY.test(key) &&
        Array.isArray(vals)
      ) {
        return vals.filter((v): v is string => typeof v === "string");
      }
    }
  }
  return [];
}

// Tab fills an empty field with the default it is showing, the way a shell
// completes: the field is no longer empty afterwards, so the next Tab moves on.
function accept(
  e: React.KeyboardEvent,
  suggestion: string | undefined,
  onChange: (v: string) => void,
) {
  if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !suggestion) return;
  e.preventDefault();
  onChange(suggestion);
}

function useSuggestion(value: string, suggestion?: string, disabled?: boolean) {
  const [focused, setFocused] = useState(false);
  const offer = !value && !disabled ? suggestion : undefined;
  return {
    offer,
    hint: !!offer && focused,
    focus: { onFocus: () => setFocused(true), onBlur: () => setFocused(false) },
  };
}

function TabHint() {
  return (
    <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1 py-px text-[10px] leading-none text-muted-foreground">
      tab
    </kbd>
  );
}

const FROM: Record<InputChoice["from"], string> = { release: "Release", site: "Site profile", variant: "Variant default" };

// choices list under the field when the empty field is clicked; typing closes the list.
function Suggest({
  value,
  onChange,
  suggestion,
  placeholder,
  disabled,
  invalid,
  choices,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestion?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  choices?: { value: string; label: string }[];
}) {
  const s = useSuggestion(value, suggestion, disabled);
  const [listed, setListed] = useState(false);
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setListed(false);
          accept(e, s.offer, onChange);
        }}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn(s.hint && "pr-11", invalid && "border-destructive")}
        onFocus={s.focus.onFocus}
        onBlur={() => {
          s.focus.onBlur();
          setListed(false);
        }}
        onClick={() => setListed(!!choices?.length && !value)}
      />
      {s.hint && <TabHint />}
      {listed && !value && choices && (
        <div role="listbox" className="absolute top-full right-0 left-0 z-50 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {choices.map((c) => (
            // mousedown, not click: the field keeps focus, and its blur does not close the list first.
            <button
              key={c.label}
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c.value);
                setListed(false);
              }}
            >
              <span className="min-w-0 flex-1 font-mono text-xs break-all">{c.value}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The slash is drawn, never stored: the chart wants the path without it, and a
// leading one typed or pasted here is stripped rather than sent.
function PathInput({
  value,
  onChange,
  suggestion,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestion?: string;
  placeholder?: string;
}) {
  const s = useSuggestion(value, suggestion);
  return (
    <div className="relative flex h-9 min-w-0 flex-1 items-center rounded-md border bg-background pl-3 focus-within:outline-2 focus-within:outline-offset-1">
      <span className="select-none text-sm text-muted-foreground">/</span>
      <input
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground",
          s.hint && "pr-11",
        )}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/^\/+/, ""))}
        onKeyDown={(e) => accept(e, s.offer, onChange)}
        placeholder={placeholder}
        {...s.focus}
      />
      {s.hint && <TabHint />}
    </div>
  );
}


function nginxValuesMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined || val === null) continue;
    out[key] = String(val);
  }
  return out;
}

function backendMaxConcurrencyOf(v: unknown): string {
  if (!Array.isArray(v)) return "";
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    if (row.use === "backend" && row.maxConcurrency !== undefined && row.maxConcurrency !== null) {
      return String(row.maxConcurrency);
    }
  }
  return "";
}

function truthyStr(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v !== "false" && v !== "0";
}

const EFFECTS = ["", "NoSchedule", "PreferNoSchedule", "NoExecute"];

// Structured rows rather than a YAML box: a toleration is four fields, and
// three of them are closed sets.
function Tolerations({
  rows,
  onChange,
}: {
  rows: Toleration[];
  onChange: (v: Toleration[]) => void;
}) {
  const patch = (i: number, p: Partial<Toleration>) =>
    onChange(rows.map((r, j) => (i === j ? { ...r, ...p } : r)));

  return (
    <div className="w-full space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            className="w-44"
            value={r.key}
            onChange={(e) => patch(i, { key: e.target.value })}
            placeholder={r.raw && !r.raw.key ? "every taint" : "taint key"}
            aria-label="taint key"
          />
          <Select
            value={r.operator}
            onChange={(v) => patch(i, { operator: v as Toleration["operator"] })}
            options={["Exists", "Equal"]}
            label="operator"
          />
          {r.operator === "Equal" && (
            <Input
              className="w-32"
              value={r.value}
              onChange={(e) => patch(i, { value: e.target.value })}
              placeholder="value"
              aria-label="taint value"
            />
          )}
          <Select
            value={r.effect}
            onChange={(v) => patch(i, { effect: v })}
            options={EFFECTS}
            label="effect"
            emptyLabel="any effect"
          />
          {tolerationExtras(r).map((x) => (
            <span key={x} className="font-mono text-xs text-muted-foreground">
              {x}
            </span>
          ))}
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label="remove toleration"
            className="text-sm text-muted-foreground hover:text-destructive"
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", operator: "Exists", value: "", effect: "" }])}
        className="text-sm text-muted-foreground underline hover:text-foreground"
      >
        Add toleration
      </button>
    </div>
  );
}

function AffinityRules({ rules, onChange }: { rules: AffinityRule[]; onChange: (v: AffinityRule[]) => void }) {
  const patch = (i: number, r: AffinityRule) => onChange(rules.map((x, j) => (i === j ? r : x)));
  return (
    <div className="w-full min-w-0 space-y-2 py-1">
      {rules.map((r, i) => (
        <div key={i} className={cn("rounded-md border p-2", r.drop && "opacity-50")}>
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {r.scope} · {listLabel(r.list)}
            </span>
            <button type="button" onClick={() => patch(i, { ...r, drop: !r.drop })} className="ms-auto shrink-0 text-muted-foreground hover:text-destructive">
              {r.drop ? "undo" : "remove"}
            </button>
          </div>
          <textarea
            value={r.text}
            onChange={(e) => patch(i, editRule(r, e.target.value))}
            disabled={r.drop}
            spellCheck={false}
            aria-label={`${r.scope} ${listLabel(r.list)} rule`}
            rows={Math.max(2, r.text.split("\n").length)}
            className={cn("mt-1 w-full rounded-md border bg-background px-2 py-1 font-mono text-[11px] leading-snug", r.drop && "line-through")}
          />
          {r.error && <p className="text-xs text-destructive">{r.error}</p>}
        </div>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
  emptyLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  emptyLabel?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || (emptyLabel ?? "any")}
        </option>
      ))}
    </select>
  );
}

// Products offers every card of the variant's vendor on this cluster, the ones
// the catalog lists first and the rest after an "unverified" mark: the catalog
// does not know what is racked here.
export interface CapacityProps {
  // Absent until the nodes are read.
  value?: GPUCapacity;
  perPod: number;
  needNodes: number;
  refreshing: boolean;
  onRefresh: () => void;
}

// Nodes and GPUs the picked resource and products can land on, total and free.
// No node is a resource and product that do not meet: the pods would stay Pending.
function CapacityLine({ value, perPod, needNodes, refreshing, onRefresh }: CapacityProps) {
  const short = !!value?.free && value.free.nodes < needNodes;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return (
    <div className="flex w-full items-center gap-2 text-xs">
      <span className={cn("flex-1", value && (value.nodes === 0 || short) ? "text-warning" : "text-muted-foreground")}>
        {!value ? (
          "nodes not read"
        ) : value.nodes === 0 ? (
          "no node has this resource and product: the pods would stay Pending"
        ) : (
          <>
            this resource and product: {plural(value.nodes, "node")} / {value.gpus} GPUs
            {" · "}
            {value.free ? (
              <span
                className="cursor-help underline decoration-dotted underline-offset-2"
                title={`Available: GPUs free on schedulable nodes, and the nodes among them with at least ${perPod} free, a pod's worth`}
              >
                available {plural(value.free.nodes, "node")} / {value.free.gpus} GPUs
              </span>
            ) : (
              "free GPUs unknown: the cluster-wide pod list is not readable"
            )}
            {short && ` · needs ${plural(needNodes, "available node")}`}
          </>
        )}
      </span>
      <button
        type="button"
        aria-label="refresh nodes"
        disabled={refreshing}
        onClick={onRefresh}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}

function Products({
  selected,
  onChange,
  options,
  listed,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  options: string[];
  listed?: string[];
}) {
  if (options.length === 0) {
    return (
      <span className="w-full text-xs text-muted-foreground">
        no GPU product reported by this cluster
      </span>
    );
  }
  const unverified = (o: string) => unlistedProducts(listed, [o]).length > 0;
  const supported = options.filter((o) => !unverified(o));
  const others = options.filter(unverified);
  const forced = unlistedProducts(listed, selected);
  const chip = (o: string) => {
    const active = selected.includes(o);
    const off = unverified(o);
    return (
      <button
        key={o}
        type="button"
        aria-pressed={active}
        title={off ? "unverified with this variant" : undefined}
        onClick={() => onChange(active ? selected.filter((p) => p !== o) : [...selected, o])}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
          !active && "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          active && !off && "border-success/40 bg-success/15 font-medium text-success",
          active && off && "border-warning/50 bg-warning/15 font-medium text-warning",
        )}
      >
        {active && off && <TriangleAlert className="size-3" />}
        {o}
      </button>
    );
  };
  return (
    <div className="w-full space-y-1.5">
      {/* Two units, so a wrap moves the label with its chips. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {supported.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5">{supported.map(chip)}</span>
        )}
        {others.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">unverified</span>
            {others.map(chip)}
          </span>
        )}
      </div>
      {forced.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          {forced.join(", ")} unverified with this variant, deployed as forced
        </p>
      ) : (
        selected.length === 0 && <p className="text-xs text-muted-foreground">none selected: any supported product</p>
      )}
    </div>
  );
}

const EDITS_PLACEHOLDER = `# last word, any key
nodeSelector:
  nvidia.com/gpu.product: NVIDIA-B300-SXM6-AC
tolerations:
  - key: gpu
    operator: Exists
    effect: NoSchedule
resources:
  limits:
    rdma/hca_shared: "1"
extraArgs:
  - --tp-size=4`;

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function extraValue(f: Form, key: string): string {
  return f.nginxExtras.find((r) => r.key === key)?.value.trim() ?? "";
}

// A boolean row is written out the moment it is added, at openresty's own
// default. A switch showing "off" for a key that defaults on, only because
// nothing has been typed yet, is the kind of quiet lie this card exists to
// avoid; everything else starts empty, which omits the key.
function initialValue(key: string): string {
  const d = DIRECTIVES_BY_KEY.get(key);
  if (d?.kind !== "boolean") return "";
  return d.fallback === "on" ? "true" : "false";
}

// One added setting. A key this build does not know still gets a row -- the
// values map is free-form by design, and a route carrying a knob newer than
// this UI must still be editable rather than invisible.
function ExtraRow({
  row,
  adaptiveOn,
  onChange,
  onRemove,
}: {
  row: { key: string; value: string };
  adaptiveOn: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const d = DIRECTIVES_BY_KEY.get(row.key);
  const label = d?.label ?? row.key;
  const idle = !!d?.needsAdaptive && !adaptiveOn;
  return (
    <Row
      label={label}
      note={
        idle
          ? `${row.key} — enable Adaptive concurrency for this to do anything`
          : `${row.key} — empty leaves ${d ? d.fallback : "openresty's default"}`
      }
      hint={d?.detail ?? `${row.key} — passed to openresty's route table untouched.`}
      muted={idle}
    >
      <div className="flex items-center gap-2">
        {d?.kind === "boolean" ? (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2.5">
            <Switch
              checked={row.value === "true"}
              onChange={(v) => onChange(v ? "true" : "false")}
              label={label}
            />
            <span className="text-sm text-muted-foreground">
              {row.value === "true" ? "on" : "off"}
            </span>
          </div>
        ) : (
          <Input
            value={row.value}
            onChange={(e) => onChange(e.target.value)}
            inputMode={d?.kind === "number" ? "decimal" : undefined}
            placeholder={d?.fallback ?? "value"}
            aria-label={label}
            className="min-w-0 flex-1"
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${label}`}
          className="size-8 shrink-0 px-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      </div>
    </Row>
  );
}

// The picker. Thirty knobs listed permanently would bury the five that are set
// on a normal route, so they live behind this: each one names what openresty
// does without it, because leaving it out is the usual right answer.
function AddSetting({
  taken,
  used,
  onAdd,
}: {
  taken: string[];
  used: number;
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const full = used >= MAX_VALUES;
  const customError = custom.trim() ? rejectKey(custom, taken) : "";

  const add = (key: string) => {
    onAdd(key);
    setCustom("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-3 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        disabled={full}
      >
        <Plus className="size-3.5" />
        Add setting
      </Button>
      <span className="text-xs text-muted-foreground">
        {full
          ? `${MAX_VALUES} values is the CRD's cap for one route`
          : `${used} of ${MAX_VALUES} route values used`}
      </span>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a route setting"
        subtitle="openresty's own tuning knobs, sent verbatim. Each says what happens without it — leaving one out is usually the right answer."
      >
        <div className="space-y-5">
          {directiveGroups().map((group) => {
            const rows = DIRECTIVES.filter((d) => d.group === group && !taken.includes(d.key));
            if (rows.length === 0) return null;
            return (
              <div key={group} className="space-y-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
                <div className="divide-y rounded-md border">
                  {rows.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      className="block w-full px-3 py-2.5 text-left hover:bg-muted/50"
                      onClick={() => add(d.key)}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{d.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">{d.key}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          without it: {d.fallback}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{d.detail}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* The map is free-form on purpose: openresty gains knobs without a
              chart change, and this build should not be what stops one being
              set. Only what the chain below refuses is refused here. */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Something else
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="openresty key, e.g. tps_min_tokens"
                aria-label="custom route setting key"
                className="min-w-0 flex-1 sm:max-w-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={!custom.trim() || !!customError}
                onClick={() => add(custom.trim())}
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            <p className={cn("text-xs leading-snug", customError ? "text-warning" : "text-muted-foreground")}>
              {customError || "Any key openresty's route factory reads. It reaches it untouched."}
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// The route values that have a row of their own. Everything else in the live
// route's map is an added row, so nothing a route carries goes unshown.
const NAMED_VALUES = new Set([
  "expose_routed_peer",
  "ttft_limit_ms",
  "tps_limit_tps",
  "adaptive_cc",
  "adaptive_cc_min_frac",
]);

// openresty refuses a fraction outside (0, 1] by logging and using its own
// default, which reads afterwards as a route silently sitting at 40% of static
// capacity with nothing saying why. Said here instead, where it can still be
// corrected.
function fracOutOfRange(raw: string): boolean {
  const s = raw.trim();
  if (s === "") return false;
  const n = Number(s);
  return !Number.isFinite(n) || n <= 0 || n > 1;
}

// imageOf pairs the image the catalog pins with the one the site mirrors it to,
// both as repository:tag. Undefined when the variant carries no image: there is
// then nothing to show and nothing to choose between.
//
// The site rewrites only the repository -- the tag is the catalog's, and is
// carried through -- so the same tag goes on both halves.
export function imageOf(
  variant?: Variant,
  mirrored?: Record<string, string>,
): { catalog: string; site: string } | undefined {
  const repo = variant?.image?.repository;
  if (!repo) return undefined;
  const tag = variant.image?.tag ?? "";
  return {
    catalog: joinImage(repo, tag),
    site: joinImage(mirrored?.[variant.id] ?? repo, tag),
  };
}

// imageChoices is what an override offers to fill in. None without a mirror:
// both would be the same image.
export function imageChoices(image: { catalog: string; site: string }): { key: "site" | "catalog"; ref: string }[] {
  return image.site === image.catalog ? [] : [{ key: "site", ref: image.site }, { key: "catalog", ref: image.catalog }];
}

export { splitImage } from "@swiss/lib/imageSlots";

// Naming a route turns routing on, so the toggle and the request cannot
// disagree about what this deploy is asking for.
export function effective(f: Form) {
  return { modelRoute: f.modelRoute || f.route.trim() !== "" };
}

export function planRequest(
  f: Form,
  opts: {
    model: string;
    version?: string;
    variant?: string;
    fromRelease?: string;
    catalog?: string;
    chartVersion?: string;
    // Accept gpuProducts the variant does not list; swissd still requires each
    // on this cluster under the variant's vendor.
    forceGpuProducts?: boolean;
    // The chart has no cache section (CHART_FEATURES): the switch is forced off.
    cacheUnsupported?: boolean;
    // To send the form's answers typed.
    inputs?: CatalogInput[];
    // The values of the preset f picks.
    preset?: Record<string, unknown>;
    // The release's form layer, on an upgrade: the form's values are put over
    // it, so the request carries the whole layer rebuilt.
    formLayer?: Record<string, unknown>;
    // Kinds from the last dry run, so a string slot is written as a string.
    // Without them the form layer's own shape decides, and a fresh deploy writes a map.
    imageSlots?: ImageSlotKind[];
    values?: Record<string, unknown>;
    siteEnv?: Record<string, unknown>;
  },
): PlanRequest {
  const overrides: Record<string, unknown> = {};
  const on = effective(f);

  // replicaCount and the scaler bounds are the same decision, so only the one
  // that applies is sent: a fixed count under a live scaler is two answers to
  // one question, and the scaler wins at a time nobody chose.
  if (f.scaler) {
    const scaler: Record<string, unknown> = { enabled: true };
    if (num(f.scalerMin) !== undefined) scaler.minReplicas = num(f.scalerMin);
    if (num(f.scalerMax) !== undefined) scaler.maxReplicas = num(f.scalerMax);
    overrides.scaler = scaler;
  } else {
    overrides.scaler = { enabled: false };
    if (num(f.replicaCount) !== undefined) overrides.replicaCount = num(f.replicaCount);
  }

  // Every flag is sent explicitly. Leaving one out would hand the decision to a
  // chart default, which is the thing this is here to avoid.
  overrides.cart = { enabled: f.cart };
  overrides.sloRequirement = { enabled: f.slo };
  overrides.serviceMonitor = { enabled: f.serviceMonitor };

  const route = f.route.trim();
  const modelRoute: Record<string, unknown> = { enabled: on.modelRoute };
  const nginx: Record<string, unknown> = {};
  if (route) nginx.route = route;

  const nginxValues: Record<string, string> = {
    expose_routed_peer: f.exposeRoutedPeer ? "true" : "false",
  };
  if (f.ttftLimitMs.trim()) nginxValues.ttft_limit_ms = f.ttftLimitMs.trim();
  if (f.tpsLimitTps.trim()) nginxValues.tps_limit_tps = f.tpsLimitTps.trim();
  nginxValues.adaptive_cc = f.adaptiveCc ? "true" : "false";
  if (f.adaptiveCc && f.adaptiveCcMinFrac.trim()) {
    nginxValues.adaptive_cc_min_frac = f.adaptiveCcMinFrac.trim();
  }
  // An added row with no value is a row somebody opened and left: the key is
  // omitted, which is what leaves openresty's own default in force. Adding the
  // row and clearing it is how a value is taken back off the route.
  for (const { key, value } of f.nginxExtras) {
    const k = key.trim();
    if (k && value.trim()) nginxValues[k] = value.trim();
  }
  nginx.values = nginxValues;

  const maxConc = num(f.backendMaxConcurrency);
  if (maxConc !== undefined) {
    // Lists replace, so keep the chart's two-tier shape and only change backend.
    nginx.peers = [
      { use: "backend", priority: 2, maxConcurrency: maxConc },
      { use: "backend-svc", priority: 1 },
    ];
  }
  if (Object.keys(nginx).length) modelRoute.nginx = nginx;

  const maxLoad = num(f.cartMaxLoad);
  if (f.cart && maxLoad !== undefined) modelRoute.cart = { maxLoad };

  // modelRoute.monitor.nginx / .router: chart values.schema.json allows
  // object|null only (not boolean). Chart defaults are null (= autoconfig
  // default on when nginx.service / cart are set). Omit those keys so helm
  // keeps null — do not write form booleans (deploy fails schema) and do not
  // invent an object shape the template does not consume.
  const monitor: Record<string, unknown> = { enabled: f.monitor };
  if (f.monitor && f.monitorModel.trim()) monitor.model = f.monitorModel.trim();
  if (f.monitor && f.monitorGpuType.trim()) monitor.gpuType = f.monitorGpuType.trim();
  modelRoute.monitor = monitor;

  overrides.modelRoute = modelRoute;

  // Only on, and only for a chart that has the section. Off writes nothing,
  // as a site with the cache off does; forcing it off over a site that turns
  // it on is cache.enabled: false in the plan editor.
  if (f.cache && !opts.cacheUnsupported) {
    const cache: Record<string, unknown> = { enabled: true };
    if (f.cacheHostPath.trim()) cache.hostPath = f.cacheHostPath.trim();
    if (f.cacheHostPathSuffix.trim()) cache.hostPathSuffix = f.cacheHostPathSuffix.trim();
    if (num(f.cacheHistoryLimit) !== undefined) cache.historyLimit = num(f.cacheHistoryLimit);
    if (num(f.cacheMaxSlots) !== undefined) cache.maxSlotsPerNode = num(f.cacheMaxSlots);
    overrides.cache = cache;
  }

  const tolerations = f.tolerations.flatMap((t) => tolerationValue(t) ?? []);
  if (tolerations.length || opts.formLayer?.tolerations !== undefined) overrides.tolerations = tolerations;

  // A typed ref is this deploy's form layer. An empty row is not an override;
  // on an upgrade it is a clear, so the release's copy of that path is dropped
  // before the overlay, the same way an emptied toleration list replaces the old one.
  applyImageEdits(overrides, f, opts.imageSlots, opts.formLayer);
  if (f.priorityClassName.trim()) overrides.priorityClassName = f.priorityClassName.trim();
  if (f.schedulerName.trim()) overrides.schedulerName = f.schedulerName.trim();

  setInputOverrides(overrides, opts.inputs, f.inputs);
  const siteEnv = envBase(opts.siteEnv);
  const preset = Object.keys(siteEnv).length ? (opts.preset ? withPreset(opts.preset, siteEnv) : siteEnv) : opts.preset;
  const base = opts.formLayer ? structuredClone(opts.formLayer) : undefined;
  if (base) dropClearedImages(base, f.image, f.images);
  const layer = withEnv(opts.values, withPreset(base ? overlay(base, overrides) : overrides, preset));
  setAffinity(layer, f.affinity, f.gpuProducts.length > 0);

  return {
    catalog: opts.catalog || undefined,
    model: opts.model,
    fromRelease: opts.fromRelease,
    chartVersion: opts.chartVersion || undefined,
    version: opts.version || undefined,
    editsYAML: f.edits.trim() || undefined,
    gpuProducts: f.gpuProducts.length ? f.gpuProducts : undefined,
    forceGpuProducts: f.gpuProducts.length > 0 && opts.forceGpuProducts ? true : undefined,
    gpuResource: f.gpuResource || undefined,
    variant: opts.variant || undefined,
    release: f.serviceId.trim() || undefined,
    namespace: f.namespace.trim() || undefined,
    // For a swissd older than applyFlags.
    createNamespace: f.createNamespace || undefined,
    serviceId: f.serviceId.trim() || undefined,
    localPath: f.localPath.trim() || undefined,
    overrides: layer,
  };
}

// applyFlags is what the diff and the apply of a plan composed from f send.
// forceConflicts is not the form's: the apply dialog adds it, after the diff.
export function applyFlags(f: Form): ApplyFlags | undefined {
  const flags: ApplyFlags = {};
  if (f.skipSchemaValidation) flags.skipSchemaValidation = true;
  if (f.createNamespace) flags.createNamespace = true;
  return Object.keys(flags).length ? flags : undefined;
}

// formFromPlan seeds the upgrade form from what a release was deployed with.
// The plan stores the composed overrides tree, not the form fields, so this is
// the inverse of planRequest -- and the pair is why an upgrade can show the
// settings rather than only promise it carried them forward.
export function formFromPlan(plan: Plan): Form {
  // The form's own document, not the composed result: an upgrade seeds from
  // what the operator set, so recomposing against a newer catalog keeps it.
  const o = (plan.layers?.form ?? {}) as Record<string, unknown>;
  const at = (path: string): unknown =>
    path.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, o);

  const str = (path: string) => {
    const v = at(path);
    return v === undefined || v === null ? "" : String(v);
  };
  const bool = (path: string, fallback = false) => {
    const v = at(path);
    return typeof v === "boolean" ? v : fallback;
  };
  const nv = nginxValuesMap(at("modelRoute.nginx.values"));
  // The engine stays on form.image. Every other image the form layer already set
  // is seeded so an upgrade shows it and sends it back; a clear is not seeded.
  const { image: seededImage, ...imageEdits } = imageEditsFromLayer(o);

  return {
    ...EMPTY,
    namespace: plan.release.namespace,
    serviceId: str("serviceId"),
    localPath: str("model.localPath"),
    scaler: bool("scaler.enabled"),
    scalerMin: str("scaler.minReplicas"),
    scalerMax: str("scaler.maxReplicas"),
    // The product sits under the vendor's own label key, so find it by suffix
    // rather than guessing which vendor this variant was built for.
    gpuProducts: gpuProductsOf(o),
    // The resource the release runs on, so an upgrade stays on it.
    gpuResource: String(((plan.layers?.derived?.model ?? {}) as Record<string, unknown>).gpuResource ?? ""),
    tolerations: tolerationsOf(o),
    affinity: affinityRules(o),
    replicaCount: str("replicaCount"),
    route: str("modelRoute.nginx.route"),
    image: seededImage ?? joinImage(str("image.repository"), str("image.tag")),
    images: imageEdits,
    cart: bool("cart.enabled", true),
    modelRoute: bool("modelRoute.enabled"),
    slo: bool("sloRequirement.enabled", true),
    serviceMonitor: bool("serviceMonitor.enabled"),
    priorityClassName: str("priorityClassName"),
    schedulerName: str("schedulerName"),
    exposeRoutedPeer: truthyStr(nv.expose_routed_peer, true),
    ttftLimitMs: nv.ttft_limit_ms ?? "",
    tpsLimitTps: nv.tps_limit_tps ?? "",
    adaptiveCc: truthyStr(nv.adaptive_cc, true),
    adaptiveCcMinFrac: nv.adaptive_cc_min_frac ?? "",
    // Whatever else the live route carries, named row or not: an upgrade has
    // to show what is set, including a key this build has never heard of.
    nginxExtras: Object.entries(nv)
      .filter(([k]) => !NAMED_VALUES.has(k))
      .map(([key, value]) => ({ key, value: String(value ?? "") })),
    backendMaxConcurrency: backendMaxConcurrencyOf(at("modelRoute.nginx.peers")),
    cartMaxLoad: str("modelRoute.cart.maxLoad"),
    monitor: bool("modelRoute.monitor.enabled", true),
    monitorModel: str("modelRoute.monitor.model"),
    monitorGpuType: str("modelRoute.monitor.gpuType"),
    // What the release ran with, which the site may have decided rather than
    // the form.
    cache: cacheOn(plan),
    cacheHostPath: str("cache.hostPath"),
    cacheHostPathSuffix: str("cache.hostPathSuffix"),
    cacheHistoryLimit: str("cache.historyLimit"),
    cacheMaxSlots: str("cache.maxSlotsPerNode"),
    // Per apply, so not on the plan: an upgrade that needs it asks again.
    skipSchemaValidation: false,
    edits:
      plan.layers?.edit && Object.keys(plan.layers.edit).length > 0
        ? toYaml(plan.layers.edit).trimEnd()
        : "",
  };
}

function cacheOn(plan: Plan): boolean {
  let on = false;
  for (const layer of layersOf(plan)) {
    const c = plan.layers[layer]?.cache;
    const v = c && typeof c === "object" ? (c as Record<string, unknown>).enabled : undefined;
    if (typeof v === "boolean") on = v;
  }
  return on;
}
