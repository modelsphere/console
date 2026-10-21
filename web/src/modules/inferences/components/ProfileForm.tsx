import { useState, type ReactNode } from "react";
import { Button, Checkbox, FieldHint, FieldInput, FieldSelect, FloatingField, FormSection, Input, Switch } from "@modelsphere/ui";
import { Plus, X } from "lucide-react";
import type { RouteAuth, SiteProfile } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { fromRows, markDefault, toRows, withNodes, type Row } from "@/modules/inferences/profile-lib";
import { aliasErrors, aliasMap, aliasRows, catalogErrors, FEATURES, featureOn, withFeature, type AliasError, type AliasRow, type CatalogError } from "@swiss/lib/profile";

// The copied swiss types predate writable.
type CatalogRepo = NonNullable<SiteProfile["catalogs"]>[number] & { writable?: boolean };

// A writable catalog's token as the editor holds it: typed, whether swissd has one the save
// keeps or drops (an edited catalog), and why swissd did not keep the one last saved.
export interface TokenField {
  value: string;
  stored: boolean;
  dropped?: boolean;
  refused?: string;
  onChange: (v: string) => void;
}

const GROUPS = ["placement", "catalog", "model", "routing", "auth", "scaler", "defaults", "sites"] as const;

export function ProfileForm({
  value: p,
  onChange,
  submitted,
  collapsible,
  token,
}: {
  value: SiteProfile;
  onChange: (next: SiteProfile) => void;
  submitted: boolean;
  collapsible?: boolean;
  token?: (catalog: string) => TokenField;
}) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const [open, setOpen] = useState<Record<string, boolean>>(Object.fromEntries(GROUPS.map((g) => [g, true])));
  const set = (patch: Partial<SiteProfile>) => onChange({ ...p, ...patch });
  const route = (patch: NonNullable<SiteProfile["route"]>) => set({ route: { ...p.route, ...patch } });
  const auth = (patch: RouteAuth) => route({ auth: { ...p.route?.auth, ...patch } });
  const scaler = (patch: NonNullable<SiteProfile["scaler"]>) => set({ scaler: { ...p.scaler, ...patch } });
  const str = (v: string) => v || undefined;
  const catalogs = p.catalogs ?? [];
  const catalogErrs = catalogErrors(catalogs);
  const group = (g: (typeof GROUPS)[number], children: ReactNode) => (
    <FormSection
      title={t(`profile.groups.${g}`)}
      summary={g !== "scaler" ? t(`profile.hints.${g}`) : undefined}
      expanded={collapsible ? open[g] : undefined}
      onExpandedChange={collapsible ? (o) => setOpen((s) => ({ ...s, [g]: o })) : undefined}
    >
      <div className="flex flex-col gap-3">{children}</div>
    </FormSection>
  );
  const input = (label: string, value: string | number | undefined, onValue: (v: string) => void, opts: { hint?: string; placeholder?: string; required?: boolean; error?: string; mono?: boolean } = {}) => (
    <FloatingField label={label} hint={opts.hint} required={opts.required} error={opts.error}>
      <FieldInput value={value ?? ""} onChange={(e) => onValue(e.target.value)} placeholder={opts.placeholder} className={opts.mono ? "font-mono text-xs" : undefined} />
    </FloatingField>
  );

  return (
    <div className="flex flex-col gap-4">
      {group(
        "placement",
        <>
          {input(f("name"), p.name, (v) => set({ name: v }), { hint: f("nameHint"), required: true, error: submitted && !p.name?.trim() ? t("profile.errors.name") : undefined })}
          {input(f("namespace"), p.namespace, (v) => set({ namespace: str(v) }), { hint: f("namespaceHint") })}
          <div className="grid grid-cols-2 gap-3">
            {input(f("scheduler"), p.schedule?.schedulerName, (v) => set({ schedule: { ...p.schedule, schedulerName: str(v) } }), { placeholder: f("chartDefault") })}
            {input(f("priorityClass"), p.schedule?.priorityClassName, (v) => set({ schedule: { ...p.schedule, priorityClassName: str(v) } }), { placeholder: f("chartDefault") })}
          </div>
          {input(f("gpusPerNode"), p.nodes?.gpusPerNode, (v) => set({ nodes: withNodes(p.nodes, { gpusPerNode: v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : undefined }) }), { hint: f("gpusPerNodeHint") })}
          <GpuAliases value={p.nodes?.gpuProductAliases} submitted={submitted} onChange={(a) => set({ nodes: withNodes(p.nodes, { gpuProductAliases: a }) })} />
        </>,
      )}

      {group(
        "catalog",
        <>
          <Group label={f("catalogs")} hint={f("catalogsHint")}>
            {catalogs.map((c, i) => (
              <CatalogRow
                key={i}
                value={c}
                errors={submitted ? catalogErrs[i] : {}}
                token={token?.(c.name)}
                onChange={(patch) => set({ catalogs: catalogs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                onDefault={(on) => set({ catalogs: markDefault(catalogs, i, on) })}
                onRemove={() => set({ catalogs: catalogs.filter((_, j) => j !== i) })}
              />
            ))}
            <Add label={f("catalogAdd")} onClick={() => set({ catalogs: [...catalogs, { name: "", url: "", schemaVersion: "v2" }] })} />
          </Group>
          {input(f("chartRepo"), p.chartRepo, (v) => set({ chartRepo: str(v) }), { hint: f("chartRepoHint"), placeholder: "https://modelsphere.github.io/helm-charts", mono: true })}
          {input(f("chartPath"), p.chartPath, (v) => set({ chartPath: str(v) }), { placeholder: f("chartPathHint"), mono: true })}
          {input(f("mirror"), p.registry?.mirror, (v) => set({ registry: v ? { mirror: v } : undefined }), { hint: f("mirrorHint"), placeholder: f("mirrorPlaceholder"), mono: true })}
        </>,
      )}

      {group(
        "model",
        <>
          {input(f("pathTemplate"), p.model?.pathTemplate, (v) => set({ model: { ...p.model, pathTemplate: v } }), {
            required: true,
            placeholder: "/mnt/disk0/models/{{name}}",
            mono: true,
            error: submitted && !p.model?.pathTemplate?.trim() ? t("profile.errors.pathTemplate") : undefined,
          })}
          <KV label={f("overrides")} hint={f("overridesHint")} value={p.model?.overrides} onChange={(o) => set({ model: { ...p.model, overrides: o } })} />
        </>,
      )}

      {group(
        "routing",
        <>
          <FloatingField layout="inline" label={f("routeEnabled")} hint={f("routeEnabledHint")}>
            <Switch aria-label={f("routeEnabled")} checked={!!p.route?.enabled} onCheckedChange={(v) => route({ enabled: v || undefined })} />
          </FloatingField>
          {input(f("gateway"), p.route?.gateway, (v) => route({ gateway: str(v) }), { hint: f("gatewayHint"), placeholder: "https://llm.example.com", mono: true })}
          <div className="grid grid-cols-2 gap-3">
            {input(f("nginxConfigMap"), p.route?.nginxConfigMap, (v) => route({ nginxConfigMap: str(v) }), { hint: f("nginxConfigMapHint"), placeholder: "namespace/name", mono: true })}
            {input(f("nginxService"), p.route?.nginxService, (v) => route({ nginxService: str(v) }), { hint: f("nginxServiceHint"), placeholder: "namespace/name", mono: true })}
            {input(f("nginxSelector"), p.route?.nginxSelector, (v) => route({ nginxSelector: str(v) }), { placeholder: "key=value", mono: true })}
            {input(f("nginxPort"), p.route?.nginxPort, (v) => route({ nginxPort: v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : undefined }), { placeholder: "8080" })}
          </div>
          {input(f("monitorConfigMap"), p.route?.monitorConfigMap, (v) => route({ monitorConfigMap: str(v) }), { placeholder: "namespace/name", mono: true })}
        </>,
      )}

      {group(
        "auth",
        <>
          <div className="grid grid-cols-2 gap-3">
            {input(f("secretRef"), p.route?.auth?.secretRef, (v) => auth({ secretRef: str(v) }), { hint: f("secretRefHint"), mono: true })}
            {input(f("secretKey"), p.route?.auth?.secretKey, (v) => auth({ secretKey: str(v) }), { placeholder: "apiKey", mono: true })}
            {input(f("header"), p.route?.auth?.header, (v) => auth({ header: str(v) }), { placeholder: "Authorization" })}
            <FloatingField label={f("prefix")} hint={f("prefixHint")}>
              <FieldInput value={p.route?.auth?.prefix ?? ""} onChange={(e) => auth({ prefix: e.target.value })} placeholder={p.route?.auth?.header ? "" : "Bearer "} />
            </FloatingField>
          </div>
          <KV label={f("headers")} hint={f("headersHint")} value={p.route?.auth?.headers} onChange={(h) => auth({ headers: h })} />
        </>,
      )}

      {group(
        "scaler",
        <>
          <FloatingField
            layout="inline"
            label={f("cache")}
            hint={f("cacheHint")}
            expanded={!!p.cache?.enabled}
            expandedContent={
              <div className="pb-3">
                <Input value={p.cache?.hostPath ?? ""} onChange={(e) => set({ cache: { ...p.cache, hostPath: str(e.target.value) } })} placeholder={f("cacheHostPath")} aria-label={f("cacheHostPath")} className="font-mono text-xs" />
              </div>
            }
          >
            <Switch checked={!!p.cache?.enabled} onCheckedChange={(v) => set({ cache: { ...p.cache, enabled: v } })} />
          </FloatingField>
          {input(f("serverAddress"), p.scaler?.serverAddress, (v) => scaler({ serverAddress: str(v) }), { hint: f("serverAddressHint"), mono: true })}
          {input(f("sloAddress"), p.scaler?.sloAddress, (v) => scaler({ sloAddress: str(v) }), { hint: f("sloAddressHint"), placeholder: "http://slo-api.llm-scaler.svc:80", mono: true })}
          <div className="grid grid-cols-2 gap-3">
            {input(f("sloTokenSecret"), p.scaler?.sloTokenSecret, (v) => scaler({ sloTokenSecret: str(v) }), { hint: f("sloTokenSecretHint"), placeholder: "llm-scaler/slo-api", mono: true })}
            {input(f("sloTokenKey"), p.scaler?.sloTokenKey, (v) => scaler({ sloTokenKey: str(v) }), { hint: f("sloTokenKeyHint"), placeholder: "token", mono: true })}
          </div>
          <KV label={f("serverHeaders")} value={p.scaler?.serverHeaders} onChange={(h) => scaler({ serverHeaders: h })} />
        </>,
      )}

      {group(
        "defaults",
        FEATURES.map((k) => (
          <FloatingField key={k} layout="inline" label={t(`profile.features.${k}`)} hint={t(`profile.features.${k}Hint`)}>
            <Switch aria-label={t(`profile.features.${k}`)} checked={featureOn(p.defaults, k)} onCheckedChange={(on) => set({ defaults: withFeature(p.defaults, k, on) })} />
          </FloatingField>
        )),
      )}

      {group(
        "sites",
        <Group label={t("profile.groups.sites")} hint={t("profile.hints.sites")}>
          {(p.sites ?? []).map((s, i) => (
            <div key={i} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2">
              <Input value={s.name} onChange={(e) => set({ sites: p.sites!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={f("siteName")} aria-label={f("siteName")} />
              <Input value={s.url} onChange={(e) => set({ sites: p.sites!.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder={f("siteUrl")} aria-label={f("siteUrl")} className="font-mono text-xs" />
              <Remove onClick={() => set({ sites: p.sites!.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Add label={f("siteAdd")} onClick={() => set({ sites: [...(p.sites ?? []), { name: "", url: "" }] })} />
        </Group>,
      )}
    </div>
  );
}

function CatalogRow({
  value: c,
  errors,
  onChange,
  onDefault,
  onRemove,
  token,
}: {
  value: CatalogRepo;
  errors: { name?: CatalogError; url?: CatalogError };
  token?: TokenField;
  onChange: (patch: Partial<CatalogRepo>) => void;
  onDefault: (on: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const err = (field: "name" | "url", e?: CatalogError) => e && t(`profile.errors.catalog.${field}.${e}`);
  return (
    <div className="grid gap-3 rounded-md border bg-surface-page p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <FloatingField label={f("catalogName")} required error={err("name", errors.name)}>
        <FieldInput value={c.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="public" />
      </FloatingField>
      <FloatingField label={f("catalogUrl")} required error={err("url", errors.url)}>
        <FieldInput value={c.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://modelsphere.github.io/model-catalog" className="font-mono text-xs" />
      </FloatingField>
      {/* Unset is v1, so v1 is written as unset. */}
      <FloatingField label={f("catalogSchema")}>
        <FieldSelect
          value={c.schemaVersion === "v2" ? "v2" : "v1"}
          onValueChange={(v) => v && onChange({ schemaVersion: v === "v2" ? "v2" : undefined })}
          options={[
            { value: "v2", label: f("catalogSchemaV2") },
            { value: "v1", label: f("catalogSchemaV1") },
          ]}
        />
      </FloatingField>
      <div className="flex items-center gap-2 px-1">
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          <Checkbox checked={!!c.default} onCheckedChange={(on) => onDefault(!!on)} />
          {f("catalogDefault")}
        </label>
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          <Checkbox checked={!!c.writable} onCheckedChange={(on) => onChange({ writable: on ? true : undefined })} />
          {f("catalogWritable")}
        </label>
        <span className="ms-auto">
          <Remove onClick={onRemove} />
        </span>
      </div>
      {c.writable && token && (
        <div className="sm:col-span-2">
          {/* Optional: a writable catalog without a token is shown, not refused. */}
          <FloatingField
            label={f("catalogToken")}
            hint={t("profile.token.hint")}
            notice={token.value ? undefined : token.dropped ? t("profile.token.dropped") : !token.stored ? t("profile.token.missing") : undefined}
            error={token.refused && t("profile.token.refused", { error: token.refused })}
          >
            <FieldInput type="password" autoComplete="new-password" value={token.value} onChange={(e) => token.onChange(e.target.value)} placeholder={token.stored ? t("profile.token.keep") : undefined} />
          </FloatingField>
        </div>
      )}
    </div>
  );
}

function GpuAliases({ value, submitted, onChange }: { value?: Record<string, string[]>; submitted: boolean; onChange: (v?: Record<string, string[]>) => void }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  // Rows live here while typed; see aliasRows.
  const [rows, setRows] = useState<AliasRow[]>(() => aliasRows(value));
  const errs = aliasErrors(rows);
  const err = (field: "product" | "selector", e?: AliasError) => (submitted && e ? t(`profile.errors.gpuAlias.${field}.${e}`) : undefined);
  const update = (next: AliasRow[]) => {
    setRows(next);
    onChange(aliasMap(next));
  };
  const edit = (i: number, patch: Partial<AliasRow>) => update(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Group label={f("gpuAliases")} hint={f("gpuAliasesHint")}>
      {/* An error line hangs below its field, so rows showing one need the room. */}
      <div className={`flex flex-col gap-6 ${submitted && errs.some((e) => e.product || e.selector) ? "sm:gap-5" : "sm:gap-3"}`}>
        {rows.map((r, i) => (
          // Narrow, the remove button sits beside the product and the labels take the next line.
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
            <FloatingField label={f("gpuAliasProduct")} required error={err("product", errs[i].product)}>
              <FieldInput value={r.product} onChange={(e) => edit(i, { product: e.target.value })} placeholder="Ascend-910B3" />
            </FloatingField>
            <span className="sm:order-last">
              <Remove onClick={() => update(rows.filter((_, j) => j !== i))} />
            </span>
            <div className="col-span-2 sm:col-span-1">
              <FloatingField label={f("gpuAliasSelector")} required error={err("selector", errs[i].selector)}>
                <FieldInput value={r.selector} onChange={(e) => edit(i, { selector: e.target.value })} placeholder="accelerator=huawei-Ascend910" className="font-mono text-xs" />
              </FloatingField>
            </div>
          </div>
        ))}
      </div>
      <Add label={f("gpuAliasAdd")} onClick={() => setRows([...rows, { product: "", selector: "" }])} />
    </Group>
  );
}

function KV({ label, hint, value, onChange }: { label: string; hint?: string; value?: Record<string, string>; onChange: (v?: Record<string, string>) => void }) {
  const t = useT();
  // Rows live here while typed: a row with no key yet is not in the profile.
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const update = (next: Row[]) => {
    setRows(next);
    onChange(fromRows(next));
  };
  return (
    <Group label={label} hint={hint}>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input value={r.key} onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder={t("profile.fields.key")} aria-label={t("profile.fields.key")} className="font-mono text-xs" />
          <Input value={r.value} onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={t("profile.fields.value")} aria-label={t("profile.fields.value")} className="font-mono text-xs" />
          <Remove onClick={() => update(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Add label={t("profile.fields.add")} onClick={() => setRows([...rows, { key: "", value: "" }])} />
    </Group>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-sm">
        {label}
        {hint && <FieldHint>{hint}</FieldHint>}
      </div>
      {children}
    </div>
  );
}

function Add({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="w-fit" onClick={onClick}>
      <Plus className="size-3.5" /> {label}
    </Button>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={onClick}>
      <X className="size-4" />
    </Button>
  );
}
