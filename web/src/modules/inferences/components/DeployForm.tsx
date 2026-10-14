import { useId, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  DataSelect,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldHint,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  FloatingField,
  FormSection,
  Input,
  Switch,
  cn,
} from "@modelsphere/ui";
import { Plus, X } from "lucide-react";
import type { ClusterInfo } from "@swiss/lib/api";
import { effective, type Form, type Toleration } from "@swiss/components/DeploySettings";
import { MAX_VALUES, rejectKey } from "@swiss/lib/routeDirectives";
import { FALLBACK_ROUTE_OPTIONS, routeDirectives, runtimeValue, type RouteDirective, type RouteOptions } from "@/modules/inferences/route-options";
import { useT } from "@/modules/inferences/i18n";
import { NAMED_VALUES, extraValue, fracOutOfRange, serviceIdError, type Section } from "@/modules/inferences/deploy-lib";

const EFFECTS = ["", "NoSchedule", "PreferNoSchedule", "NoExecute"];
const digits = (v: string) => v.replace(/\D/g, "");

export interface DeployFormProps {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  upgrade?: boolean;
  submitted: boolean;
  target: ReactNode;
  cluster?: ClusterInfo;
  defaults: { serviceId?: string; localPath?: string; localPathTemplate?: string; image?: { catalog: string; site: string } };
  gpuOptions: string[];
  expanded: Record<Section, boolean>;
  onExpand: (s: Section, open: boolean) => void;
  idPrefix: string;
  routeOptions?: RouteOptions | null;
  catalogRoute?: string;
}

