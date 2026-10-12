import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Cpu } from "lucide-react";
import { SectionCard, StatusIndicator } from "@modelsphere/ui";
import type { NodesResponse } from "@swiss/lib/api";
import { useModulePath } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { nodeState } from "@/modules/inferences/nodes-lib";

export function ResourceOverview({ nodes }: { nodes: UseQueryResult<NodesResponse> }) {
  const t = useT();
  const p = useModulePath();
  const data = nodes.data;
  const known = !!data && !data.usageError;
  const gpuNodes = [...(data?.nodes ?? [])]
    .filter((n) => n.GPUs > 0)
    .sort((a, b) => b.GPUs - a.GPUs || a.Name.localeCompare(b.Name));
  return (
    <section aria-label={t("dashboard.resources.title")}>
      <SectionCard
        title={t("dashboard.resources.title")}
        icon={<Cpu className="size-4" />}
        actions={
          <Link to={p("nodes")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            {t("nodes.title")}
            <ArrowRight className="size-3.5" />
          </Link>
        }
        loading={nodes.isPending}
        error={nodes.error}
        onRetry={() => void nodes.refetch()}
      >
        {gpuNodes.length ? (
          <ul className="space-y-4">
            {gpuNodes.slice(0, 4).map((node) => {
              const state = nodeState(node);
              const measured = known && node.gpusUsed !== undefined;
              const used = measured ? node.gpusUsed! : null;
              const percentage = used === null ? 0 : Math.min(100, Math.max(0, (used / node.GPUs) * 100));
              return (
                <li key={node.Name} className="space-y-2">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium" title={node.Name}>
                      {node.Name}
                    </span>
                    <StatusIndicator variant={state.tone} label={t(`nodes.state.${state.key}`)} />
                  </div>
                  <div
                    role={measured ? "meter" : "img"}
                    aria-label={`${node.Name} ${t("dashboard.resources.allocation")}${measured ? "" : `: ${t("dashboard.resources.unknown")}`}`}
                    aria-valuemin={measured ? 0 : undefined}
                    aria-valuemax={measured ? node.GPUs : undefined}
                    aria-valuenow={measured ? Math.min(node.GPUs, Math.max(0, used!)) : undefined}
                    aria-valuetext={measured ? `${used} / ${node.GPUs}` : undefined}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full bg-info" style={{ width: `${percentage}%` }} />
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate" title={node.GPUProduct || node.GPUResource}>
                      {node.GPUProduct || node.GPUResource || "GPU"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {used ?? "-"} / {node.GPUs}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">{t("dashboard.resources.noNodes")}</p>
        )}
      </SectionCard>
    </section>
  );
}
