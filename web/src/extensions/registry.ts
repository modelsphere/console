import type {
  ConsoleExtensions,
  ResourceDataExtension,
  ResourcePresentationExtension,
  ResourceVisibilityExtension,
  ServiceOwnerExtension,
} from "./types";

export const extensions: ConsoleExtensions = {
  modules: [],
  serviceOwners: [],
  data: [],
  visibility: [],
  presentations: [],
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

export function registerServiceOwnerExtension(extension: ServiceOwnerExtension): () => void {
  return add(extensions.serviceOwners, extension);
}
