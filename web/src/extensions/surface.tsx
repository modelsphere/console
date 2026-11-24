import type { ReactNode } from "react";
import { dataForPlugin } from "./data";
import { extensions } from "./registry";
import { useResourceExtensionData } from "./queries";

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
  const loaded = useResourceExtensionData(resourceType, [{ resourceKey, resource }]).get(resourceKey)!;
  const presentations = extensions.presentations.filter(
    (extension) => extension.resourceType === resourceType && extension.placement === placement,
  );
  if (presentations.length === 0) return fallback;

  const { extensions: dataExtensions, values } = loaded;
  const context = { resourceType, resourceKey, resource };
  return (
    <>
      {presentations.map((extension) => {
        const visible = extensions.visibility
          .filter((candidate) => candidate.resourceType === resourceType && candidate.placement === placement)
          .every((candidate) => candidate.evaluate({ ...context, data: dataForPlugin(dataExtensions, values, candidate.plugin) }));
        if (!visible) return null;
        const Component = extension.component;
        return <Component key={`${extension.plugin}:${extension.key}`} {...context} data={dataForPlugin(dataExtensions, values, extension.plugin)} />;
      })}
    </>
  );
}