export function DeployForm({ form, onChange, upgrade, submitted, target, cluster, defaults, gpuOptions, expanded, onExpand, idPrefix, routeOptions, catalogRoute }: DeployFormProps) {
  const t = useT();
  const on = effective(form);
  const f = (k: string) => t(`deploy.fields.${k}`);
  const byKey = new Map(routeDirectives(routeOptions).map((d) => [d.key, d]));
  const showRuntime = !!upgrade && routeOptions?.route === (catalogRoute ?? (form.route || form.serviceId));
  const label = (key: string, fallback: string) => directiveText(t, byKey.get(key), "label") || f(fallback);
  const hint = (key: string, fallback: string) => {
    const d = byKey.get(key);
    const detail = routeOptions ? directiveText(t, d, "detail") || f(fallback) : f(fallback);
    return showRuntime && d?.set !== undefined ? `${detail} · ${runtimeText(t, d)}` : detail;
  };
  const text = (k: keyof Form) => ({ value: form[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [k]: e.target.value }) });
  const count = (k: "replicaCount" | "scalerMin" | "scalerMax") => ({ value: form[k], inputMode: "numeric" as const, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: digits(e.target.value) }) });
  const sw = (k: keyof Form, label: string) => <Switch aria-label={label} checked={form[k] as boolean} onCheckedChange={(v) => onChange({ [k]: v })} />;
  const idError = submitted ? serviceIdError(form.serviceId || defaults.serviceId || "") : undefined;
  const section = (id: Section, children: ReactNode) => (
    <div id={`${idPrefix}${id}`}>
      <FormSection id={`${idPrefix}${id}-section`} title={t(`deploy.sections.${upgrade && id === "basic" ? "target" : id}`)} expanded={expanded[id]} onExpandedChange={(o) => onExpand(id, o)}>
        <div className="flex flex-col gap-3">{children}</div>
      </FormSection>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {section(
        "basic",
        <>
          {target}
          <FloatingField label={f("serviceId")} required hint={upgrade ? f("serviceIdLocked") : f("serviceIdHint")} error={idError && t(`deploy.errors.${idError}`)} disabled={upgrade}>
            <FieldInput {...text("serviceId")} placeholder={defaults.serviceId} disabled={upgrade} />
          </FloatingField>
          <FloatingField label={f("namespace")} hint={upgrade ? f("namespaceLocked") : undefined} disabled={upgrade}>
            <FieldInput {...text("namespace")} placeholder={cluster?.namespace} disabled={upgrade} />
          </FloatingField>
          {!upgrade && (
            <FloatingField layout="inline" label={f("createNamespace")} hint={f("createNamespaceHint")}>
              {sw("createNamespace", f("createNamespace"))}
            </FloatingField>
          )}
        </>,
      )}

      {section(
        "resources",
        <>
          <FloatingField
            layout="inline"
            label={f("scaler")}
            hint={f("scalerHint")}
            expanded={form.scaler}
            expandedContent={
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Input {...count("scalerMin")} placeholder={f("scalerMin")} aria-label={f("scalerMin")} />
                <Input {...count("scalerMax")} placeholder={f("scalerMax")} aria-label={f("scalerMax")} />
              </div>
            }
          >
            {sw("scaler", f("scaler"))}
          </FloatingField>
          {!form.scaler && (
            <FloatingField label={f("replicas")}>
              <FieldInput {...count("replicaCount")} />
            </FloatingField>
          )}
          <FloatingField label={f("gpuProducts")} hint={f("gpuProductsHint")}>
            <FieldSelect multiple values={form.gpuProducts} onValuesChange={(v) => onChange({ gpuProducts: v })} options={gpuOptions.map((o) => ({ value: o, label: o }))} placeholder={gpuOptions.length ? undefined : f("gpuProductsEmpty")} disabled={!gpuOptions.length} />
          </FloatingField>
          <Tolerations rows={form.tolerations} onChange={(v) => onChange({ tolerations: v })} />
          <div className="grid grid-cols-2 gap-3">
            <FloatingField label={f("priorityClass")}>
              <FieldInput {...text("priorityClassName")} placeholder={cluster?.priorityClassName || f("chartDefault")} />
            </FloatingField>
            <FloatingField label={f("scheduler")}>
              <FieldInput {...text("schedulerName")} placeholder={cluster?.schedulerName || f("chartDefault")} />
            </FloatingField>
          </div>
          <FloatingField label={f("localPath")} hint={f("localPathHint")}>
            <FieldInput {...text("localPath")} placeholder={defaults.localPath ?? defaults.localPathTemplate} />
          </FloatingField>
          {defaults.image && (
            <FloatingField
              layout="inline"
              label={f("image")}
              hint={f("imageHint")}
              expanded={!!form.image.trim()}
              expandedContent={
                <div className="pb-3">
                  <Input value={form.image} onChange={(e) => onChange({ image: e.target.value })} placeholder={defaults.image.site} className="font-mono text-xs" aria-label={f("imageValue")} />
                </div>
              }
            >
              <Switch aria-label={f("image")} checked={!!form.image.trim()} onCheckedChange={(v) => onChange({ image: v ? defaults.image!.site : "" })} />
            </FloatingField>
          )}
        </>,
      )}

      {section(
        "routing",
        <>
          <FloatingField
            layout="inline"
            label={f("modelRoute")}
            hint={f("modelRouteHint")}
            expanded={on.modelRoute}
            expandedContent={
              <div className="pb-3">
                <Input value={form.route} onChange={(e) => onChange({ route: e.target.value })} placeholder={form.serviceId || defaults.serviceId} aria-label={f("route")} />
              </div>
            }
          >
            <Switch aria-label={f("modelRoute")} checked={on.modelRoute} onCheckedChange={(v) => onChange(v ? { modelRoute: true } : { modelRoute: false, route: "" })} />
          </FloatingField>
          <FloatingField layout="inline" label={label("expose_routed_peer", "exposeRoutedPeer")} hint={hint("expose_routed_peer", "exposeRoutedPeerHint")}>
            {sw("exposeRoutedPeer", f("exposeRoutedPeer"))}
          </FloatingField>
          <FloatingField label={f("backendMaxConcurrency")} hint={f("backendMaxConcurrencyHint")}>
            <FieldInput {...text("backendMaxConcurrency")} inputMode="numeric" />
          </FloatingField>
          <FloatingField
            layout="inline"
            label={f("cart")}
            hint={f("cartHint")}
            expanded={form.cart}
            expandedContent={
              <div className="pb-3">
                <Input {...text("cartMaxLoad")} inputMode="numeric" placeholder={f("cartMaxLoad")} aria-label={f("cartMaxLoad")} />
              </div>
            }
          >
            {sw("cart", f("cart"))}
          </FloatingField>
          <RouteExtras form={form} onChange={onChange} options={routeOptions} showRuntime={showRuntime} />
          <FloatingField layout="inline" label={f("slo")} hint={f("sloHint")}>
            {sw("slo", f("slo"))}
          </FloatingField>
          <div className="grid grid-cols-2 gap-3">
            <FloatingField layout={byKey.get("ttft_limit_ms")?.fallback ? "block" : "float"} label={form.slo ? f("ttftFallback") : label("ttft_limit_ms", "ttft")} hint={hint("ttft_limit_ms", "ttftHint")}>
              <FieldInput {...text("ttftLimitMs")} inputMode="numeric" placeholder={byKey.get("ttft_limit_ms")?.fallback || undefined} />
            </FloatingField>
            <FloatingField layout={byKey.get("tps_limit_tps")?.fallback ? "block" : "float"} label={form.slo ? f("tpsFallback") : label("tps_limit_tps", "tps")} hint={hint("tps_limit_tps", "tpsHint")}>
              <FieldInput {...text("tpsLimitTps")} inputMode="numeric" placeholder={byKey.get("tps_limit_tps")?.fallback || undefined} />
            </FloatingField>
          </div>
          <FloatingField
            layout="inline"
            label={label("adaptive_cc", "adaptiveCc")}
            hint={hint("adaptive_cc", "adaptiveCcHint")}
            expanded={form.adaptiveCc}
            expandedContent={
              <div className="space-y-1 pb-3">
                <Input
                  value={form.adaptiveCcMinFrac}
                  onChange={(e) => onChange({ adaptiveCcMinFrac: e.target.value })}
                  inputMode="decimal"
                  placeholder={byKey.get("adaptive_cc_min_frac")?.fallback || undefined}
                  aria-label={f("adaptiveCcMinFrac")}
                  aria-invalid={fracOutOfRange(form.adaptiveCcMinFrac)}
                  disabled={!!extraValue(form, "adaptive_cc_min")}
                />
                <p className={cn("text-xs", fracOutOfRange(form.adaptiveCcMinFrac) ? "text-destructive" : "text-muted-foreground")}>
                  {fracOutOfRange(form.adaptiveCcMinFrac) ? f("fracRange") : hint("adaptive_cc_min_frac", "adaptiveCcMinFracHint")}
                </p>
              </div>
            }
          >
            <Switch aria-label={f("adaptiveCc")} checked={form.adaptiveCc} onCheckedChange={(v) => onChange(v ? { adaptiveCc: true } : { adaptiveCc: false, adaptiveCcMinFrac: "" })} />
          </FloatingField>
          <FloatingField
            layout="inline"
            label={f("monitor")}
            hint={f("monitorHint")}
            expanded={form.monitor}
            expandedContent={
              <div className="grid grid-cols-2 gap-3 pb-3">
                <Input {...text("monitorModel")} placeholder={f("monitorModel")} aria-label={f("monitorModel")} title={f("monitorModelHint")} />
                <Input {...text("monitorGpuType")} placeholder={f("monitorGpuType")} aria-label={f("monitorGpuType")} title={f("monitorGpuTypeHint")} />
              </div>
            }
          >
            {sw("monitor", f("monitor"))}
          </FloatingField>
          <FloatingField layout="inline" label={f("serviceMonitor")} hint={f("serviceMonitorHint")}>
            {sw("serviceMonitor", f("serviceMonitor"))}
          </FloatingField>
        </>,
      )}

      {section(
        "advanced",
        <FloatingField label={f("edits")} hint={f("editsHint")} multiline>
          <FieldTextarea {...text("edits")} rows={10} spellCheck={false} className="font-mono text-xs" />
        </FloatingField>,
      )}
    </div>
  );
}

