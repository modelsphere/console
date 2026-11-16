import { createContext, useContext, type ReactNode } from "react";

const BasePathCtx = createContext("");

export function PluginBase({
  basePath,
  children,
}: {
  basePath: string;
  children: ReactNode;
}) {
  return (
    <BasePathCtx.Provider value={basePath}>{children}</BasePathCtx.Provider>
  );
}

export function joinPath(basePath: string, path: string): string {
  const rel = path.replace(/^\/+/, "");
  const base = basePath.replace(/\/+$/, "");
  if (!rel) return base || "/";
  return `${base}/${rel}`;
}

export function usePluginPath(): (path: string) => string {
  const base = useContext(BasePathCtx);
  return (path) => joinPath(base, path);
}
