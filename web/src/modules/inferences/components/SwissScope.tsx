import type { ReactNode } from "react";
import { ModuleProvider, type ConsoleModule } from "@/shell";
import { swissModule } from "@/modules/swiss";
import { Gate } from "@swiss/components/Session";
import { ToastProvider } from "@swiss/components/ui/toast";

// swiss's components write their links as swiss paths ("/setup") and resolve
// them against the module they render in. Rendered here they would land under
// /inferences, so they render in swiss's context: the gate's redirect to setup
// is swiss's page. `self` puts this module's context back for the page itself.
export function SwissScope({ self, children }: { self: () => ConsoleModule; children: ReactNode }) {
  return (
    <ModuleProvider module={swissModule}>
      <ToastProvider>
        <Gate>
          <ModuleProvider module={self()}>{children}</ModuleProvider>
        </Gate>
      </ToastProvider>
    </ModuleProvider>
  );
}

// For one of swiss's panels inside this module's page: its links go to swiss.
export function InSwiss({ children }: { children: ReactNode }) {
  return <ModuleProvider module={swissModule}>{children}</ModuleProvider>;
}

export const swissBase = swissModule.basePath;
