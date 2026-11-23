import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@modelsphere/ui";
import { api, type Capabilities } from "@/shell/api";
import { useAuth } from "@/shell/auth";
import { useT } from "@/shell/i18n";
import type { ConsoleModule } from "@/shell/module";

export interface CapabilityState {
  data?: Capabilities;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

export const CapabilityContext = createContext<CapabilityState>({ loading: true, failed: false, retry: () => undefined });

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ["capabilities", me?.name],
    queryFn: api.capabilities,
    enabled: !!me && !me.requirePasswordReset,
    retry: false,
    gcTime: 0,
  });
  return (
    <CapabilityContext.Provider
      value={{
        data: me && !query.isError ? query.data : undefined,
        loading: query.isPending,
        failed: query.isError,
        retry: () => void query.refetch(),
      }}
    >
      {children}
    </CapabilityContext.Provider>
  );
}

export function useCapabilities(): CapabilityState {
  return useContext(CapabilityContext);
}

export function availableModules(modules: ConsoleModule[], data?: Capabilities): ConsoleModule[] {
  return modules
    .filter((module) => !module.capability || (data?.[module.capability]?.configured && data[module.capability].canRead))
    .map((module) => module.capability ? {
      ...module,
      pages: module.pages.filter((page) => !page.requiresWrite || data?.[module.capability!]?.canWrite),
    } : module);
}

export function CapabilityGuard({ capability, write = false, children }: { capability: string; write?: boolean; children: ReactNode }) {
  const state = useCapabilities();
  const t = useT("shell");
  let message: string;
  if (state.loading) message = t("capability.loading");
  else if (state.failed) message = t("capability.failed");
  else if (!state.data?.[capability]?.configured) message = t("capability.unconfigured");
  else if (!state.data[capability].canRead || (write && !state.data[capability].canWrite)) message = t("capability.forbidden");
  else return children;
  return (
    <div className="space-y-3 p-6" role="status">
      <p>{message}</p>
      {state.failed && <Button variant="outline" onClick={state.retry}>{t("capability.retry")}</Button>}
    </div>
  );
}
