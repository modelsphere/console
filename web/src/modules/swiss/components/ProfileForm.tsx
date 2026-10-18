import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, Gauge, Globe, KeyRound, Library, MapPin, Plus, Route, ToggleRight, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { api, type Site, type SiteProfile } from "@swiss/lib/api";
import { Button } from "@swiss/components/ui/button";
import { Card, CardContent, CardHeader } from "@swiss/components/ui/card";
import { HoverHint } from "@swiss/components/ui/hint";
import { Input } from "@swiss/components/ui/input";
import { Switch } from "@swiss/components/ui/switch";
import { aliasErrors, aliasMap, aliasRows, catalogErrors, FEATURES, featureOn, withFeature, type AliasRow, type FeatureKey } from "@swiss/lib/profile";
import { cn } from "@swiss/lib/utils";

const FEATURE_LABELS: Record<FeatureKey, { label: string; hint: string }> = {
  cart: { label: "CART", hint: "Cache-aware router in front of the release." },
  serviceMonitor: { label: "ServiceMonitor", hint: "Prometheus metrics scraped alongside the release." },
  sloRequirement: { label: "SLO requirement", hint: "An LLMSLORequirement for the release." },
  scaler: { label: "Autoscale", hint: "An LLMScaler for the release." },
};

// ProfileForm edits the site profile field by field, which is how it is
// normally edited: the document is a fixed set of cluster facts, not free-form
// values, and every one of them has a name and a reason.
//
// It works on the parsed profile and sends it back as an object. swissd renders
// the YAML with the same library that reads it, so nothing here has to know how
// a path template or a header value needs quoting.
export function ProfileForm({
  value,
  onChange,
}: {
  value: SiteProfile;
  onChange: (p: SiteProfile) => void;
}) {
  // Every setter is a shallow copy of one section, so an untouched section
  // round-trips exactly as it arrived -- including the ones with no field here.
  const set = <K extends keyof SiteProfile>(key: K, v: SiteProfile[K]) =>
    onChange({ ...value, [key]: v });
  const setIn = <K extends keyof SiteProfile>(key: K, patch: Partial<SiteProfile[K]>) =>
    onChange({ ...value, [key]: { ...(value[key] as object), ...patch } as SiteProfile[K] });

  // The catalog swissd falls back to when this document lists none, so an
  // empty list says which catalog that is rather than the word "default".
  // Absent during first-run setup, where there is no cluster to ask yet.
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster, retry: false });
  const configuredCatalog = cluster.data?.catalogFrom === "config" ? cluster.data.catalog : "";

  // A profile from before the list names one catalog; it is shown as the one
  // row it means, and saved back as the list.
  const catalogs = value.catalogs ?? (value.catalog ? [{ name: "default", url: value.catalog }] : []);
  const setCatalogs = (list: CatalogRepo[]) => onChange({ ...value, catalogs: list, catalog: undefined });

  return (
    <div className="space-y-5">
      <Section
        icon={MapPin}
        title="Placement"
        hint="Where releases land. The scheduler and priority class are applied before the deploy form merges, so a deploy overrides either."
      >
        <Row label="Cluster name" hint="Recorded against every plan composed here.">
          <Text label="Cluster name" value={value.name} onChange={(v) => set("name", v)} />
        </Row>
        <Row label="Namespace" hint="Where a release lands unless a deploy overrides it.">
          <Text label="Namespace" value={value.namespace} placeholder="the chart's default" onChange={(v) => set("namespace", v)} />
        </Row>
        <Row label="Scheduler">
          <Split
            label="Priority class"
            side={<Text label="Priority class" value={value.schedule?.priorityClassName} placeholder="the chart's default" onChange={(v) => setIn("schedule", { priorityClassName: v })} />}
          >
            <Text label="Scheduler" value={value.schedule?.schedulerName} placeholder="the chart's default" onChange={(v) => setIn("schedule", { schedulerName: v })} />
          </Split>
        </Row>
        <Row label="GPUs per node" hint="A full GPU node, used to derive cache.maxSlotsPerNode.">
          <Text label="GPUs per node" number value={value.nodes?.gpusPerNode} onChange={(v) => setIn("nodes", { gpusPerNode: num(v) })} />
        </Row>
        <Row
          top
          label="GPU product aliases"
          hint="For nodes a vendor install does not label with the catalog's GPU product name. Each row names a catalog product and a node label selector, every key=value of which must match. A node matching two products takes the one with more pairs. The GPU view then reports the catalog's name, and a deploy restricted to that product may land on the node."
        >
          <GpuAliases value={value.nodes?.gpuProductAliases} onChange={(gpuProductAliases) => setIn("nodes", { gpuProductAliases })} />
        </Row>
      </Section>

      <Section icon={Library} title="Catalog, charts and images" hint="Where the models come from, and the registries the catalog deliberately does not name.">
        <Row
          top
          label="Catalogs"
          hint="Each an https base or an absolute path, under the name the pages select it by. With several, pages open in the one marked default, or ask which one first when none is. Set here they win over swissd's config file, so catalogs change without a helm upgrade. Schema v2 is recommended; v1 is the read-only legacy index, and what a catalog with no schema set reads."
        >
          <Catalogs value={catalogs} onChange={setCatalogs} configured={configuredCatalog} />
        </Row>
        <Row label="Chart repo" hint="An https helm repo or oci:// registry, e.g. https://modelsphere.github.io/helm-charts. Empty means a local chart path.">
          <Text label="Chart repo" mono value={value.chartRepo} onChange={(v) => set("chartRepo", v)} />
        </Row>
        <Row label="Chart path">
          <Text label="Chart path" mono value={value.chartPath} placeholder="unused when a repo is set" onChange={(v) => set("chartPath", v)} />
        </Row>
        <Row label="Registry mirror" hint="Replaces the host/org of an engine image. The catalog pins which build; this says where it is pulled from.">
          <Text label="Registry mirror" mono value={value.registry?.mirror} placeholder="the catalog's repository as-is" onChange={(v) => setIn("registry", { mirror: v })} />
        </Row>
      </Section>

      <Section
        icon={FolderTree}
        title="Model paths"
        hint="Built from the catalog's source.hf. {{hf}} is the full repo id, {{org}} and {{name}} its halves, {{model}} the catalog entry name."
      >
        <Row label="Path template">
          <Text label="Path template" mono value={value.model?.pathTemplate} placeholder="/mnt/disk0/models/{{name}}" onChange={(v) => setIn("model", { pathTemplate: v })} />
        </Row>
        <Row top label="Path overrides" hint="Keyed by catalog model name, for weights that do not sit where the template says. Real layouts are not uniform.">
          <Pairs keyLabel="model" valueLabel="path" value={value.model?.overrides} onChange={(overrides) => setIn("model", { overrides })} />
        </Row>
      </Section>

      <Section icon={Route} title="Routing" hint="The openresty entrypoint every model publishes a route on.">
        <Row label="Route by default" hint="A deploy starts with a route on openresty and the monitor. A catalog variant cannot change this; a deploy still can.">
          <Switch label="Route by default" checked={!!value.route?.enabled} onChange={(enabled) => setIn("route", { enabled: enabled || undefined })} />
        </Row>
        <Row label="Gateway" hint="Where callers reach openresty from outside. Display only — a model's URL is shown as <gateway>/<route>, while every check still calls the service in-cluster.">
          <Text label="Gateway" mono value={value.route?.gateway} placeholder="https://llm.example.com" onChange={(v) => setIn("route", { gateway: v })} />
        </Row>
        <Row label="Openresty ConfigMap" hint="ns/name. The shared document every model writes a key into; the route-collision check is scoped to it.">
          <Text label="Openresty ConfigMap" mono value={value.route?.nginxConfigMap} placeholder="namespace/name" onChange={(v) => setIn("route", { nginxConfigMap: v })} />
        </Row>
        <Row label="Openresty Service" hint="ns/name, called by the serving and health checks.">
          <Text label="Openresty Service" mono value={value.route?.nginxService} placeholder="namespace/name" onChange={(v) => setIn("route", { nginxService: v })} />
        </Row>
        <Row label="Openresty selector">
          <Split
            label="Entrypoint port"
            side={<Text label="Entrypoint port" number value={value.route?.nginxPort} placeholder="8080" onChange={(v) => setIn("route", { nginxPort: num(v) })} />}
          >
            <Text label="Openresty selector" mono value={value.route?.nginxSelector} placeholder="key=value" onChange={(v) => setIn("route", { nginxSelector: v })} />
          </Split>
        </Row>
        <Row label="Monitor ConfigMap">
          <Text label="Monitor ConfigMap" mono value={value.route?.monitorConfigMap} placeholder="namespace/name" onChange={(v) => setIn("route", { monitorConfigMap: v })} />
        </Row>
      </Section>

      <Section
        icon={KeyRound}
        title="Entrypoint auth"
        hint="Used only by the serving and health checks. This document is a ConfigMap, so it names a Secret rather than holding the key — nothing here is a credential."
      >
        <Row label="Secret" hint="ns/name, or a bare name for a Secret in swissd's own namespace.">
          <Split
            label="Key"
            side={<Text label="Secret key" mono value={value.route?.auth?.secretKey} placeholder="apiKey" onChange={(v) => setAuth(value, onChange, { secretKey: v })} />}
          >
            <Text label="Secret" mono value={value.route?.auth?.secretRef} onChange={(v) => setAuth(value, onChange, { secretRef: v })} />
          </Split>
        </Row>
        <Row label="Key header">
          <Split
            label="Prefix"
            hint="What precedes the key. Empty on a custom header is meaningful — X-Api-Key carries no scheme."
            side={
              <Text
                label="Key prefix"
                mono
                value={value.route?.auth?.prefix}
                placeholder={value.route?.auth?.header ? "none" : "Bearer "}
                onChange={(v) => setAuth(value, onChange, { prefix: v })}
              />
            }
          >
            <Text label="Key header" mono value={value.route?.auth?.header} placeholder="Authorization" onChange={(v) => setAuth(value, onChange, { header: v })} />
          </Split>
        </Row>
        <Row top label="Static headers" hint="Sent on every call to the entrypoint. Not a place for credentials, for the same reason as above.">
          <Pairs keyLabel="header" valueLabel="value" value={value.route?.auth?.headers} onChange={(headers) => setAuth(value, onChange, { headers })} />
        </Row>
      </Section>

      <Section icon={Gauge} title="Cache and scaler">
        <Row label="Cache" hint="Off emits nothing under cache: — the section does not exist in every chart version, and a values file carrying an unknown key is rejected rather than ignored.">
          <div className="flex items-center gap-3">
            <Switch label="Cache" checked={!!value.cache?.enabled} onChange={(enabled) => setIn("cache", { enabled })} />
            <Text
              label="Cache host path"
              mono
              value={value.cache?.hostPath}
              placeholder="host path, e.g. /mnt/disk0/sglang-cache"
              disabled={!value.cache?.enabled}
              onChange={(v) => setIn("cache", { hostPath: v })}
            />
          </div>
        </Row>
        <Row label="Scaler server" hint="What the chart receives: the decision server, or the Prometheus query API, depending on the provider a deploy picks.">
          <Text label="Scaler server" mono value={value.scaler?.serverAddress} onChange={(v) => setIn("scaler", { serverAddress: v })} />
        </Row>
        <Row label="SLO address" hint="Same service. swissd calls this to read and edit LLMSLORequirement thresholds after install. It is not copied into chart values.">
          <Text label="SLO address" mono value={value.scaler?.sloAddress} placeholder="http://slo-api.llm-scaler.svc:80" onChange={(v) => setIn("scaler", { sloAddress: v })} />
        </Row>
        <Row label="SLO token secret" hint="ns/name of the Secret holding the bearer token, or a bare name in swissd's namespace. The token is not stored in this profile.">
          <Split
            label="Key"
            hint="Key inside that Secret. Defaults to token."
            side={<Text label="SLO token key" mono value={value.scaler?.sloTokenKey} placeholder="token" onChange={(v) => setIn("scaler", { sloTokenKey: v })} />}
          >
            <Text label="SLO token secret" mono value={value.scaler?.sloTokenSecret} placeholder="llm-scaler/slo-api" onChange={(v) => setIn("scaler", { sloTokenSecret: v })} />
          </Split>
        </Row>
        <Row top label="Scaler headers">
          <Pairs keyLabel="header" valueLabel="value" value={value.scaler?.serverHeaders} onChange={(serverHeaders) => setIn("scaler", { serverHeaders })} />
        </Row>
      </Section>

      <Section
        icon={ToggleRight}
        title="Feature defaults"
        hint="What a deploy starts each feature at; unset is on. A catalog variant that sets its own wins over these, and a deploy can still choose either way."
      >
        {FEATURES.map((k) => (
          <Row key={k} label={FEATURE_LABELS[k].label} hint={FEATURE_LABELS[k].hint}>
            <Switch label={FEATURE_LABELS[k].label} checked={featureOn(value.defaults, k)} onChange={(on) => set("defaults", withFeature(value.defaults, k, on))} />
          </Row>
        ))}
      </Section>

      <Section
        icon={Globe}
        title="Other sites"
        hint="The swissd instances in other clusters, for the switcher in the header. A list you keep — there is no registry of swissd instances — and every one of them serves the same switcher, so any is a valid entry point."
      >
        <Row top label="Sites">
          <Sites value={value.sites ?? []} onChange={(sites) => set("sites", sites)} />
        </Row>
      </Section>
    </div>
  );
}

