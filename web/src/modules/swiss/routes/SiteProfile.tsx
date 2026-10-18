import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";
import { api, type ProfileResponse } from "@swiss/lib/api";
import { Badge } from "@swiss/components/ui/badge";
import { Button } from "@swiss/components/ui/button";
import { ProfileEditor } from "@swiss/components/ProfileEditor";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { HoverHint } from "@swiss/components/ui/hint";
import { ErrorState, Loading } from "@swiss/components/States";
import { Code } from "@swiss/components/ui/code";
import { toYaml } from "@swiss/lib/yaml";

export function SiteProfile() {
  const [editing, setEditing] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ["profile"],
    queryFn: api.profile,
  });

  if (isPending) return <Loading what="the site profile" />;
  if (error) return <ErrorState what="the site profile" error={error} />;

  // The stored document does not parse, so there is nothing to show as parsed.
  // It is fixed here rather than at setup: setup is for a site with nothing
  // stored, and starting over from the default would lose the whole profile.
  if (!data.profile) return <Repair data={data} />;

  const p = data.profile;
  const auth = p.route?.auth;
  // A profile from before the list names one catalog, which is the one row it means.
  const catalogs = p.catalogs ?? (p.catalog ? [{ name: "default", url: p.catalog }] : []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Site profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Badge variant="outline">{p.name}</Badge>{" "}
            <span className="font-mono text-xs">{data.source}</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The cluster-shaped layer: what the public catalog cannot know and a deploy form
            should not have to retype. Shown as parsed, after defaults.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
          {editing ? (
            <>
              <Check className="size-4" /> Done
            </>
          ) : (
            <>
              <Pencil className="size-4" /> Edit
            </>
          )}
        </Button>
      </div>

      {editing && (
        <div className="space-y-3">
          <h2>
            <HoverHint
              text={`swissd owns this document and writes it to ${data.source}. It is checked before it is stored — a profile that does not parse would take the deploy form down.`}
            >
              <span className="text-base font-semibold">Edit</span>
            </HoverHint>
          </h2>
          <ProfileEditor
            profile={data.profile}
            yaml={data.yaml ?? ""}
            submitLabel="Save profile"
            onSaved={() => setEditing(false)}
          />
        </div>
      )}

      {!editing && (
        <>
          <Section
            title="Placement"
            hint="The scheduler and priority class are applied before the deploy form merges, so a deploy overrides either."
          >
            <Row label="Namespace" value={p.namespace} fallback="the chart's default" />
            <Row label="GPUs per node" value={p.nodes?.gpusPerNode} />
            {Object.entries(p.nodes?.gpuProductAliases ?? {}).map(([product, sels]) => (
              <Row key={product} label={`${product} (GPU alias)`} value={sels.join(" or ")} mono />
            ))}
            <Row
              label="Scheduler"
              value={p.schedule?.schedulerName}
              fallback="the chart's default"
            />
            <Row
              label="Priority class"
              value={p.schedule?.priorityClassName}
              fallback="the chart's default"
            />
          </Section>

          <Section
            title="Catalogs"
            hint="Where the models come from. With several, pages open in the one marked default, or ask which one first when none is; an upgrade stays on the catalog its release came from."
          >
            {catalogs.length > 0 ? (
              catalogs.map((c) => (
                <Row key={c.name} label={c.default ? `${c.name} (default)` : c.name} value={c.url} mono />
              ))
            ) : (
              <Row label="Catalog" value={undefined} fallback="the one in swissd's config file" />
            )}
          </Section>

          <Section title="Charts and images">
            <Row label="Chart repo" value={p.chartRepo} fallback="local chart path" />
            <Row label="Chart path" value={p.chartPath} />
            <Row
              label="Registry mirror"
              value={p.registry?.mirror}
              fallback="catalog repository as-is"
            />
          </Section>

          <Section
            title="Model paths"
            hint="model.localPath is built from the catalog's source.hf; {{hf}}, {{org}}, {{name}} and {{model}} expand."
          >
            <Row label="Path template" value={p.model.pathTemplate} mono />
          </Section>

          {p.model.overrides && Object.keys(p.model.overrides).length > 0 && (
            <Section
              title="Path overrides"
              hint="Keyed by catalog model name, for weights that do not sit where the template says."
            >
              {Object.entries(p.model.overrides).map(([k, v]) => (
                <Row key={k} label={k} value={v} mono />
              ))}
            </Section>
          )}

          <Section title="Routing">
            <Row
              label="Gateway"
              value={p.route?.gateway}
              fallback="no public URL; the status page shows the route only"
            />
            <Row label="Openresty ConfigMap" value={p.route?.nginxConfigMap} />
            <Row label="Openresty Service" value={p.route?.nginxService} />
            <Row label="Openresty selector" value={p.route?.nginxSelector} />
            <Row label="Entrypoint port" value={p.route?.nginxPort ?? 8080} />
            <Row label="Monitor ConfigMap" value={p.route?.monitorConfigMap} />
          </Section>

          <Section
            title="Entrypoint auth"
            hint="Used only by the serving and health checks. The profile names a Secret; the key itself is never stored here or shown."
          >
            {auth?.secretRef ? (
              <>
                <Row label="Key header" value={auth.header || "Authorization"} mono />
                <Row
                  label="Key prefix"
                  value={auth.prefix ?? (auth.header ? "" : "Bearer ")}
                  mono
                  fallback="none"
                />
                <Row
                  label="Secret"
                  value={`${auth.secretRef} → ${auth.secretKey || "apiKey"}`}
                  mono
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No key configured; the checks call the entrypoint unauthenticated.
              </p>
            )}
            {auth?.headers && Object.keys(auth.headers).length > 0 && (
              <>
                <dt className="text-muted-foreground">Static headers</dt>
                <dd className="space-y-0.5">
                  {Object.entries(auth.headers).map(([k, v]) => (
                    <div key={k} className="font-mono text-xs">
                      {k}: {v}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </Section>

          <Section title="Cache and scaler">
            <Row label="Cache" value={p.cache?.enabled ? "enabled" : "disabled"} />
            <Row label="Cache host path" value={p.cache?.hostPath} mono />
            <Row label="Scaler server" value={p.scaler?.serverAddress} />
            <Row label="SLO address" value={p.scaler?.sloAddress} fallback="http://slo-api.llm-scaler.svc:80" />
            <Row
              label="SLO token"
              value={
                p.scaler?.sloTokenSecret
                  ? `${p.scaler.sloTokenSecret} → ${p.scaler.sloTokenKey || "token"}`
                  : undefined
              }
              mono
              fallback="required"
            />
          </Section>

          {p.sites && p.sites.length > 0 && (
            <Section
              title="Other sites"
              hint="The swissd instances in other clusters, for the switcher in the header."
            >
              {p.sites.map((s, i) => (
                <Row key={`${s.name}-${i}`} label={s.name} value={s.url} mono />
              ))}
            </Section>
          )}

          {p.extra && Object.keys(p.extra).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Extra</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Site values merged into every plan that no named field covers.
                </p>
              </CardHeader>
              <CardContent>
                <Code lang="yaml">{toYaml(p.extra)}</Code>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// Repair opens on a stored profile that does not parse. The two halves of the
// editor start differently on purpose: the YAML tab holds the stored text,
// which is exactly what has to be edited, and the form -- which binds to a
// parsed profile and has none -- starts from the server's default.
function Repair({ data }: { data: ProfileResponse }) {
  const template = useQuery({ queryKey: ["profileTemplate"], queryFn: api.profileTemplate });
  if (template.isPending) return <Loading what="the site profile" />;
  if (template.error) return <ErrorState what="the site profile" error={template.error} />;
  if (!template.data.profile) {
    return <ErrorState what="the site profile" error={new Error("the default profile does not parse")} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Site profile</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{data.source}</p>
      </div>
      <Card>
        <CardContent className="p-4 text-sm">
          <div className="font-medium text-warning">
            The stored profile does not parse, so swissd has nothing to compose against.
          </div>
          <pre className="mt-2 overflow-x-auto font-mono text-xs text-muted-foreground">{data.error}</pre>
          <p className="mt-2 text-muted-foreground">
            The YAML tab below opens on the stored document — fix the line it names and save.
            The form tab starts from the default instead, and saving from it would replace the
            whole profile.
          </p>
        </CardContent>
      </Card>
      <ProfileEditor profile={template.data.profile} yaml={data.yaml ?? ""} submitLabel="Save profile" />
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">{children}</dl>
      </CardContent>
    </Card>
  );
}

// An unset field shows its fallback rather than a dash, because "unset" here
// means a default is in force and the default is the useful part.
function Row({
  label,
  value,
  fallback,
  mono,
}: {
  label: string;
  value?: string | number;
  fallback?: string;
  mono?: boolean;
}) {
  const text = value === undefined || value === null || value === "" ? fallback : String(value);
  if (!text) return null;
  const unset = value === undefined || value === null || value === "";
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          (mono && !unset ? "font-mono text-xs " : "") +
          (unset ? "text-muted-foreground italic break-all" : "break-all")
        }
      >
        {text}
      </dd>
    </>
  );
}
