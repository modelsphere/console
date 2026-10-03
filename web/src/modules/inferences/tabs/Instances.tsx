import { Badge, ResourceTable, type ResourceColumn } from "@modelsphere/ui";
import type { Pod, ReleaseStatus } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { age } from "@/modules/inferences/lib";

// The release's pods, from the status read the page already polls.
export function Instances({ status: s }: { status: ReleaseStatus }) {
  const t = useT();
  const columns: ResourceColumn<Pod>[] = [
    {
      key: "name",
      title: t("instances.columns.name"),
      hideable: false,
      render: (pod) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{pod.name}</div>
          {pod.message && <div className="truncate text-xs text-muted-foreground" title={pod.message}>{pod.message}</div>}
        </div>
      ),
    },
    { key: "phase", title: t("instances.columns.phase"), width: 110 },
    {
      key: "ready",
      title: t("instances.columns.ready"),
      width: 100,
      render: (pod) => <Badge variant={pod.ready ? "success" : "secondary"}>{t(pod.ready ? "instances.ready" : "instances.notReady")}</Badge>,
    },
    { key: "restarts", title: t("instances.columns.restarts"), width: 100, align: "right", render: (pod) => <span className="tabular-nums">{pod.restarts}</span> },
    { key: "node", title: t("instances.columns.node"), width: 200, render: (pod) => pod.node || "-" },
    { key: "ageSeconds", title: t("instances.columns.age"), width: 100, render: (pod) => <span className="tabular-nums">{age(pod.ageSeconds)}</span> },
  ];

  return (
    <div className="space-y-3">
      {s.total > 0 && s.ready < s.total && <p className="text-sm text-muted-foreground">{t("overview.coldLoad")}</p>}
      {s.warning && <p className="text-sm text-warning">{s.warning}</p>}
      <ResourceTable<Pod> data={s.pods} columns={columns} rowKey="name" emptyTitle={t("instances.empty")} />
    </div>
  );
}
