import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/shell/auth";

interface PermissionsState {
  has: (permission: string) => boolean;
  username?: string;
}

const PermissionsContext = createContext<PermissionsState | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const permissions = new Set(me?.permissions ?? []);
  const has = (permission: string) => permissions.has("*") || permissions.has(permission);

  return <PermissionsContext.Provider value={{ has, username: me?.name }}>{children}</PermissionsContext.Provider>;
}

export function useOptionalPermissions(): PermissionsState | null {
  return useContext(PermissionsContext);
}

export function usePermissions(): PermissionsState {
  const context = useOptionalPermissions();
  if (!context) throw new Error("usePermissions outside PermissionsProvider");
  return context;
}

export function PermissionGuard({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { has } = usePermissions();
  return has(permission) ? children : fallback;
}
