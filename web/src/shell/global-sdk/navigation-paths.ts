export function routePath(pattern: string): string {
  const normalized = pattern.replace(/^\//, "").replace(/\[\.\.\.([\w-]+)\]/g, "*").replace(/\[([\w-]+)\]/g, ":$1");
  if (!normalized || normalized.split("/").some(part => part === "." || part === ".." || !/^(?:[\w.-]+|:[\w-]+|\*)$/.test(part))) {
    throw new Error(`Unsupported SDK route "${pattern}"`);
  }
  return normalized;
}

export function pathNamespace(path: string): string {
  const segments = path.split("/").slice(1);
  const depth = segments.length >= 3 && /^v\d+[a-z0-9]*$/.test(segments[1]) ? 3 : 1;
  return "/" + segments.slice(0, depth).join("/");
}

export function relativePath(path: string, basePath: string): string {
  if (path === basePath) return "";
  if (!path.startsWith(basePath + "/")) throw new Error(`SDK path "${path}" is outside module namespace "${basePath}"`);
  return routePath(path.slice(basePath.length + 1));
}

export function absoluteRoute(pattern: string, basePath: string): string {
  if (pattern.startsWith("/")) return "/" + routePath(pattern);
  return pattern ? `${basePath}/${routePath(pattern)}` : basePath;
}
