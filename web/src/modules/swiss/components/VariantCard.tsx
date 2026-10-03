import { ChartColumn, ExternalLink } from "lucide-react";
import type { IndexVariant, Node } from "@swiss/lib/api";
import { type Kind, httpLink, UPLIFT_HELP } from "@swiss/lib/catalog";
import { gpuCount, matchesVendor, vendorLabel } from "@swiss/lib/gpu";
import { Badge } from "@swiss/components/ui/badge";
import { buttonVariants } from "@swiss/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { WorkloadList } from "@swiss/components/Uplift";
import { cn } from "@swiss/lib/utils";

// A variant is a hardware and parallelism decision, so the card shows whether
// this cluster can actually run it: at selection time, not forty minutes into
// a load. The footer's action is the page's: Deploy on the model page, select
// on an upgrade.
export function VariantCard({
  v,
  kind,
  uplift,
  upliftTitle,
  report,
  workloads,
  nodes,
  tags,
  selected,
  disabled,
  action,
}: {
  v: IndexVariant;
  kind: Kind;
  // The headline, "+58%", with "on v1.0.0" when measured on another version.
  uplift?: string;
  upliftTitle?: string;
  report?: string;
  workloads?: { name: string; uplift: number }[];
  nodes?: Node[];
  // Extra badges beside the id, e.g. "deployed".
  tags?: React.ReactNode;
  selected?: boolean;
  // Why this variant cannot be chosen here; dims the card.
  disabled?: string;
  action?: React.ReactNode;
}) {
  const fit = fitness(v, nodes);
  const link = httpLink(v.link);
  return (
    <Card
      className={cn(
        "flex h-full flex-col transition-shadow",
        selected && "ring-2 ring-success/60",
        disabled && "opacity-60",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {v.id}
            {tags}
            {v.default && <Badge variant="muted">default</Badge>}
            {kind.optimized && (
              <Badge variant="success" title={upliftTitle ? `${upliftTitle}. ${UPLIFT_HELP}` : UPLIFT_HELP}>
                optimized{uplift && ` ${uplift}`}
              </Badge>
            )}
            {kind.baseline && <Badge variant="outline">baseline</Badge>}
            <Badge variant="outline">{v.engine}</Badge>
          </CardTitle>
          {workloads && (
            <p className="text-xs leading-6 text-muted-foreground" title={UPLIFT_HELP}>
              vs baseline: <WorkloadList workloads={workloads} />
            </p>
          )}
          {v.description && <p className="text-sm text-muted-foreground">{v.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {report && (
            <a
              href={report}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <ChartColumn className="size-3.5 text-muted-foreground" />
              <span>Report</span>
            </a>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <ExternalLink className="size-3.5 text-muted-foreground" />
              <span>Docs</span>
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 text-sm">
        <div className="text-muted-foreground">
          {gpuCount(v.requires)}
          {" · "}
          {vendorLabel(v.requires.vendor)}
          {" · "}
          {v.requires.topology ?? "single-node"}
          {v.requires.rdma && " · RDMA"}
          {" · "}
          chart {v.chart.name} {v.chart.version}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Runs on
          {v.requires.gpuProduct?.length ? (
            v.requires.gpuProduct.map((p) => (
              <Badge key={p} variant="outline">
                {p}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">any {vendorLabel(v.requires.vendor)}</Badge>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          {disabled ? (
            <span className="text-xs text-warning">{disabled}</span>
          ) : (
            fit && <Badge variant={fit.ok ? "success" : "warning"}>{fit.text}</Badge>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function fitness(v: IndexVariant, nodes?: Node[]): { ok: boolean; text: string } | null {
  if (!nodes) return null;
  const matching = nodes.filter(
    (n) =>
      n.Schedulable &&
      n.GPUs >= v.requires.gpus &&
      matchesVendor(v.requires.vendor, n) &&
      (!v.requires.gpuProduct?.length || v.requires.gpuProduct.includes(n.GPUProduct)),
  );
  const needed = v.requires.nodes ?? 1;
  return matching.length >= needed
    ? { ok: true, text: `${matching.length} matching node${matching.length === 1 ? "" : "s"}` }
    : { ok: false, text: `needs ${needed}, ${matching.length} matching` };
}
