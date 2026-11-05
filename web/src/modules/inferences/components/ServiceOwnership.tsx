import { serviceRelationship, type ServiceRelationship } from "../service-relationship";
import { Badge } from "@modelsphere/ui";
import { extensions } from "@/extensions/registry";
import type { ServiceOwnerProps } from "@/extensions/types";
import { useT } from "@/modules/inferences/i18n";

export function ServiceOwnership(props: ServiceOwnerProps) {
  const { owner, compact, assigned } = props;
  const t = useT();
  const extension = extensions.serviceOwners.find(e => e.apiVersion === owner.apiVersion && e.kind === owner.kind);
  if (extension) {
    const Component = extension.component;
    return <Component {...props} />;
  }
  return <div className={compact ? "mt-1 text-xs" : "rounded-md border p-3 text-sm"}>
    <Badge variant="outline">{t(assigned ? "serviceOwner.assigned" : "serviceOwner.managed")}</Badge>{" "}
    <span>{owner.kind} {owner.namespace}/{owner.name}</span>
    {!compact && <p className="mt-2">{t(owner.verified ? "serviceOwner.description" : "serviceOwner.anomaly")}</p>}
  </div>;
}


export function ServiceRelationshipBadge({ service, compact }: { service: ServiceRelationship; compact?: boolean }) {
 const t = useT();
 const { state } = serviceRelationship(service);
 const owner = state === "owned" ? service.managedBy : state === "referenced" ? service.assignedTo : undefined;
 return <div className="space-y-1">
  <Badge variant="outline">{t(`serviceRelationship.${state}`)}</Badge>
  {owner && <ServiceOwnership owner={owner} compact={compact} assigned={state === "referenced"} />}
 </div>;
}
