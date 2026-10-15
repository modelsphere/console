import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DataSelect,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  FilterSelect,
  Input,
  PageBanner,
  Spinner,
  Toggle,
  cn,
} from "@modelsphere/ui";
import { Boxes, Library, MoreHorizontal, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, type CatalogInfo } from "@swiss/lib/api";
import { facetsOf, formatUplift, sorters, type Facets } from "@swiss/lib/catalog";
import { useCatalogChoice } from "@swiss/components/CatalogChoice";
import { useT } from "@/modules/inferences/i18n";
import { DeploySheet, type DeployTarget } from "@/modules/inferences/components/DeploySheet";
import { activeFilters, facetOptions, filtersFrom, matches, modelPath, withFilters, withoutFilters, type CatalogFilters } from "@/modules/inferences/catalog-lib";

export function CatalogPage() {
  const t = useT();
  const p = useModulePath();
  const [params, setParams] = useSearchParams();
  const choice = useCatalogChoice();
  const catalog = useQuery({
    queryKey: ["catalog", choice.selected],
    queryFn: () => api.catalog(choice.selected),
    enabled: !!choice.selected,
  });
  const all = useMemo(() => catalog.data?.models.map(facetsOf) ?? [], [catalog.data]);
  const options = useMemo(() => facetOptions(all), [all]);
  const f = filtersFrom(params);
  const set = (patch: Partial<CatalogFilters>) => setParams((prev) => withFilters(prev, patch), { replace: true });
  const shown = all.filter((x) => matches(x, f)).sort(sorters[f.sort]);
  const filtered = activeFilters(f).length > 0;
  const [deploying, setDeploying] = useState<DeployTarget | null>(null);
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const onDeploy = cluster.data?.allowDeploy ? (model: string, catalog: string) => setDeploying({ kind: "deploy", model, catalog }) : undefined;

  const facet = (key: "family" | "engine" | "hardware" | "tag") => (
    <FilterSelect
      title={t(`catalog.${key}`)}
      options={options[key].map((o) => ({ value: o.value, label: o.value, description: String(o.count) }))}
      value={f[key]}
      onValueChange={(v) => set({ [key]: v })}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <PageBanner title={t("catalog.title")} description={t("catalog.description")} icon={<Library className="size-5" />} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("catalog.search")} className="w-64" />
            {choice.several && (
              <FilterSelect
                title={t("catalog.catalog")}
                options={choice.catalogs.map((c) => ({ value: c.name, label: c.name, description: c.schema === "v1" ? t("catalog.legacy") : undefined }))}
                value={choice.selected}
                onValueChange={(v) => v && choice.choose(v)}
              />
            )}
            {catalog.data?.schema === "v1" && (
              <Badge variant="warning" title={t("catalog.legacyHint")}>
                {t("catalog.legacy")}
              </Badge>
            )}
            {facet("family")}
            {facet("engine")}
            {facet("hardware")}
            {facet("tag")}
            <Toggle size="sm" variant="outline" pressed={f.tuned} onPressedChange={(v) => set({ tuned: v })}>
              {t("catalog.tuned")}
            </Toggle>
            <Toggle size="sm" variant="outline" pressed={f.hidedep} onPressedChange={(v) => set({ hidedep: v })}>
              {t("catalog.hidedep")}
            </Toggle>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => setParams((prev) => withoutFilters(prev), { replace: true })}>
                {t("catalog.clear")}
              </Button>
            )}
            <div className="ms-auto flex items-center gap-2">
              <span className="text-sm text-muted-foreground tabular-nums">
                {filtered ? t("catalog.countFiltered", { shown: shown.length, n: all.length }) : t("catalog.count", { n: all.length })}
              </span>
              <DataSelect
                className="w-28"
                value={f.sort}
                onValueChange={(v) => set({ sort: v as CatalogFilters["sort"] })}
                options={[
                  { value: "name", label: t("catalog.sortName") },
                  { value: "uplift", label: t("catalog.sortUplift") },
                  { value: "family", label: t("catalog.sortFamily") },
                ]}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {choice.isPending || catalog.isPending && !!choice.selected ? (
              <div className="flex justify-center py-16">
                <Spinner size="lg" />
              </div>
            ) : choice.error || catalog.error ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>{String((choice.error ?? catalog.error)?.message)}</AlertDescription>
              </Alert>
            ) : !choice.selected ? (
              <NoCatalog catalogs={choice.catalogs} choose={choice.choose} />
            ) : shown.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t(filtered ? "catalog.noMatch" : "catalog.empty")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((x) => (
                  <ModelCard key={x.model.name} x={x} catalog={choice.selected} onDeploy={onDeploy} to={p(modelPath(x.model.name, choice.selected))} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <DeploySheet target={deploying} onClose={() => setDeploying(null)} />
    </div>
  );
}

function ModelCard({ x, catalog, to, onDeploy }: { x: Facets; catalog: string; to: string; onDeploy?: (model: string, catalog: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const m = x.model;
  const open = () => navigate(to);
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring",
        x.deprecated && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Boxes className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link to={to} onClick={(e) => e.stopPropagation()} className="block font-medium break-words hover:underline">
            {m.displayName || m.name}
          </Link>
          {m.family && <div className="text-xs text-muted-foreground">{m.family}</div>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={t("common:table.actions")} />} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={open}>{t("actions.detail")}</DropdownMenuItem>
            {onDeploy && <DropdownMenuItem onClick={() => onDeploy(m.name, catalog)}>{t("model.deploy")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate" title={m.source.hf}>
          {m.source.hf}
        </span>
        {x.version && <span>v{x.version}</span>}
        <span>{t("catalog.variants", { n: x.variants.length })}</span>
      </div>

      {m.description && <p className="line-clamp-2 text-sm text-muted-foreground">{m.description}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {x.deprecated && <Badge variant="warning">{t("catalog.deprecated")}</Badge>}
        {x.cmp?.uplift != null && <Badge variant="success">{t("catalog.uplift", { pct: formatUplift(x.cmp.uplift) })}</Badge>}
        {(m.tags ?? []).slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        <span className="ms-auto flex gap-1">
          {[...new Set(x.engines)].map((e) => (
            <Badge key={e} variant="outline">
              {e}
            </Badge>
          ))}
        </span>
      </div>
    </div>
  );
}

function NoCatalog({ catalogs, choose }: { catalogs: CatalogInfo[]; choose: (name: string) => void }) {
  const t = useT();
  const p = useModulePath();
  if (catalogs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("catalog.noCatalog")}</EmptyTitle>
          <EmptyDescription>
            <Link to={p("site-profile")} className="underline">
              {t("catalog.noCatalogAction")}
            </Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-3 py-8">
      <p className="text-sm text-muted-foreground">{t("catalog.choose")}</p>
      {catalogs.map((c) => (
        <button key={c.name} type="button" onClick={() => choose(c.name)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left hover:border-primary/40">
          <span className="font-medium">{c.name}</span>
          {c.default && <Badge variant="secondary">{t("catalog.default")}</Badge>}
          {c.schema === "v1" && (
            <Badge variant="warning" title={t("catalog.legacyHint")}>
              {t("catalog.legacy")}
            </Badge>
          )}
          <span className="ms-auto truncate text-xs text-muted-foreground">{c.source}</span>
        </button>
      ))}
    </div>
  );
}
