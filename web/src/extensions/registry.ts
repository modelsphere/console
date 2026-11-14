import type {
  ConsoleExtensions,
  ResourceActionExtension,
  ResourceDataExtension,
  ResourcePresentationExtension,
  ResourceVisibilityExtension,
} from "./types";

export const extensions: ConsoleExtensions = {
  modules: [],
  data: [],
  visibility: [],
  presentations: [],
  actions: [],
};

function add<T>(items: T[], item: T): () => void {
  items.push(item);
  return () => {
    const index = items.indexOf(item);
    if (index >= 0) items.splice(index, 1);
  };
}

export function registerDataExtension(extension: ResourceDataExtension): () => void {
  return add(extensions.data, extension);
}

export function registerVisibilityExtension(extension: ResourceVisibilityExtension): () => void {
  return add(extensions.visibility, extension);
}

export function registerPresentationExtension(extension: ResourcePresentationExtension): () => void {
  return add(extensions.presentations, extension);
}

export function registerActionExtension(extension: ResourceActionExtension): () => void {
  return add(extensions.actions, extension);
}

export function evaluateResourceAction<T>(
  resourceType: string,
  resourceKey: string,
  resource: T,
  action: string,
): false | string {
  const context = { resourceType, resourceKey, resource, data: {}, action };
  for (const extension of extensions.actions) {
    if (extension.resourceType !== resourceType || extension.action !== action) continue;
    try {
      const blocked = extension.evaluate(context);
      if (blocked) return blocked;
    } catch (error) {
      console.error(`[console] resource action policy failed: ${extension.plugin}/${extension.id}`, error);
      return "扩展策略暂不可用";
    }
  }
  return false;
}
