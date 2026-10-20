import { useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CodeBlock,
  PageBanner,
  PropertyList,
  SectionCard,
  Sheet,
  SheetBody,
  SheetCancelButton,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from "@modelsphere/ui";
import { SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, type SiteProfile } from "@swiss/lib/api";
import { toYaml } from "@swiss/lib/yaml";
import { FEATURES, featureOn } from "@swiss/lib/profile";
import { useT } from "@/modules/inferences/i18n";
import { ProfileEditorBody, SaveButton, useProfileEditor } from "@/modules/inferences/components/ProfileEditor";
import { catalogTokenKey, listSecrets } from "@/modules/inferences/catalog-write-api";
import { markedWritable } from "@/modules/inferences/catalog-write-lib";

export function SiteProfilePage() {
  const t = useT();
  const p = useModulePath();
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  // A stored profile that does not parse has nothing for the form to bind to:
  // the form starts from the default, and the YAML tab holds the stored text,
  // which is what has to be fixed.
  const template = useQuery({ queryKey: ["profile-template"], queryFn: api.profileTemplate, enabled: !!profile.data && !profile.data.profile });
  const [editing, setEditing] = useState(false);

  if (profile.data && !profile.data.profile && !profile.data.error) return <Navigate to={p("setup")} replace />;
  const d = profile.data;
  const start = d?.profile ?? template.data?.profile;

  return (
    <div className="flex h-full flex-col">
      <PageBanner
        title={t("profile.title")}
        description={t("profile.description")}
        icon={<SlidersHorizontal className="size-5" />}
        actions={start && <Button onClick={() => setEditing(true)}>{t("profile.edit")}</Button>}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto bg-surface-page p-4">
        {profile.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : profile.error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{profile.error.message}</AlertDescription>
          </Alert>
        ) : (
          <>
            {d?.error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>
                  <p>{t("profile.parseError", { error: d.error })}</p>
                  <p>{t("profile.repairHint")}</p>
                </AlertDescription>
              </Alert>
            )}
            {d?.source && <p className="text-xs text-muted-foreground">{t("profile.source", { source: d.source })}</p>}
            {d?.profile && <ProfileView p={d.profile} />}
          </>
        )}
      </div>
      {editing && d && start && <EditSheet profile={start} yaml={d.yaml ?? ""} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ProfileView({ p }: { p: SiteProfile }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const v = (x: unknown) => (x === undefined || x === null || x === "" ? <span className="text-muted-foreground">{t("profile.unset")}</span> : String(x));
  const onOff = (on: boolean) => t(on ? "profile.on" : "profile.off");
  const mono = (x?: string) => (x ? <code className="font-mono text-xs break-all">{x}</code> : v(x));
  const aliases = (a?: Record<string, string[]>) =>
    a && Object.keys(a).length ? (
      <span className="flex flex-col gap-1">
        {Object.entries(a).map(([product, sels]) => (
          <span key={product} className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{product}</span>
            {sels.map((sel) => (
              <Badge key={sel} variant="secondary" className="font-mono font-normal">
                {sel}
              </Badge>
            ))}
          </span>
        ))}
      </span>
    ) : (
      v(undefined)
    );
  const kv = (r?: Record<string, string>) => (r && Object.keys(r).length ? <span className="flex flex-wrap gap-1">{Object.entries(r).map(([k, x]) => <Badge key={k} variant="secondary" className="font-mono font-normal">{k}={x}</Badge>)}</span> : v(undefined));
  const card = (g: string, items: { label: string; value: React.ReactNode }[]) => (
    <SectionCard title={t(`profile.groups.${g}`)}>
      <PropertyList columns={1} labelClassName="w-40 shrink-0" items={items} />
    </SectionCard>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {card("placement", [
        { label: f("name"), value: v(p.name) },
        { label: f("namespace"), value: v(p.namespace) },
        { label: f("scheduler"), value: v(p.schedule?.schedulerName) },
        { label: f("priorityClass"), value: v(p.schedule?.priorityClassName) },
        { label: f("gpusPerNode"), value: v(p.nodes?.gpusPerNode) },
        { label: f("gpuAliases"), value: aliases(p.nodes?.gpuProductAliases) },
      ])}
      {card("catalog", [
        {
          label: f("catalogs"),
          value: p.catalogs?.length ? (
            <span className="flex flex-col gap-1">
              {p.catalogs.map((c) => (
                <span key={c.name} className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.default && <Badge variant="secondary">{f("catalogDefault")}</Badge>}
                  {c.schemaVersion === "v2" ? (
                    <Badge variant="outline">v2</Badge>
                  ) : (
                    <Badge variant="warning" title={t("catalog.legacyHint")}>
                      {t("catalog.legacy")}
                    </Badge>
                  )}
                  <code className="truncate font-mono text-xs text-muted-foreground">{c.url}</code>
                  {markedWritable(p, c.name) && <CatalogToken catalog={c.name} />}
                </span>
              ))}
            </span>
          ) : (
            mono(p.catalog)
          ),
        },
        { label: f("chartRepo"), value: mono(p.chartRepo) },
        { label: f("chartPath"), value: mono(p.chartPath) },
        { label: f("mirror"), value: mono(p.registry?.mirror) },
      ])}
      {card("model", [
        { label: f("pathTemplate"), value: mono(p.model?.pathTemplate) },
        { label: f("overrides"), value: kv(p.model?.overrides) },
      ])}
      {card("routing", [
        { label: f("routeEnabled"), value: onOff(!!p.route?.enabled) },
        { label: f("gateway"), value: mono(p.route?.gateway) },
        { label: f("nginxConfigMap"), value: mono(p.route?.nginxConfigMap) },
        { label: f("nginxService"), value: mono(p.route?.nginxService) },
        { label: f("nginxSelector"), value: mono(p.route?.nginxSelector) },
        { label: f("nginxPort"), value: v(p.route?.nginxPort) },
        { label: f("monitorConfigMap"), value: mono(p.route?.monitorConfigMap) },
      ])}
      {card("auth", [
        { label: f("secretRef"), value: mono(p.route?.auth?.secretRef) },
        { label: f("secretKey"), value: mono(p.route?.auth?.secretKey) },
        { label: f("header"), value: v(p.route?.auth?.header) },
        { label: f("prefix"), value: v(p.route?.auth?.prefix) },
        { label: f("headers"), value: kv(p.route?.auth?.headers) },
      ])}
      {card("scaler", [
        { label: f("cache"), value: p.cache?.enabled ? mono(p.cache.hostPath) || "✓" : v(undefined) },
        { label: f("serverAddress"), value: mono(p.scaler?.serverAddress) },
        { label: f("sloAddress"), value: mono(p.scaler?.sloAddress) },
        { label: f("sloTokenSecret"), value: mono(p.scaler?.sloTokenSecret) },
        { label: f("sloTokenKey"), value: mono(p.scaler?.sloTokenKey) },
        { label: f("serverHeaders"), value: kv(p.scaler?.serverHeaders) },
      ])}
      {card(
        "defaults",
        FEATURES.map((k) => ({ label: t(`profile.features.${k}`), value: onOff(featureOn(p.defaults, k)) })),
      )}
      {!!p.sites?.length &&
        card(
          "sites",
          p.sites.map((s) => ({ label: s.name, value: mono(s.url) })),
        )}
      {p.extra && Object.keys(p.extra).length > 0 && (
        <SectionCard title={t("profile.groups.extra")}>
          <CodeBlock language="yaml" value={toYaml(p.extra)} />
        </SectionCard>
      )}
    </div>
  );
}

// A writable catalog, and whether swissd holds its token; the token is set in the editor.
function CatalogToken({ catalog }: { catalog: string }) {
  const t = useT();
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: listSecrets, retry: false });
  const set = !!secrets.data?.keys.includes(catalogTokenKey(catalog));
  return (
    <>
      <Badge variant="outline">{t("profile.fields.catalogWritable")}</Badge>
      {secrets.data && <Badge variant={set ? "success" : "warning"}>{t(set ? "profile.token.set" : "profile.token.none")}</Badge>}
    </>
  );
}

function EditSheet({ profile, yaml, onClose }: { profile: SiteProfile; yaml: string; onClose: () => void }) {
  const t = useT();
  const editor = useProfileEditor(profile, yaml, onClose);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dirty={editor.dirty} onDiscard={onClose}>
      <SheetContent size="2xl" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("profile.editTitle")}</SheetTitle>
          <SheetDescription>{t("profile.editDescription")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 overflow-auto bg-surface-page px-5 py-4">
          <ProfileEditorBody editor={editor} collapsible />
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <SheetCancelButton />
          <SaveButton editor={editor} label={t("profile.save")} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
