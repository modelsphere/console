import { useQuery } from "@tanstack/react-query";
import { api, type Entry } from "@swiss/lib/api";
import { toYaml } from "@swiss/lib/yaml";
import { Badge } from "@swiss/components/ui/badge";
import { Dialog } from "@swiss/components/ui/dialog";
import { DiffView } from "@swiss/components/DiffView";
import { ErrorState } from "@swiss/components/States";

// The catalog variant this release deployed, against the same one as published
// now. Values are the projection compose deploys. Engine and chart sit beside
// them: a chart.version change never enters those values, but the plan recorded
// the chart that was installed. Description and requires were not recorded, so
// they are left out — showing them would mark every release as changed.
export function CatalogModelDiff({
  open,
  onClose,
  model,
  version,
  variant,
  catalog,
  engine,
  chart,
  deployed,
}: {
  open: boolean;
  onClose: () => void;
  model?: string;
  version?: string;
  variant?: string;
  catalog?: string;
  engine?: string;
  chart?: { name?: string; version?: string };
  deployed?: Record<string, unknown>;
}) {
  const ready = !!model && !!version && !!variant;
  const entry = useQuery({
    queryKey: ["catalog-model", catalog, model, version],
    queryFn: () => api.model(model!, version, catalog),
    enabled: open && ready,
    retry: false,
    staleTime: Infinity,
  });

  const published = entry.data ? catalogValues(entry.data.entry, variant!) : undefined;
  const publishedVariant = entry.data?.entry.variants.find((item) => item.id === variant);
  const diff =
    published?.tree && publishedVariant
      ? lineDiff(
          modelText({ engine, chart, values: deployed }),
          modelText({
            engine: publishedVariant.engine,
            chart: publishedVariant.chart,
            values: published.tree,
          }),
        )
      : "";
  const changed = diff.split("\n").some((line) => line.startsWith("+") || line.startsWith("-"));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Catalog comparison"
      subtitle={<ComparisonNote />}
    >
      {!ready ? (
        <p className="text-sm text-muted-foreground">This release's plan has no version to diff.</p>
      ) : entry.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the catalog model…</p>
      ) : entry.error ? (
        <ErrorState what="the catalog model" error={entry.error} />
      ) : published?.error ? (
        <p className="text-sm text-muted-foreground">{published.error}</p>
      ) : published && !published.tree ? (
        <p className="text-sm text-muted-foreground">
          The catalog no longer lists variant {variant} on version {version}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {changed ? <Badge variant="warning">changes</Badge> : <Badge variant="success">no changes</Badge>}
            <span className="text-muted-foreground">
              {changed ? (
                <>
                  <span className="text-destructive">Removed</span> is what the release stored.{" "}
                  <span className="text-success">Added</span> is the catalog now.
                </>
              ) : (
                "Nothing differs in the compared fields."
              )}
            </span>
          </div>
          {changed && <DiffView output={diff} />}
        </div>
      )}
    </Dialog>
  );
}

export function catalogValues(
  entry: Entry,
  variantId: string,
): { tree?: Record<string, unknown>; error?: string } {
  const variant = entry.variants.find((item) => item.id === variantId);
  if (!variant) return {};
  const tree: Record<string, unknown> = structuredClone(variant.values ?? {});
  const name = setPath(tree, "model.name", entry.servedName || entry.name);
  if (name) return { error: name };
  const gpus = setPath(tree, "model.gpus", String(variant.requires.gpus));
  if (gpus) return { error: gpus };
  if (variant.image) {
    for (const [key, value] of [
      ["image.repository", variant.image.repository],
      ["image.tag", variant.image.tag],
      ["image.digest", variant.image.digest],
    ] as const) {
      if (!value) continue;
      const err = setPath(tree, key, value);
      if (err) return { error: err };
    }
  }
  return { tree };
}

function ComparisonNote() {
  return (
    <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-foreground/70">Compared</dt>
      <dd>engine, chart name, chart version, variant values, served name, GPU count, image</dd>
      <dt className="text-foreground/70">Left out</dt>
      <dd>description, other requires</dd>
      <dt className="text-foreground/70">Hint</dt>
      <dd>may not change the deployed manifest</dd>
    </dl>
  );
}

function setPath(tree: Record<string, unknown>, path: string, value: unknown): string | undefined {
  const segs = path.split(".");
  let cur = tree;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = cur[segs[i]];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      cur[segs[i]] = created;
      cur = created;
      continue;
    }
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return `cannot set ${path}: ${segs.slice(0, i + 1).join(".")} is not a map`;
    }
    cur = next as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

// chart is name and version only. Repo and path are the site profile's, not the model's.
export function modelText(input: {
  engine?: string;
  chart?: { name?: string; version?: string };
  values?: Record<string, unknown>;
}): string {
  const doc: Record<string, unknown> = {};
  if (input.chart?.name || input.chart?.version) {
    const chart: Record<string, string> = {};
    if (input.chart.name) chart.name = input.chart.name;
    if (input.chart.version) chart.version = input.chart.version;
    doc.chart = chart;
  }
  if (input.engine) doc.engine = input.engine;
  if (input.values && Object.keys(input.values).length) doc.values = input.values;
  return toYaml(sortKeys(doc)).replace(/\n$/, "");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

export function lineDiff(before: string, after: string): string {
  const a = split(before);
  const b = split(after);
  const n = a.length;
  const m = b.length;
  const next = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      next[i][j] = a[i] === b[j] ? next[i + 1][j + 1] + 1 : Math.max(next[i + 1][j], next[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(" " + a[i]);
      i++;
      j++;
    } else if (next[i + 1][j] >= next[i][j + 1]) {
      out.push("-" + a[i]);
      i++;
    } else {
      out.push("+" + b[j]);
      j++;
    }
  }
  while (i < n) out.push("-" + a[i++]);
  while (j < m) out.push("+" + b[j++]);
  return out.join("\n");
}

function split(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
