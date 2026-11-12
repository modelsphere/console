import { parse } from "yaml";
import type { HelmValues } from "@swiss/lib/api";
import { isMap } from "@swiss/lib/formLayer";

type Tree = Record<string, unknown>;

// Same merge order as the plan layers. Last writer wins. Chart values are not
// one of these; a slot none of them set is the chart's own.
const LAYER_ORDER = ["defaults", "catalog", "site", "derived", "form", "edit", "autoscale"] as const;

export const CHART_LAYER = "chart";

export interface ImageSlot {
  // Values path of the slot: "image", "hangWatcher.image", "pd.router.imageOverride".
  path: string;
  // "map" is {repository, tag}; "string" is a leaf whose key is image.
  kind: "map" | "string";
  // repository:tag, or the string. A tag may itself contain @sha256:.
  value: string;
  // The layer that last set the slot, or "chart" when only the chart default has it.
  layer: string;
}

export interface ImageSlotKind {
  path: string;
  kind: "map" | "string";
}

// splitImage turns a typed ref into the two values a map slot takes.
// The digest is split off first so a tag of pinned@sha256:… keeps the digest
// with the tag. The tag is then the part after the last ':' that comes after
// the last '/': registry.example.com:5000/sglang is a registry port, not a tag.
export function splitImage(ref: string): { repository: string; tag?: string } {
  const s = ref.trim();
  const at = s.indexOf("@");
  const head = at === -1 ? s : s.slice(0, at);
  const digest = at === -1 ? "" : s.slice(at);
  const slash = head.lastIndexOf("/");
  const colon = head.lastIndexOf(":");
  if (colon === -1 || colon < slash) return { repository: head + digest };
  const tag = head.slice(colon + 1) + digest;
  return tag ? { repository: head.slice(0, colon), tag } : { repository: head.slice(0, colon) };
}

export function joinImage(repository: string, tag: string): string {
  return repository && tag ? `${repository}:${tag}` : repository;
}

function parseMap(text: string): Tree {
  if (!text.trim()) return {};
  const value: unknown = parse(text);
  return isMap(value) ? value : {};
}

// Helm's merge: maps merge key by key, everything else replaces, null deletes.
function mergeHelm(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === null) delete out[key];
    else if (isMap(value) && isMap(out[key])) out[key] = mergeHelm(out[key], value);
    else out[key] = value;
  }
  return out;
}

// Chart defaults merged with the plan layers, as the dry run returns them.
export function mergedHelmValues(values: Pick<HelmValues, "defaults" | "overrides">): Tree {
  return mergeHelm(parseMap(values.defaults), parseMap(values.overrides));
}

function getPath(root: unknown, path: string): unknown {
  let cur = root;
  for (const key of path.split(".")) {
    if (!isMap(cur) || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function layerOrder(layers: Record<string, Tree>): string[] {
  const known = LAYER_ORDER.filter((name) => Object.prototype.hasOwnProperty.call(layers, name));
  const rest = Object.keys(layers).filter((name) => !(LAYER_ORDER as readonly string[]).includes(name)).sort();
  return [...known, ...rest];
}

// The last layer in merge order that sets any of these leaves. Chart when none do.
function layerFor(layers: Record<string, Tree> | undefined, paths: string[]): string {
  if (!layers) return CHART_LAYER;
  let found = "";
  for (const name of layerOrder(layers)) {
    const tree = layers[name];
    if (tree && paths.some((path) => getPath(tree, path) !== undefined)) found = name;
  }
  return found || CHART_LAYER;
}

function dot(path: string[]): string {
  return path.join(".");
}

function leaf(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

// discoverImageSlots lists the images a merged values document renders.
// A slot is a map with a string repository (its tag belongs to it) or a string
// leaf named image. A section with enabled: false hides everything under it,
// and metricsMock is never a slot.
export function discoverImageSlots(values: Tree, layers?: Record<string, Tree>): ImageSlot[] {
  const out: ImageSlot[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (!isMap(node) || node.enabled === false) return;
    const here = dot(path);
    if (typeof node.repository === "string") {
      const tag = typeof node.tag === "string" ? node.tag : "";
      out.push({
        path: here,
        kind: "map",
        value: joinImage(node.repository, tag),
        layer: layerFor(layers, [leaf(here, "repository"), leaf(here, "tag")]),
      });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "metricsMock") continue;
      const child = [...path, key];
      if (key === "image" && typeof value === "string") {
        const at = dot(child);
        out.push({ path: at, kind: "string", value, layer: layerFor(layers, [at]) });
      } else if (isMap(value)) walk(value, child);
    }
  };
  walk(values, []);
  // The engine row is the one the mirror choice belongs to; keep it first.
  return out.sort((a, b) => (a.path === "image" ? -1 : b.path === "image" ? 1 : 0));
}

// Image overrides already stored on a form layer, path to ref. Empty values
// are left out so a missing edit is not read later as a clear.
export function imageEditsFromLayer(layer: Tree): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of discoverImageSlots(layer)) {
    if (slot.value) out[slot.path] = slot.value;
  }
  return out;
}

export function setPath(root: Tree, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur = root;
  for (const key of parts.slice(0, -1)) {
    if (!isMap(cur[key])) cur[key] = {};
    cur = cur[key] as Tree;
  }
  cur[parts[parts.length - 1]] = value;
}

// Removes the form-layer override at path. A map slot loses repository and tag
// and keeps any other key (pullPolicy); an emptied map is pruned so the layer
// does not send an empty object that would look like it still owned the section.
export function dropImage(root: Tree, path: string): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  const stack: Tree[] = [root];
  let cur: Tree = root;
  for (const key of parts.slice(0, -1)) {
    const next = cur[key];
    if (!isMap(next)) return;
    stack.push(next);
    cur = next;
  }
  const leafKey = parts[parts.length - 1];
  const value = cur[leafKey];
  if (isMap(value)) {
    delete value.repository;
    delete value.tag;
    if (Object.keys(value).length > 0) return;
  } else if (!(leafKey in cur)) return;
  delete cur[leafKey];
  for (let i = stack.length - 1; i > 0; i--) {
    const node = stack[i];
    if (Object.keys(node).length > 0) break;
    delete stack[i - 1][parts[i - 1]];
  }
}