type CatalogRepo = NonNullable<SiteProfile["catalogs"]>[number];

// Catalogs is the list a page selects from. swissd refuses the profile over a
// row without a name or url, a name that is not lowercase, a name or url listed
// twice, or a relative path -- flagged here so the save is not the first to say.
function Catalogs({
  value,
  onChange,
  configured,
}: {
  value: CatalogRepo[];
  onChange: (v: CatalogRepo[]) => void;
  configured: string;
}) {
  const patch = (i: number, p: Partial<CatalogRepo>) =>
    onChange(value.map((c, j) => (i === j ? { ...c, ...p } : c)));
  const errs = catalogErrors(value);

  return (
    <List
      onAdd={() => onChange([...value, { name: "", url: "", schemaVersion: "v2" }])}
      addLabel="Add catalog"
      problem={
        errs.some((e) => e.name || e.url) &&
        "Every catalog needs a unique lowercase name (letters, digits, . - _), and a url starting with http://, https:// or / that is not listed twice under one schema; swissd will refuse the profile otherwise."
      }
    >
      {value.length === 0 && (
        <Empty>
          None listed: swissd uses the one in its config file
          {configured ? (
            <>
              , <code className="break-all">{configured}</code>
            </>
          ) : null}
          . That is also what the CLI uses.
        </Empty>
      )}
      {value.map((c, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_10rem_auto_auto]">
          <Input
            className={cn(errs[i].name && BAD)}
            aria-invalid={!!errs[i].name}
            value={c.name}
            onChange={(e) => patch(i, { name: e.target.value })}
            placeholder="name"
            aria-label="catalog name"
          />
          <Input
            className={cn("font-mono text-xs", errs[i].url && BAD)}
            aria-invalid={!!errs[i].url}
            value={c.url}
            onChange={(e) => patch(i, { url: e.target.value })}
            placeholder="https://modelsphere.github.io/model-catalog/"
            aria-label="catalog url"
          />
          {/* Unset is v1, so v1 is written as unset. */}
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={c.schemaVersion === "v2" ? "v2" : ""}
            onChange={(e) => patch(i, { schemaVersion: e.target.value === "v2" ? "v2" : undefined })}
            aria-label={`schema of ${c.name || "catalog"}`}
          >
            <option value="">v1 · legacy</option>
            <option value="v2">v2 · recommended</option>
          </select>
          {/* At most one default: marking one clears the others. */}
          <button
            type="button"
            aria-pressed={!!c.default}
            onClick={() => onChange(value.map((x, j) => ({ ...x, default: !c.default && i === j ? true : undefined })))}
            className={cn(
              "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
              c.default
                ? "border-success/40 bg-success/15 text-success"
                : "border-dashed text-muted-foreground hover:border-solid hover:text-foreground",
            )}
          >
            {c.default ? "default" : "set default"}
          </button>
          <Remove label={`remove ${c.name || "catalog"}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
    </List>
  );
}

// GpuAliases names catalog GPU products by node labels. swissd refuses a row
// missing either half, a selector that is not key=value pairs, and two products
// one node could match with as many pairs -- flagged here so the save is not
// the first to say.
function GpuAliases({
  value,
  onChange,
}: {
  value?: Record<string, string[]>;
  onChange: (v: Record<string, string[]> | undefined) => void;
}) {
  // Rows live here while typed; see aliasRows.
  const [rows, setRows] = useState<AliasRow[]>(() => aliasRows(value));
  const errs = aliasErrors(rows);
  const push = (next: AliasRow[]) => {
    setRows(next);
    onChange(aliasMap(next));
  };
  const patch = (i: number, p: Partial<AliasRow>) => push(rows.map((r, j) => (i === j ? { ...r, ...p } : r)));

  return (
    <List
      onAdd={() => setRows([...rows, { product: "", selector: "" }])}
      addLabel="Add alias"
      problem={
        errs.some((e) => e.product || e.selector) &&
        "Every alias needs a product and key=value labels, comma separated, and no node may match two products with as many labels; swissd will refuse the profile otherwise."
      }
    >
      {rows.map((r, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
          <Input
            className={cn(errs[i].product && BAD)}
            aria-invalid={!!errs[i].product}
            value={r.product}
            onChange={(e) => patch(i, { product: e.target.value })}
            placeholder="catalog GPU product"
            aria-label="GPU product"
          />
          <Input
            className={cn("font-mono text-xs", errs[i].selector && BAD)}
            aria-invalid={!!errs[i].selector}
            value={r.selector}
            onChange={(e) => patch(i, { selector: e.target.value })}
            placeholder="accelerator=huawei-Ascend910"
            aria-label="node labels"
          />
          <Remove label={`remove ${r.product || "alias"}`} onClick={() => push(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
    </List>
  );
}

// Sites is the switcher's list: a name to show and an address to go to. Both
// are required -- a row missing either is a dead entry in a dropdown -- and
// swissd refuses the profile rather than rendering one, so the empty state is
// flagged here instead of at save.
function Sites({ value, onChange }: { value: Site[]; onChange: (v: Site[]) => void }) {
  const patch = (i: number, p: Partial<Site>) =>
    onChange(value.map((s, j) => (i === j ? { ...s, ...p } : s)));

  return (
    <List
      onAdd={() => onChange([...value, { name: "", url: "" }])}
      addLabel="Add site"
      problem={
        value.some((s) => !s.name.trim() || !s.url.trim() || (!s.url.trim().startsWith("http://") && !s.url.trim().startsWith("https://"))) &&
        "Every site needs a name and a url starting with http:// or https://; swissd will refuse the profile otherwise."
      }
    >
      {value.map((s, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
          <Input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="cluster name" aria-label="site name" />
          <Input
            className="font-mono text-xs"
            value={s.url}
            onChange={(e) => patch(i, { url: e.target.value })}
            placeholder="https://swiss.other.internal"
            aria-label="site url"
          />
          <Remove label={`remove ${s.name || "site"}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
    </List>
  );
}

// Pairs edits a string map. Rows rather than a YAML box: these are two-column
// facts, and the one thing a free-text field adds here is a way to mistype the
// indentation.
function Pairs({
  keyLabel,
  valueLabel,
  value,
  onChange,
}: {
  keyLabel: string;
  valueLabel: string;
  value?: Record<string, string>;
  onChange: (v: Record<string, string> | undefined) => void;
}) {
  // Kept as a list while editing: a map keyed by what is being typed loses the
  // row the moment two keys collide or one is briefly empty.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value ?? {}));

  const push = (next: [string, string][]) => {
    setRows(next);
    const out: Record<string, string> = {};
    for (const [k, v] of next) if (k.trim()) out[k] = v;
    onChange(Object.keys(out).length ? out : undefined);
  };

  return (
    <List onAdd={() => setRows([...rows, ["", ""]])} addLabel={`Add ${keyLabel}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
          <Input
            value={k}
            placeholder={keyLabel}
            aria-label={keyLabel}
            className="font-mono text-xs"
            onChange={(e) => push(rows.map((r, j) => (i === j ? [e.target.value, r[1]] : r)))}
          />
          <Input
            value={v}
            placeholder={valueLabel}
            aria-label={valueLabel}
            className="font-mono text-xs"
            onChange={(e) => push(rows.map((r, j) => (i === j ? [r[0], e.target.value] : r)))}
          />
          <Remove label={`remove ${k || keyLabel}`} onClick={() => push(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
    </List>
  );
}

// Auth is two levels down, so it gets its own setter rather than a nested
// spread at every call site.
function setAuth(
  value: SiteProfile,
  onChange: (p: SiteProfile) => void,
  patch: Partial<NonNullable<NonNullable<SiteProfile["route"]>["auth"]>>,
) {
  onChange({
    ...value,
    route: { ...value.route, auth: { ...value.route?.auth, ...patch } },
  });
}

// An empty number field means "unset", not zero: a 0 here would be a real
// value the chart would act on.
function num(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? undefined : n;
}

const BAD = "border-destructive";

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="px-6 pt-6 pb-2">
        <h3 className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          <HoverHint text={hint}>
            <span className="text-base font-semibold">{title}</span>
          </HoverHint>
        </h3>
      </CardHeader>
      <CardContent className="divide-y px-6 pt-0 pb-6">{children}</CardContent>
    </Card>
  );
}

// Two columns: a label carrying its hint on hover, and the control. Every
// control runs to the card's right edge, so rows share both edges.
function Row({
  label,
  hint,
  top,
  children,
}: {
  label: string;
  hint?: string;
  // Lists grow downward; their label stays level with the first row.
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-x-6 gap-y-1.5 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)]", top ? "sm:items-start" : "sm:items-center")}>
      <div className={cn("min-w-0", top && "sm:pt-2")}>
        <HoverHint text={hint}>
          <span className="text-sm font-medium">{label}</span>
        </HoverHint>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Two fields that answer one question, on one line: the main box, then the
// second's label and a narrower box at the right edge.
function Split({ label, hint, side, children }: { label: string; hint?: string; side: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,12rem)]">
      {children}
      <HoverHint text={hint}>
        <span className="text-sm text-muted-foreground sm:text-right">{label}</span>
      </HoverHint>
      {side}
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  mono,
  number,
  disabled,
  className,
}: {
  label: string;
  value?: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  number?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Input
      aria-label={label}
      type={number ? "number" : undefined}
      min={number ? 0 : undefined}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(mono && "font-mono text-xs", className)}
    />
  );
}

function List({
  children,
  onAdd,
  addLabel,
  problem,
}: {
  children: React.ReactNode;
  onAdd: () => void;
  addLabel: string;
  problem?: string | false;
}) {
  return (
    <div className="space-y-2">
      {children}
      {problem && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {problem}
        </p>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onAdd} className="text-primary hover:text-primary">
        <Plus className="size-4" /> {addLabel}
      </Button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="justify-self-start rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-4" />
    </button>
  );
}
