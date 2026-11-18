import type { CanaryState, ServiceAssignment, ServiceOwner } from "@swiss/lib/api";

export interface ServiceRelationship {
 canaryState?: CanaryState;
 managedBy?: ServiceOwner;
 assignedTo?: ServiceAssignment;
}

export function serviceRelationship(service: ServiceRelationship, options?: { mutable?: boolean }) {
 const state = service.canaryState ?? (service.managedBy ? "owned" : service.assignedTo ? "referenced" : "standalone");
 const owned = state === "owned";
 const referenced = state === "referenced";
 const mutable = !!options?.mutable && !!service.assignedTo?.verified && service.assignedTo.role === "arm";
 const assignmentLocked = referenced && (!service.assignedTo?.verified || (service.assignedTo.role === "arm" && !mutable));
 const adaptiveOnly = !mutable && referenced && !!service.assignedTo?.verified && service.assignedTo.role === "arm";
 const productionReferenced = referenced && !!service.assignedTo?.verified && service.assignedTo.role === "production";
 const uninstallLocked = referenced;
 return { state, owned, referenced, assignmentLocked, adaptiveOnly, productionReferenced, uninstallLocked };
}
