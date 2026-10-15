import { useState, type ReactNode } from "react";
import { Button, Checkbox, DataSelect, FieldHint, FieldInput, FloatingField, FormSection, Input, Switch } from "@modelsphere/ui";
import { Plus, X } from "lucide-react";
import type { RouteAuth, SiteProfile } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { fromRows, markDefault, toRows, type Row } from "@/modules/inferences/profile-lib";

const GROUPS = ["placement", "catalog", "model", "routing", "auth", "scaler", "sites"] as const;

export function ProfileForm({ value: p, onChange, submitted, collapsible }: { value: SiteProfile; onChange: (next: SiteProfile) => void; submitted: boolean; collapsible?: boolean }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const [open, setOpen] = useState<Record<string, boolean>>(Object.fromEntries(GROUPS.map((g) => [g, true])));
  const set = (patch: Partial<SiteProfile>) => onChange({ ...p, ...patch });
  const route = (patch: NonNullable<SiteProfile["route"]>) => set({ route: { ...p.route, ...patch } });
  const auth = (patch: RouteAuth) => route({ auth: { ...p.route?.auth, ...patch } });
  const scaler = (patch: NonNullable<SiteProfile["scaler"]>) => set({ scaler: { ...p.scaler, ...patch } });
  const str = (v: string) => v || undefined;
  const group = (g: (typeof GROUPS)[number], children: ReactNode) => (
    <FormSection
      title={t(`profile.groups.${g}`)}
      summary={["placement", "catalog", "model", "routing", "auth", "sites"].includes(g) ? t(`profile.hints.${g}`) : undefined}
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
          {input(f("gpusPerNode"), p.nodes?.gpusPerNode, (v) => set({ nodes: v.replace(/\D/g, "") ? { gpusPerNode: Number(v.replace(/\D/g, "")) } : undefined }), { hint: f("gpusPerNodeHint") })}
        </>,
      )}

      {group(
        "catalog",
        <>
          <Group label={f("catalogs")} hint={f("catalogsHint")}>
            {(p.catalogs ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[10rem_1fr_auto_auto_auto] items-center gap-2">
                <Input value={c.name} onChange={(e) => set({ catalogs: p.catalogs!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={f("catalogName")} aria-label={f("catalogName")} />
                <Input value={c.url} onChange={(e) => set({ catalogs: p.catalogs!.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder={f("catalogUrl")} aria-label={f("catalogUrl")} className="font-mono text-xs" />
                {/* Unset is v1, so v1 is written as unset. */}
                <DataSelect
                  className="w-40"
                  aria-label={f("catalogSchema")}
                  value={c.schemaVersion === "v2" ? "v2" : "v1"}
                  onValueChange={(v) => set({ catalogs: p.catalogs!.map((x, j) => (j === i ? { ...x, schemaVersion: v === "v2" ? "v2" : undefined } : x)) })}
                  options={[
                    { value: "v1", label: f("catalogSchemaV1") },
                    { value: "v2", label: f("catalogSchemaV2") },
                  ]}
                />
                <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                  <Checkbox checked={!!c.default} onCheckedChange={(on) => set({ catalogs: markDefault(p.catalogs!, i, !!on) })} />
                  {f("catalogDefault")}
                </label>
                <Remove onClick={() => set({ catalogs: p.catalogs!.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <Add label={f("catalogAdd")} onClick={() => set({ catalogs: [...(p.catalogs ?? []), { name: "", url: "", schemaVersion: "v2" }] })} />
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
          {input(f("gateway"), p.route?.gateway, (v) => route({ gateway: str(v) }), { hint: f("gatewayHint"), placeholder: "https://llm.example.com", mono: true })}
          <div className="grid grid-cols-2 gap-3">
            {input(f("nginxConfigMap"), p.route?.nginxConfigMap, (v) => route({ nginxConfigMap: str(v) }), { hint: f("nginxConfigMapHint"), mono: true })}
            {input(f("nginxService"), p.route?.nginxService, (v) => route({ nginxService: str(v) }), { hint: f("nginxServiceHint"), mono: true })}
            {input(f("nginxSelector"), p.route?.nginxSelector, (v) => route({ nginxSelector: str(v) }), { mono: true })}
            {input(f("nginxPort"), p.route?.nginxPort, (v) => route({ nginxPort: v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : undefined }), { placeholder: "8080" })}
          </div>
          {input(f("monitorConfigMap"), p.route?.monitorConfigMap, (v) => route({ monitorConfigMap: str(v) }), { mono: true })}
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
