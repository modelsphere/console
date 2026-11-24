import { useQueries } from "@tanstack/react-query";
import type { LoadedResourceData } from "./data";
import { evaluateResourceAction, extensions } from "./registry";
import type { ResourceDataExtension } from "./types";

interface ExtensionResource {
  resourceKey: string;
  resource: unknown;
}

export function resourceDataQueryKey(extension: Pick<ResourceDataExtension, "plugin" | "id">, resourceType: string, resourceKey: string, resource: unknown) {
  return ["extension-data", extension.plugin, extension.id, resourceType, resourceKey, resource];
}

export function useResourceExtensionData(resourceType: string, resources: readonly ExtensionResource[]): Map<string, LoadedResourceData> {
  const dataExtensions = extensions.data.filter((extension) => extension.resourceType === resourceType);
  const queries = useQueries({
    queries: resources.flatMap(({ resourceKey, resource }) => dataExtensions.map((extension) => ({
      queryKey: resourceDataQueryKey(extension, resourceType, resourceKey, resource),
      queryFn: async () => {
        try {
          return (await extension.load({ resourceType, resourceKey, resource })) ?? null;
        } catch (error) {
          console.error(`[console] resource data failed: ${extension.plugin}/${extension.id}`, error);
          throw error;
        }
      },
      staleTime: 30_000,
      retry: false,
    }))),
  });
  return new Map(resources.map(({ resourceKey }, index) => [resourceKey, {
    extensions: dataExtensions,
    values: queries.slice(index * dataExtensions.length, (index + 1) * dataExtensions.length)
      .map((query) => query.isError ? undefined : query.data),
  }]));
}

export function useResourceActions(resourceType: string, resources: readonly ExtensionResource[]) {
  const loaded = useResourceExtensionData(resourceType, resources);
  return (resourceKey: string, resource: unknown, action: string) =>
    evaluateResourceAction(resourceType, resourceKey, resource, action, loaded.get(resourceKey));
}
