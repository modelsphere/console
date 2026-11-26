import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCapabilities } from "@/shell/capabilities";
import { useOptionalPermissions } from "@/shell/permissions";
import { dataForPlugin } from "./data";
import { extensions } from "./registry";
import type { ResourceExtensionContext, ResourcePresentationExtension, ResourceVisibilityExtension } from "./types";

type ResourceContext<T> = Omit<ResourceExtensionContext<T>, "data">;

interface ResourceExtensionSurfaceProps<T> extends ResourceContext<T> {
  placement: string;
  fallback?: ReactNode;
}

interface ResourcePresentation {
  key: string;
  content: ReactNode;
  tab?: ResourcePresentationExtension["tab"];
}

function evaluateVisibility(rule: ResourceVisibilityExtension, context: ResourceExtensionContext, isolate: boolean) {
  if (!isolate) return rule.evaluate(context);
  try {
    return rule.evaluate(context);
  } catch (error) {
    console.error(`[console] resource visibility failed: ${rule.plugin}/${rule.id}`, error);
    return false;
  }
}

export function useResourcePresentations<T>(
  context: ResourceContext<T> | null,
  placement: string,
  requireBackendRead = placement === "resource.tabs",
): ResourcePresentation[] {
  const { data: capabilities } = useCapabilities();
  const permissions = useOptionalPermissions();
  const resourceType = context?.resourceType;
  const presentations = extensions.presentations.filter((extension) => {
    if (extension.resourceType !== resourceType || extension.placement !== placement) return false;
    if (extension.authKey !== undefined && !permissions?.has(extension.authKey)) return false;
    if (!requireBackendRead || !extension.capability) return true;
    const access = capabilities?.[extension.capability];
    return !!(access?.configured && access.canRead);
  });
  const contributors = new Set(presentations.map((extension) => extension.plugin));
  const dataExtensions = extensions.data.filter(
    (extension) => extension.resourceType === resourceType && (!requireBackendRead || contributors.has(extension.plugin)),
  );
  const queryScope = requireBackendRead ? [permissions?.username, placement] : [];
  const queries = useQueries({
    queries: context ? dataExtensions.map((extension) => ({
      queryKey: ["extension-data", extension.plugin, extension.id, context.resourceType, context.resourceKey, ...queryScope],
      queryFn: () => extension.load(context),
      staleTime: 30_000,
    })) : [],
  });
  if (!context || presentations.length === 0) return [];

  const values = queries.map((query) => query.data);
  const visibility = extensions.visibility.filter(
    (rule) => rule.resourceType === resourceType && rule.placement === placement,
  );
  return presentations.flatMap((extension) => {
    const visible = visibility.every((rule) =>
      (requireBackendRead && rule.plugin !== extension.plugin) || evaluateVisibility(
        rule, { ...context, data: dataForPlugin(dataExtensions, values, rule.plugin) }, requireBackendRead,
      ),
    );
    if (!visible) return [];
    const Component = extension.component;
    const key = `${extension.plugin}:${extension.key}`;
    const componentKey = requireBackendRead ? `${key}:${context.resourceKey}` : key;
    const data = dataForPlugin(dataExtensions, values, extension.plugin);
    return [{ key, content: <Component key={componentKey} {...context} data={data} />, tab: extension.tab }];
  });
}

export function ResourceExtensionSurface<T>({
  resourceType,
  resourceKey,
  resource,
  placement,
  fallback = null,
}: ResourceExtensionSurfaceProps<T>) {
  const presentations = useResourcePresentations({ resourceType, resourceKey, resource }, placement);
  return presentations.length ? <>{presentations.map((presentation) => presentation.content)}</> : fallback;
}
