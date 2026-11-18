import type { ComponentType } from "react";
import type { ConsoleModule } from "@/shell/module";

import type { SLOConfig, ServiceAssignment, ServiceOwner } from "@swiss/lib/api";

export interface ServiceOwnerProps {
  owner: ServiceOwner;
  compact?: boolean;
  assigned?: boolean;
}

export interface ServicePolicySLOSource {
  namespace?: string;
  name?: string;
  serviceId?: string;
}

export interface ServicePolicySLO {
  inherited?: boolean;
  canEdit?: boolean;
  source?: ServicePolicySLOSource;
  config?: SLOConfig;
}

export interface ServicePolicy {
  mutable?: boolean;
  slo?: ServicePolicySLO;
  editLayer?: Record<string, unknown>;
}

export interface ServicePolicyContext {
  namespace: string;
  release: string;
  owner?: ServiceOwner | ServiceAssignment;
  assigned?: boolean;
}

export interface ServiceOwnerExtension {
  apiVersion: string;
  kind: string;
  component: ComponentType<ServiceOwnerProps>;
}

export interface ConsoleExtensions {
  modules: ConsoleModule[];
  serviceOwners: ServiceOwnerExtension[];
  useServicePolicy?: (ctx: ServicePolicyContext) => ServicePolicy | undefined;
}
