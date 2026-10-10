import { useState, type ReactNode } from "react";
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
import { DIRECTIVES, DIRECTIVES_BY_KEY, MAX_VALUES, directiveGroups, rejectKey } from "@swiss/lib/routeDirectives";
import { useT } from "@/modules/inferences/i18n";
import { NAMED_VALUES, extraValue, fracOutOfRange, initialValue, serviceIdError, type Section } from "@/modules/inferences/deploy-lib";

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
}

export function DeployForm({ form, onChange, upgrade, submitted, target, cluster, defaults, gpuOptions, expanded, onExpand, idPrefix }: DeployFormProps) {
  const t = useT();
  const on = effective(form);
  const f = (k: string) => t(`deploy.fields.${k}`);
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
          <FloatingField layout="inline" label={f("exposeRoutedPeer")} hint={f("exposeRoutedPeerHint")}>
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
          <RouteExtras form={form} onChange={onChange} />
          <FloatingField layout="inline" label={f("slo")} hint={f("sloHint")}>
            {sw("slo", f("slo"))}
          </FloatingField>
          <div className="grid grid-cols-2 gap-3">
            <FloatingField label={form.slo ? f("ttftFallback") : f("ttft")} hint={f("ttftHint")}>
              <FieldInput {...text("ttftLimitMs")} inputMode="numeric" />
            </FloatingField>
            <FloatingField label={form.slo ? f("tpsFallback") : f("tps")} hint={f("tpsHint")}>
              <FieldInput {...text("tpsLimitTps")} inputMode="numeric" />
            </FloatingField>
          </div>
          <FloatingField
            layout="inline"
            label={f("adaptiveCc")}
            hint={f("adaptiveCcHint")}
            expanded={form.adaptiveCc}
            expandedContent={
              <div className="space-y-1 pb-3">
                <Input
                  value={form.adaptiveCcMinFrac}
                  onChange={(e) => onChange({ adaptiveCcMinFrac: e.target.value })}
                  inputMode="decimal"
                  placeholder={`${f("adaptiveCcMinFrac")} · 0.4`}
                  aria-label={f("adaptiveCcMinFrac")}
                  aria-invalid={fracOutOfRange(form.adaptiveCcMinFrac)}
                  disabled={!!extraValue(form, "adaptive_cc_min")}
                />
                <p className={cn("text-xs", fracOutOfRange(form.adaptiveCcMinFrac) ? "text-destructive" : "text-muted-foreground")}>
                  {fracOutOfRange(form.adaptiveCcMinFrac) ? f("fracRange") : f("adaptiveCcMinFracHint")}
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

function RouteExtras({ form, onChange }: { form: Form; onChange: (patch: Partial<Form>) => void }) {
  const t = useT();
  const f = (k: string, v?: Record<string, string | number>) => t(`deploy.fields.${k}`, v);
  const [custom, setCustom] = useState("");
  const taken = form.nginxExtras.map((r) => r.key);
  const used = NAMED_VALUES.size + form.nginxExtras.length;
  const full = used >= MAX_VALUES;
  const customError = custom.trim() ? rejectKey(custom, taken) : "";
  const add = (key: string) => {
    onChange({ nginxExtras: [...form.nginxExtras, { key, value: initialValue(key) }] });
    setCustom("");
  };
  const set = (i: number, value: string) => onChange({ nginxExtras: form.nginxExtras.map((r, j) => (j === i ? { ...r, value } : r)) });

  return (
    <Group label={f("extras")} hint={f("extrasHint")}>
        {form.nginxExtras.map((row, i) => {
          const d = DIRECTIVES_BY_KEY.get(row.key);
          const idle = !!d?.needsAdaptive && !form.adaptiveCc;
          return (
            <div key={`${row.key}-${i}`} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2", idle && "opacity-60")}>
              <div className="min-w-0" title={d?.detail}>
                <div className="truncate text-sm">{d?.label ?? row.key}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{idle ? f("idle") : f("without", { fallback: d?.fallback ?? "-" })}</div>
              </div>
              {d?.kind === "boolean" ? (
                <Switch aria-label={d?.label ?? row.key} checked={row.value === "true"} onCheckedChange={(v) => set(i, v ? "true" : "false")} />
              ) : (
                <Input value={row.value} onChange={(e) => set(i, e.target.value)} inputMode={d?.kind === "number" ? "decimal" : undefined} placeholder={d?.fallback} aria-label={d?.label ?? row.key} />
              )}
              <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={() => onChange({ nginxExtras: form.nginxExtras.filter((_, j) => j !== i) })}>
                <X className="size-4" />
              </Button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={full} />}>
              <Plus className="size-3.5" /> {f("extrasAdd")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-96 overflow-auto">
              {directiveGroups().map((group) => {
                const rows = DIRECTIVES.filter((d) => d.group === group && !taken.includes(d.key));
                if (!rows.length) return null;
                return (
                  <DropdownMenuGroup key={group}>
                    <DropdownMenuLabel>{group}</DropdownMenuLabel>
                    {rows.map((d) => (
                      <DropdownMenuItem key={d.key} onClick={() => add(d.key)} className="flex-col items-start gap-0.5">
                        <span className="text-sm">
                          {d.label} <span className="font-mono text-xs text-muted-foreground">{d.key}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{f("without", { fallback: d.fallback })}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </DropdownMenuGroup>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={f("extrasCustom")} aria-label={f("extrasCustom")} className="h-8 w-48" disabled={full} />
          <Button variant="outline" size="sm" disabled={full || !custom.trim() || !!customError} onClick={() => add(custom.trim())}>
            {t("common:actions.add")}
          </Button>
          <Badge variant="outline" className="ms-auto font-normal">
            {full ? f("extrasFull", { max: MAX_VALUES }) : f("extrasUsed", { used, max: MAX_VALUES })}
          </Badge>
        </div>
        {customError && <p className="text-xs text-warning">{customError}</p>}
    </Group>
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
