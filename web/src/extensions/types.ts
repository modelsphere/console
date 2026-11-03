import type { ComponentType } from "react";
import type { ConsoleModule } from "@/shell/module";

import type { ServiceOwner } from "@swiss/lib/api";

export interface ServiceOwnerProps {
  owner: ServiceOwner;
  compact?: boolean;
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
}
