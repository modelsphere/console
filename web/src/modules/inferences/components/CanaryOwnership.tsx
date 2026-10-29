import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@modelsphere/ui";
import { request } from "@/shell/api";
import type { CanaryOwner } from "@swiss/lib/api";
import type { ExperimentSummary } from "@/modules/canary/types";
import { useT } from "@/modules/inferences/i18n";

export function matchingExperiment(owner: CanaryOwner, records: ExperimentSummary[] = []) {
  if (!owner.verified || !owner.uid) return undefined;
  return records.find((e) => e.uid === owner.uid && e.name === owner.name && e.namespace === owner.namespace);
}

export function CanaryOwnership({ owner, compact = false }: { owner: CanaryOwner; compact?: boolean }) {
  const t = useT();
  const records = useQuery({
    queryKey: ["canary-owner-experiments"],
    queryFn: () => request<ExperimentSummary[]>("GET", "/api/canary/experiments"),
    enabled: owner.verified && !!owner.uid,
    retry: false,
    refetchInterval: 15_000,
  });
  const experiment = matchingExperiment(owner, records.data);
  return (
    <div className={compact ? "mt-1 flex flex-wrap items-center gap-1 text-xs" : "rounded-md border bg-muted/30 p-3 text-sm"}>
      <Badge variant="outline">{t("canaryOwner.managed")}</Badge>{" "}
      {experiment ? (
        <Link className="text-primary hover:underline" to={`/canary/experiments/${encodeURIComponent(experiment.id)}`}>{owner.namespace}/{owner.name}</Link>
      ) : <span>{owner.namespace}/{owner.name}</span>}
      {!compact && <p className="mt-2">{t("canaryOwner.description")}</p>}
      {!compact && <p className="mt-1 text-xs text-muted-foreground">{!owner.verified ? t("canaryOwner.anomaly") : records.isPending ? t("canaryOwner.loading") : experiment ? `${experiment.phase ?? experiment.state} · UID ${owner.uid}` : t("canaryOwner.unavailable")}</p>}
    </div>
  );
}
