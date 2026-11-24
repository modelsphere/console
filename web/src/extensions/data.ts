import type { ResourceDataExtension } from "./types";

export interface LoadedResourceData {
  extensions: readonly Pick<ResourceDataExtension, "plugin" | "id">[];
  values: readonly unknown[];
}

/**
 * Plugin-local data map for one extension callback.
 *
 * Keys stay the extension id the SDK documents, but only the owning plugin's
 * extensions are included, so two plugins that both name a result "owner"
 * cannot overwrite each other.
 */
export function dataForPlugin<T>(
  extensions: readonly Pick<ResourceDataExtension, "plugin" | "id">[],
  values: readonly (T | undefined)[],
  plugin: string,
): Record<string, T | undefined> {
  const data: Record<string, T | undefined> = {};
  extensions.forEach((extension, index) => {
    if (extension.plugin === plugin) data[extension.id] = values[index];
  });
  return data;
}