function Tolerations({ rows, onChange }: { rows: Toleration[]; onChange: (v: Toleration[]) => void }) {
  const t = useT();
  const f = (k: string) => t(`deploy.fields.${k}`);
  const patch = (i: number, p: Partial<Toleration>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Group label={f("tolerations")} hint={f("tolerationsHint")}>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_1fr_9rem_auto] items-center gap-2">
            <Input value={r.key} onChange={(e) => patch(i, { key: e.target.value })} placeholder={f("tolKey")} aria-label={f("tolKey")} />
            <DataSelect value={r.operator} onValueChange={(v) => patch(i, { operator: v as Toleration["operator"], value: v === "Exists" ? "" : r.value })} options={["Equal", "Exists"].map((o) => ({ value: o, label: o }))} />
            <Input value={r.value} onChange={(e) => patch(i, { value: e.target.value })} placeholder={f("tolValue")} aria-label={f("tolValue")} disabled={r.operator === "Exists"} />
            <DataSelect value={r.effect} onValueChange={(v) => patch(i, { effect: v })} options={EFFECTS.map((e) => ({ value: e, label: e || f("anyEffect") }))} />
            <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => onChange([...rows, { key: "", operator: "Equal", value: "", effect: "" }])}>
          <Plus className="size-3.5" /> {f("tolAdd")}
        </Button>
    </Group>
  );
}

