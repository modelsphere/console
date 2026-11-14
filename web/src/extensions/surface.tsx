import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { extensions } from "./registry";
import type { ResourceExtensionContext } from "./types";

interface ResourceExtensionSurfaceProps<T> {
  resourceType: string;
  resourceKey: string;
  resource: T;
  placement: string;
  fallback?: ReactNode;
}

export function ResourceExtensionSurface<T>({
  resourceType,
  resourceKey,
  resource,
  placement,
  fallback = null,
}: ResourceExtensionSurfaceProps<T>) {
  const dataExtensions = extensions.data.filter((extension) => extension.resourceType === resourceType);
  const presentations = extensions.presentations.filter(
    (extension) => extension.resourceType === resourceType && extension.placement === placement,
  );
  const queries = useQueries({
    queries: dataExtensions.map((extension) => ({
      queryKey: ["extension-data", extension.plugin, extension.id, resourceType, resourceKey],
      queryFn: () => extension.load({ resourceType, resourceKey, resource }),
      staleTime: 30_000,
    })),
  });
  if (presentations.length === 0) return fallback;

  const data = Object.fromEntries(
    dataExtensions.map((extension, index) => [extension.id, queries[index]?.data]),
  );
  const context: ResourceExtensionContext<T> = { resourceType, resourceKey, resource, data };
  return (
    <>
      {presentations.map((extension) => {
        const visible = extensions.visibility
          .filter((candidate) => candidate.resourceType === resourceType && candidate.placement === placement)
          .every((candidate) => candidate.evaluate(context));
        if (!visible) return null;
        const Component = extension.component;
        return <Component key={`${extension.plugin}:${extension.key}`} {...context} />;
      })}
    </>
  );
}
