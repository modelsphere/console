import type { Deployment, ReleaseStatus, ServiceAssignment, ServiceOwner } from "@swiss/lib/api";

export type ServiceRelationshipState = "standalone" | "referenced" | "owned";

export interface ServiceRelationship {
  state: ServiceRelationshipState;
  owner?: ServiceOwner | ServiceAssignment;
  owned: boolean;
  assignmentLocked: boolean;
  adaptiveOnly: boolean;
}

export function serviceRelationship(resource: Deployment | ReleaseStatus): ServiceRelationship {
  const state = resource.canaryState ?? (resource.managedBy ? "owned" : resource.assignedTo ? "referenced" : "standalone");
  const owner = state === "owned" ? resource.managedBy : state === "referenced" ? resource.assignedTo : undefined;
  const assignmentLocked = state === "referenced" && (!!resource.assignedTo && (!resource.assignedTo.verified || resource.assignedTo.role === "arm"));
  const adaptiveOnly = state === "referenced" && resource.assignedTo?.verified === true && resource.assignedTo.role === "arm";
  return { state, owner, owned: state === "owned", assignmentLocked, adaptiveOnly };
}
