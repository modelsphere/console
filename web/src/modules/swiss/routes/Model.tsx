import { Link, useParams } from "@swiss/lib/host";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Rocket } from "lucide-react";
import { api } from "@swiss/lib/api";
import { comparison, formatUplift, reportLink, sharedVersion, variantKind, workloadSummary } from "@swiss/lib/catalog";
import { Badge } from "@swiss/components/ui/badge";
import { Button } from "@swiss/components/ui/button";
import { ErrorState, Loading } from "@swiss/components/States";
import { VariantCard } from "@swiss/components/VariantCard";
import { CatalogBadge, CatalogGate, SchemaBadge, useCatalogChoice, withCatalog } from "@swiss/components/CatalogChoice";

export function Model() {
  const { name = "" } = useParams();
  // A model belongs to one catalog: the same name in another is another model.
  const choice = useCatalogChoice();
  const selected = choice.selected;
  // The default variant resolved, for what only its file says: the served name.
  const model = useQuery({
    queryKey: ["model", selected, name, "", ""],
    queryFn: () => api.model(name, { catalog: selected }),
    enabled: !!selected,
  });
  const catalog = useQuery({
    queryKey: ["catalog", selected],
    queryFn: () => api.catalog(selected),
    enabled: !!selected,
  });
  // Node facts are a separate, non-blocking query: a variant list is still
  // worth showing when the fit check cannot be computed.
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes });

  if (choice.isPending) return <Loading what="catalogs" />;
  if (!selected) {
    return <CatalogGate catalogs={choice.catalogs} named={choice.named} choose={choice.choose} what={`look up ${name} in`} />;
  }
  if (model.isPending) return <Loading what={name} />;
  if (model.error) return <ErrorState what={name} error={model.error} />;

  const m = model.data.model;
  // On v1 every variant is at its entry's version; on v2 each is at its own.
  const shared = sharedVersion(m.variants);
  const cmp = comparison(m.variants, m.tuning);
  const report = cmp ? reportLink(catalog.data?.site, m.name, cmp.report) : undefined;
  return (
    <div className="space-y-5">
      <Link
        to={withCatalog("/catalog", selected)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Catalog
      </Link>

      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          {m.displayName ?? m.name}
          <CatalogBadge name={selected} show={choice.several} />
          <SchemaBadge schema={model.data.schema} />
        </h1>
        {m.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{m.description}</p>}
      </div>

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Weights" value={`${m.source.hf}${m.source.sizeGiB ? ` · ${m.source.sizeGiB} GiB` : ""}`} />
        <Field label="Served as" value={model.data.variant.servedName} />
        <Field label="Version" value={shared ?? "per variant"} />
        {shared && <Field label="Digest" value={m.variants[0].digest.slice(0, 19)} />}
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-medium">Variants</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {m.variants.map((v) => (
            <VariantCard
              key={v.id}
              v={v}
              kind={variantKind(v, m.tuning)}
              tags={!shared && <Badge variant="muted">v{v.version}</Badge>}
              uplift={
                cmp?.optimized === v.id && cmp.uplift != null
                  ? formatUplift(cmp.uplift) + (cmp.older ? ` on v${cmp.version}` : "")
                  : undefined
              }
              upliftTitle={cmp?.optimized === v.id && cmp.workloads.length ? workloadSummary(cmp) : undefined}
              report={cmp?.optimized === v.id ? report : undefined}
              workloads={cmp?.optimized === v.id && cmp.workloads.length ? cmp.workloads : undefined}
              nodes={nodes.data?.nodes}
              action={
                <Link to={withCatalog(`/deploy/${encodeURIComponent(m.name)}?variant=${encodeURIComponent(v.id)}`, selected)}>
                  <Button size="sm">
                    <Rocket className="size-4" /> Deploy
                  </Button>
                </Link>
              }
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Each variant deploys at its current version; an older one is chosen on the deploy page.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