function directiveText(t: ReturnType<typeof useT>, d: RouteDirective | undefined, field: "label" | "detail"): string {
  return d ? t(`deploy.routeOptions.options.${d.key}.${field}`, { defaultValue: d[field] }) : "";
}

function runtimeText(t: ReturnType<typeof useT>, d: RouteDirective): string {
  return t("deploy.routeOptions.current", { value: runtimeValue(d.value), source: t(d.set ? "deploy.routeOptions.configured" : "deploy.routeOptions.inherited") });
}

export function RouteExtras({ form, onChange, options, showRuntime = false }: { form: Form; onChange: (patch: Partial<Form>) => void; options?: RouteOptions | null; showRuntime?: boolean }) {
  const t = useT();
  const f = (k: string, v?: Record<string, string | number>) => t(`deploy.fields.${k}`, v);
  const [custom, setCustom] = useState("");
  const controlsId = useId();
  const catalog = options ?? FALLBACK_ROUTE_OPTIONS;
  const byKey = new Map(routeDirectives(catalog).map((d) => [d.key, d]));
  const taken = [...NAMED_VALUES, ...form.nginxExtras.map((r) => r.key)];
  const used = NAMED_VALUES.size + form.nginxExtras.length;
  const full = used >= MAX_VALUES;
  const customError = custom.trim() ? rejectKey(custom, taken) : "";
  const add = (key: string) => {
    onChange({ nginxExtras: [...form.nginxExtras, { key, value: "" }] });
    setCustom("");
  };
  const set = (key: string, value: string) => {
    const exists = form.nginxExtras.some((r) => r.key === key);
    if (!exists && full) return;
    onChange({ nginxExtras: exists ? form.nginxExtras.map((r) => r.key === key ? { ...r, value } : r) : [...form.nginxExtras, { key, value }] });
  };
  const remove = (key: string) => onChange({ nginxExtras: form.nginxExtras.filter((r) => r.key !== key) });
  const row = (key: string, d?: RouteDirective) => {
    const value = form.nginxExtras.find((r) => r.key === key)?.value ?? "";
    const idle = !!d?.needsAdaptive && !form.adaptiveCc;
    const label = directiveText(t, d, "label") || key;
    const fraction = key.endsWith("_frac") && fracOutOfRange(value);
    return (
      <div key={key} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2", idle && "opacity-60")}>
        <div className="min-w-0" title={directiveText(t, d, "detail")}>
          <div className="flex items-center gap-1.5 text-sm"><label htmlFor={`${controlsId}-${key}`} className="break-words">{label}</label>{d && <FieldHint>{directiveText(t, d, "detail")}</FieldHint>}</div>
          {idle && <div className="text-xs text-muted-foreground">{f("idle")}</div>}
          {showRuntime && d?.set !== undefined && <div className="break-words text-xs text-muted-foreground">{runtimeText(t, d)}</div>}
        </div>
        <div className="min-w-0">
          {d?.kind === "boolean" ? (
            <DataSelect id={`${controlsId}-${key}`} value={value || "__inherit"} onValueChange={(v) => set(key, v === "__inherit" ? "" : v)} disabled={full && !taken.includes(key)}
              options={[{ value: "__inherit", label: d.fallback ? f("without", { fallback: d.fallback }) : t("deploy.routeOptions.inherit") }, { value: "true", label: t("deploy.routeOptions.on") }, { value: "false", label: t("deploy.routeOptions.off") }]} />
          ) : (
            <Input id={`${controlsId}-${key}`} value={value} onChange={(e) => set(key, e.target.value)} inputMode={d?.kind === "number" ? "decimal" : undefined} placeholder={d?.fallback || undefined} aria-label={label} aria-invalid={!!fraction} disabled={full && !taken.includes(key)} />
          )}
          {fraction && <p className="text-xs text-destructive">{f("fracRange")}</p>}
        </div>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("deploy.routeOptions.reset", { label })} title={t("deploy.routeOptions.reset", { label })} disabled={!taken.includes(key)} onClick={() => remove(key)}><X className="size-4" /></Button>
      </div>
    );
  };
  const primary = catalog.directives.filter((d) => !NAMED_VALUES.has(d.key));
  const primaryKeys = new Set(primary.map((d) => d.key));
  return (
    <div className="flex flex-col gap-4">
      {[...new Set(primary.map((d) => d.group))].map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t(`deploy.routeOptions.groups.${group}`, { defaultValue: group })}</div>
          {primary.filter((d) => d.group === group).map((d) => row(d.key, d))}
        </div>
      ))}
      {showRuntime && <div className="grid gap-1 text-xs text-muted-foreground">
        {catalog.directives.filter((d) => NAMED_VALUES.has(d.key)).map((d) => <div key={d.key} className="break-words">{directiveText(t, d, "label")}: {runtimeText(t, d)}</div>)}
      </div>}
      {form.nginxExtras.filter((r) => !primaryKeys.has(r.key)).map((r) => row(r.key, byKey.get(r.key)))}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={full} />}><Plus className="size-3.5" /> {t("deploy.routeOptions.advanced")}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(24rem,var(--available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-auto">
            {[...new Set(catalog.advanced.map((d) => d.group))].map((group) => {
              const rows = catalog.advanced.filter((d) => d.group === group && !taken.includes(d.key));
              if (!rows.length) return null;
              return <DropdownMenuGroup key={group}>
                <DropdownMenuLabel>{t(`deploy.routeOptions.groups.${group}`, { defaultValue: group })}</DropdownMenuLabel>
                {rows.map((d) => <DropdownMenuItem key={d.key} onClick={() => add(d.key)} className="flex-col items-start gap-0.5">
                  <span className="text-sm">{directiveText(t, d, "label")} <span className="font-mono text-xs text-muted-foreground">{d.key}</span></span>
                  {d.fallback && <span className="text-xs text-muted-foreground">{f("without", { fallback: d.fallback })}</span>}
                </DropdownMenuItem>)}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>;
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={f("extrasCustom")} aria-label={f("extrasCustom")} className="h-8 w-48" disabled={full} />
        <Button variant="outline" size="sm" disabled={full || !custom.trim() || !!customError} onClick={() => add(custom.trim())}><Plus className="size-3.5" />{t("common:actions.add")}</Button>
        <Badge variant="outline" className="ms-auto font-normal">{full ? f("extrasFull", { max: MAX_VALUES }) : f("extrasUsed", { used, max: MAX_VALUES })}</Badge>
      </div>
      {customError && <p className="text-xs text-warning">{customError}</p>}
    </div>
  );
}

function Group({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-sm">
        {label}
        <FieldHint>{hint}</FieldHint>
      </div>
      {children}
    </div>
  );
}
