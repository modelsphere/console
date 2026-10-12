import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Server } from "lucide-react";
import { Badge, PropertyList, SectionCard } from "@modelsphere/ui";
import type { ClusterInfo, NodesResponse } from "@swiss/lib/api";
import { useModulePath } from "@/shell";
import { useT } from "@/modules/inferences/i18n";

export function ClusterOverview({
  cluster,
  nodes,
}: {
  cluster: UseQueryResult<ClusterInfo>;
  nodes: UseQueryResult<NodesResponse>;
}) {
  const t = useT();
  const p = useModulePath();
  const data = cluster.data;
  const inventory = nodes.error ? undefined : nodes.data;
  const versions = [...new Set((inventory?.nodes ?? []).map((n) => n.Kubelet).filter((v): v is string => !!v))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const ready = inventory?.nodes.filter((n) => n.Ready).length;
  const schedulable = inventory?.nodes.filter((n) => n.Ready && n.Schedulable).length;
  const nodeCount = inventory?.summary.nodes;
  const label = (key: string) => t(`dashboard.cluster.${key}`);
  const count = (n?: number) => (n === undefined || nodeCount === undefined ? "-" : `${n} / ${nodeCount}`);

  return (
    <section aria-label={label("title")}>
      <SectionCard
        title={label("title")}
        icon={<Server className="size-4" />}
        actions={
          <Link
            to={p("site-profile")}
            className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-primary hover:underline"
          >
            {label("config")} <ArrowRight className="size-4" />
          </Link>
        }
        loading={cluster.isPending}
        error={cluster.error}
        onRetry={() => void cluster.refetch()}
      >
        <PropertyList
          columns={1}
          className="gap-y-4"
          labelClassName="w-24"
          valueClassName="min-w-0 flex-1 whitespace-normal break-words"
          items={[
            { label: label("name"), value: data?.name || "-" },
            {
              label: label("kubernetes"),
              value: versions.length ? (
                <span className="flex flex-wrap gap-1">
                  {versions.map((version) => (
                    <Badge key={version} variant="outline">
                      {version}
                    </Badge>
                  ))}
                </span>
              ) : (
                "-"
              ),
            },
            { label: label("namespace"), value: data?.namespace || "-" },
            { label: label("ready"), value: count(ready) },
            { label: label("schedulable"), value: count(schedulable) },
            { label: label("backend"), value: data?.version || "-" },
            {
              label: label("mode"),
              value: data ? (
                <Badge variant={data.allowDeploy ? "success" : "secondary"}>
                  {label(data.allowDeploy ? "deployEnabled" : "readOnly")}
                </Badge>
              ) : (
                "-"
              ),
            },
          ]}
        />
      </SectionCard>
    </section>
  );
}
