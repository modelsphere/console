import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DetailHeader,
  Empty,
  EmptyHeader,
  EmptyTitle,
  PanelTabs,
  PropertyList,
  SectionCard,
  Skeleton,
  Tabs,
  TabsContent,
  cn,
} from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, type ModelVariant, type Node } from "@swiss/lib/api";
import { comparison, formatUplift, httpLink, reportLink, sharedVersion, variantKind, workloadSummary, type Kind } from "@swiss/lib/catalog";
import { gpuModels, vendorLabel } from "@swiss/lib/gpu";
import { useCatalogChoice } from "@swiss/components/CatalogChoice";
import { useT } from "@/modules/inferences/i18n";
import { catalogPath, fitness } from "@/modules/inferences/catalog-lib";
import { DeploySheet, type DeployTarget } from "@/modules/inferences/components/DeploySheet";

export function ModelPage() {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "info" ? "info" : "variants";
  const choice = useCatalogChoice();
  // The default variant resolved, for what only its file says: the served name.
  const model = useQuery({
    queryKey: ["model", choice.selected, name, "", ""],
    queryFn: () => api.model(name, { catalog: choice.selected }),
    enabled: !!choice.selected,
  });
  const index = useQuery({ queryKey: ["catalog", choice.selected], queryFn: () => api.catalog(choice.selected), enabled: !!choice.selected });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, retry: false });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const [deploying, setDeploying] = useState<DeployTarget | null>(null);
  const onDeploy = cluster.data?.allowDeploy ? (x: { model: string; catalog: string; variant?: string }) => setDeploying({ kind: "deploy", ...x }) : undefined;

  const setParam = (k: string, v?: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set(k, v);
      else next.delete(k);
      return next;
    }, { replace: true });

  const back = () => navigate(p(catalogPath(choice.selected)));
  const page = (body: React.ReactNode) => (
    <div className="h-full overflow-auto bg-surface-page">
      <div className="flex flex-col gap-4 p-4">{body}</div>
    </div>
  );

  if (model.isPending || choice.isPending) return page(<Skeleton className="h-40 w-full" />);
  if (model.error || !model.data) {
    return page(
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>{String(model.error?.message ?? choice.error?.message ?? "")}</AlertDescription>
      </Alert>,
    );
  }

  const { model: m, variant: resolved, schema } = model.data;
  const deprecated = m.deprecated;
  const cmp = comparison(m.variants, m.tuning);
  const site = index.data?.site;
  const variants = [...m.variants].sort((a, b) => Number(!!b.default) - Number(!!a.default));
  // On v1 every variant is at its entry's version; on v2 each is at its own.
  const shared = sharedVersion(variants);
  const digest = shared ? variants[0].digest : undefined;

  return page(
    <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "info" ? "info" : undefined)} className="flex-col gap-4">
      <DetailHeader
        onBack={back}
        backLabel={t("model.back")}
        title={m.displayName || m.name}
        subtitle={m.description}
        notice={deprecated ? { tone: "warning", title: t("model.deprecated", { reason: typeof deprecated === "string" ? deprecated : "" }) } : undefined}
        actions={
          onDeploy
            ? [{ key: "deploy", label: t("model.deploy"), onClick: () => onDeploy({ model: name, catalog: choice.selected }) }]
            : undefined
        }
        meta={[
          { label: t("model.fields.family"), value: m.family || "-" },
          { label: t("model.fields.source"), value: <span title={m.source.hf}>{m.source.hf}</span> },
          { label: t("model.fields.version"), value: shared ?? t("model.perVariant") },
          {
            label: t("model.fields.schema"),
            value:
              schema === "v1" ? (
                <Badge variant="warning" title={t("catalog.legacyHint")}>
                  {t("catalog.legacy")}
                </Badge>
              ) : (
                schema
              ),
          },
        ]}
        metaColumns={4}
      />
      <PanelTabs
        items={[
          { value: "variants", label: t("model.tabs.variants"), count: variants.length },
          { value: "info", label: t("model.tabs.info") },
        ]}
      />

      <TabsContent value="variants" className="p-0">
        {variants.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("model.noVariants")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {variants.map((v) => (
              <VariantCard
                key={v.id}
                v={v}
                kind={variantKind(v, m.tuning)}
                version={shared ? undefined : v.version}
                uplift={cmp && cmp.optimized === v.id ? cmp : null}
                report={cmp && cmp.optimized === v.id ? reportLink(site, name, cmp.report) : undefined}
                nodes={nodes.data?.nodes}
                onDeploy={onDeploy ? () => onDeploy({ model: name, catalog: choice.selected, variant: v.id }) : undefined}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="info" className="p-0">
        <SectionCard title={t("model.tabs.info")}>
          <PropertyList
            columns={1}
            labelClassName="w-28 shrink-0"
            items={[
              { label: t("model.fields.source"), value: [m.source.hf, m.source.revision].filter(Boolean).join(" @ ") },
              { label: t("model.fields.servedName"), value: resolved.servedName },
              { label: t("model.fields.version"), value: shared },
              { label: t("model.fields.digest"), value: digest && <code className="font-mono text-xs break-all">{digest}</code> },
              { label: t("model.fields.tags"), value: m.tags?.length ? m.tags.join(", ") : undefined },
              { label: t("model.fields.sizeLabel"), value: m.source.sizeGiB ? t("model.fields.size", { n: m.source.sizeGiB }) : undefined },
            ].filter((i) => i.value)}
          />
        </SectionCard>
      </TabsContent>
      <DeploySheet target={deploying} onClose={() => setDeploying(null)} />
    </Tabs>,
  );
}

function VariantCard({
  v,
  kind,
  version,
  uplift,
  report,
  nodes,
  onDeploy,
}: {
  v: ModelVariant;
  kind: Kind;
  // The variant's own version, when the model's variants are not all at one.
  version?: string;
  uplift: ReturnType<typeof comparison>;
  report?: string;
  nodes?: Node[];
  onDeploy?: () => void;
}) {
  const t = useT();
  const r = v.requires;
  const fit = fitness(v, nodes);
  const docs = httpLink(v.link);
  return (
    <SectionCard
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{v.id}</span>
          {version && <span className="text-xs text-muted-foreground">v{version}</span>}
          {v.default && <Badge variant="secondary">{t("model.default")}</Badge>}
          {v.deprecated && (
            <Badge variant="warning" title={typeof v.deprecated === "string" ? v.deprecated : undefined}>
              {t("catalog.deprecated")}
            </Badge>
          )}
          {kind.optimized && <Badge variant="success">{t("model.optimized")}</Badge>}
          {kind.baseline && <Badge variant="outline">{t("model.baseline")}</Badge>}
          <Badge variant="outline">{v.engine}</Badge>
        </span>
      }
      actions={onDeploy && <Button size="sm" onClick={onDeploy}>{t("model.deploy")}</Button>}
    >
      <div className="space-y-3 text-sm">
        {v.description && <p className="text-muted-foreground">{v.description}</p>}
        <PropertyList
          columns={2}
          items={[
            { label: "GPU", value: r.nodes && r.nodes > 1 ? t("model.gpusNodes", { n: r.gpus, nodes: r.nodes }) : t("model.gpus", { n: r.gpus }) },
            { label: t("model.runsOn"), value: r.gpuProduct?.length ? gpuModels(r).join(" / ") : t("model.anyGpu", { vendor: vendorLabel(r.vendor) }) },
            { label: t("model.topology"), value: r.topology || "-" },
            { label: t("model.chart"), value: `${v.chart.name}-${v.chart.version}` },
            ...(r.rdma ? [{ label: t("model.rdma"), value: "✓" }] : []),
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          {uplift?.uplift != null && (
            <Badge variant="success" title={workloadSummary(uplift)}>
              {t("catalog.uplift", { pct: formatUplift(uplift.uplift) })}
            </Badge>
          )}
          <span className={cn("text-xs", fit ? (fit.ok ? "text-success" : "text-warning") : "text-muted-foreground")}>
            {fit ? t(fit.ok ? "model.fitOk" : "model.fitBad", { n: fit.matching, needed: fit.needed }) : t("model.fitUnknown")}
          </span>
          <span className="ms-auto flex gap-3 text-xs">
            {report && (
              <a href={report} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {t("model.report")}
              </a>
            )}
            {docs && (
              <a href={docs} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {t("model.docs")}
              </a>
            )}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
