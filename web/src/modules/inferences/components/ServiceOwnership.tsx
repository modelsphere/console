import { Badge } from "@modelsphere/ui";
import { extensions } from "@/extensions/registry";
import type { ServiceOwnerProps } from "@/extensions/types";
import type { Deployment, ReleaseStatus } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { serviceRelationship } from "../service-relationship";

export function ServiceOwnership({ owner, compact, assigned }: ServiceOwnerProps) {
  const t = useT();
  const extension = extensions.serviceOwners.find((item) => item.apiVersion === owner.apiVersion && item.kind === owner.kind);
  if (extension) {
    const Component = extension.component;
    return <Component owner={owner} compact={compact} assigned={assigned} />;
  }
  return (
    <div className={compact ? "mt-1 text-xs" : "rounded-md border p-3 text-sm"}>
      <Badge variant="outline">{t(assigned ? "serviceOwner.assigned" : "serviceOwner.managed")}</Badge>{" "}
      <span>{owner.kind} {owner.namespace}/{owner.name}</span>
      {!compact && <p className="mt-2">{t(owner.verified ? "serviceOwner.description" : "serviceOwner.anomaly")}</p>}
    </div>
  );
}

export function ServiceRelationshipBadge({ service, compact }: { service: Deployment | ReleaseStatus; compact?: boolean }) {
  const t = useT();
  const relationship = serviceRelationship(service);
  if (!relationship.owner) return <Badge variant="outline">{t("serviceRelationship.standalone")}</Badge>;
  return (
    <div className="space-y-1">
      <Badge variant="outline">{t(`serviceRelationship.${relationship.state}`)}</Badge>
      <ServiceOwnership owner={relationship.owner} compact={compact} assigned={relationship.state === "referenced"} />
    </div>
  );
}