function kindOf(path: string, slots: ImageSlotKind[] | undefined, formLayer: Tree | undefined): "map" | "string" {
  const known = slots?.find((slot) => slot.path === path)?.kind;
  if (known) return known;
  return typeof getPath(formLayer, path) === "string" ? "string" : "map";
}

// Non-empty image edits, written onto the form overrides. The engine row is
// form.image; other rows live in form.images. An empty string is not an override.
export function applyImageEdits(
  overrides: Tree,
  form: { image: string; images?: Record<string, string> },
  slots?: ImageSlotKind[],
  formLayer?: Tree,
): void {
  if (form.image.trim()) setPath(overrides, "image", splitImage(form.image));
  for (const [path, raw] of Object.entries(form.images ?? {})) {
    if (path === "image" || !raw.trim()) continue;
    const value = raw.trim();
    setPath(overrides, path, kindOf(path, slots, formLayer) === "string" ? value : splitImage(value));
  }
}

// The image keys this form would put on the form layer, and nothing else.
// Provenance names that document "form" without treating the whole merged
// request as one.
export function imageOverrideLayer(
  form: { image: string; images?: Record<string, string> },
  slots?: ImageSlotKind[],
  formLayer?: Tree,
): Tree {
  const overrides: Tree = {};
  applyImageEdits(overrides, form, slots, formLayer);
  return overrides;
}

// Rows to render before a dry run has listed the chart's slots: the engine, from
// the catalog/mirror pair the page already has. An empty list stays empty.
export function imageRows(slots: ImageSlot[] | undefined, image?: { catalog: string; site: string }): ImageSlot[] {
  if (slots?.length) return slots;
  if (!image) return [];
  return [{ path: "image", kind: "map", value: image.site, layer: image.site === image.catalog ? "catalog" : "site" }];
}

// An empty edit drops that path's form-layer override. The engine row counts
// as cleared only when images.image is explicitly "", so a form that never
// touched the field keeps a release's image.repository / image.tag.
export function dropClearedImages(layer: Tree, image: string, images: Record<string, string> | undefined): void {
  if (!image.trim() && images && Object.prototype.hasOwnProperty.call(images, "image") && !String(images.image).trim()) {
    dropImage(layer, "image");
  }
  for (const [path, raw] of Object.entries(images ?? {})) {
    if (path === "image" || raw.trim()) continue;
    dropImage(layer, path);
  }
}

// Layers to name a slot with. A composed plan's layers win. Without one, the
// catalog document is the variant values plus its image, and the site document
// is the mirror when it rewrites the engine repository. The form and edit
// documents are what this page would send, so an unsaved edit is already "form".
export function provenanceLayers(opts: {
  planLayers?: Record<string, Tree>;
  variantValues?: Tree;
  variantImage?: { repository?: string; tag?: string };
  mirroredRepository?: string;
  formLayer?: Tree;
  edits?: string;
}): Record<string, Tree> {
  const layers: Record<string, Tree> = {};
  if (opts.planLayers) {
    Object.assign(layers, opts.planLayers);
  } else {
    const catalog: Tree = { ...(opts.variantValues ?? {}) };
    if (opts.variantImage?.repository) {
      const image = isMap(catalog.image) ? { ...catalog.image } : {};
      image.repository = opts.variantImage.repository;
      if (opts.variantImage.tag) image.tag = opts.variantImage.tag;
      catalog.image = image;
    }
    if (Object.keys(catalog).length) layers.catalog = catalog;
    const repo = opts.variantImage?.repository;
    const mirror = opts.mirroredRepository;
    if (repo && mirror && mirror !== repo) layers.site = { image: { repository: mirror } };
  }
  if (opts.formLayer && Object.keys(opts.formLayer).length) layers.form = opts.formLayer;
  if (opts.edits?.trim()) {
    try {
      const edit = parseMap(opts.edits);
      if (Object.keys(edit).length) layers.edit = edit;
    } catch {
      // Mid-edit YAML does not parse; the edit layer simply is not named yet.
    }
  }
  return layers;
}
