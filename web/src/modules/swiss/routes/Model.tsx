import { Link, useParams, useSearchParams } from "@swiss/lib/host";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Rocket } from "lucide-react";
import { api } from "@swiss/lib/api";
import { comparison, formatUplift, reportLink, variantKind, workloadSummary } from "@swiss/lib/catalog";
import { Button } from "@swiss/components/ui/button";
import { ErrorState, Loading } from "@swiss/components/States";
import { VariantCard } from "@swiss/components/VariantCard";
import { CatalogBadge, CatalogGate, useCatalogChoice, withCatalog } from "@swiss/components/CatalogChoice";

export function Model() {
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const version = params.get("version") ?? "";
  // A model belongs to one catalog: the same name in another is another model.
  const choice = useCatalogChoice();
  const selected = choice.selected;
  const model = useQuery({
    queryKey: ["model", selected, name, version],
    queryFn: () => api.model(name, version || undefined, selected),
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

  const e = model.data.entry;
  const indexed = catalog.data?.index.models.find((m) => m.name === name);
  // Roles and the uplift come from the model's recorded tuning, via the index.
  // The entry itself carries none: it is metadata, not part of the version.
  const tuning = indexed?.tuning;
  const cmp = comparison(e.variants, e.version, tuning);
  const report = cmp ? reportLink(catalog.data?.index.site, e.name, cmp.report) : undefined;
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
          {e.displayName ?? e.name}
          <CatalogBadge name={selected} show={choice.several} />
        </h1>
        {e.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{e.description}</p>}
      </div>

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Weights" value={`${e.source.hf}${e.source.sizeGiB ? ` · ${e.source.sizeGiB} GiB` : ""}`} />
        <Field label="Served as" value={e.servedName ?? e.name} />
        {e.license && <Field label="License" value={e.license} />}
        <Field label="Version" value={e.version} />
        {e.digest && <Field label="Digest" value={e.digest.slice(0, 19)} />}
      </dl>

      <VersionPicker
        name={name}
        current={e.version}
        versions={
          indexed?.versions.map((v) => v.version) ?? []
        }
        onPick={(v) =>
          setParams((prev) => {
            const next = new URLSearchParams(prev);
            if (v) next.set("version", v);
            else next.delete("version");
            return next;
          })
        }
      />

      <div>
        <h2 className="mb-2 text-sm font-medium">Variants</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {e.variants.map((v) => (
            <VariantCard
              key={v.id}
              v={v}
              kind={variantKind(v, tuning)}
              uplift={
                cmp?.optimized === v.id && cmp.uplift != null
                  ? formatUplift(cmp.uplift) + (cmp.version !== e.version ? ` on v${cmp.version}` : "")
                  : undefined
              }
              upliftTitle={cmp?.optimized === v.id && cmp.workloads.length ? workloadSummary(cmp) : undefined}
              report={cmp?.optimized === v.id ? report : undefined}
              workloads={cmp?.optimized === v.id && cmp.workloads.length ? cmp.workloads : undefined}
              nodes={nodes.data?.nodes}
              action={
                <Link
                  to={withCatalog(
                    `/deploy/${encodeURIComponent(e.name)}?variant=${encodeURIComponent(v.id)}` +
                      (version ? `&version=${encodeURIComponent(version)}` : ""),
                    selected,
                  )}
                >
                  <Button size="sm">
                    <Rocket className="size-4" /> Deploy
                  </Button>
                </Link>
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionPicker({
  name,
  current,
  versions,
  onPick,
}: {
  name: string;
  current: string;
  versions: string[];
  onPick: (v: string) => void;
}) {
  if (versions.length < 2) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Version</span>
      <select
        className="rounded-md border bg-background px-2 py-1 text-sm"
        value={current}
        onChange={(e) => onPick(e.target.value)}
        aria-label={`version of ${name}`}
      >
        {versions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        a deploy records the version and its digest
      </span>
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
