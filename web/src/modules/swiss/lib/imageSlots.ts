import { parse, stringify } from "yaml";
import type { HelmValues } from "@swiss/lib/api";
import { isMap } from "@swiss/lib/formLayer";

type Tree = Record<string, unknown>;

export interface ImageSlot {
  // Values path of the slot: "image", "hangWatcher.image", "pd.router.imageOverride".
  path: string;
  // "map" is {repository, tag}; "string" is a leaf whose key is image.
  kind: "map" | "string";
  // repository:tag, or the string, as the chart would render it with no form image edit.
  value: string;
  // Un-mirrored chart default from values.yaml when different from `value`.
  defaultValue?: string;
}

export interface SlotImageChoice {
  key: "site" | "catalog" | "default";
  ref: string;
}

// What a row stores. A map slot is {repository, tag}; a string slot is the string.
// "" is empty. `draft` is only the text still being typed when a map ref does not
// round-trip (a trailing colon); the plan never sends it.
export type ImageEdit = string | { repository: string; tag?: string; draft?: string };

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

function dot(path: string[]): string {
  return path.join(".");
}

// discoverImageSlots lists the images a merged values document renders.
// A slot is a map with a string repository (its tag belongs to it) or a string
// leaf named image. A section with enabled: false hides everything under it.
export function discoverImageSlots(values: Tree): ImageSlot[] {
  const out: ImageSlot[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (!isMap(node) || node.enabled === false) return;
    const here = dot(path);
    if (typeof node.repository === "string") {
      const tag = typeof node.tag === "string" ? node.tag : "";
      out.push({ path: here, kind: "map", value: joinImage(node.repository, tag) });
    }
    for (const [key, value] of Object.entries(node)) {
      const child = [...path, key];
      if (key === "image" && typeof value === "string") {
        out.push({ path: dot(child), kind: "string", value });
      } else if (isMap(value)) walk(value, child);
    }
  };
  walk(values, []);
  // The engine row is the primary image; keep it first.
  return out.sort((a, b) => (a.path === "image" ? -1 : b.path === "image" ? 1 : 0));
}

// Discovers merged slots and retains each slot's chart values.yaml default
// when layers already rewrote it (e.g. a site mirror or preset).
export function helmImageSlots(values: Pick<HelmValues, "defaults" | "overrides">): ImageSlot[] {
  const defaults = new Map(discoverImageSlots(parseMap(values.defaults)).map((s) => [s.path, s.value]));
  return discoverImageSlots(mergedHelmValues(values)).map((slot) => {
    const def = defaults.get(slot.path);
    return def && def !== slot.value ? { ...slot, defaultValue: def } : slot;
  });
}

// Rewrites an image ref to the site's registry mirror keeping the final repo segment
// and tag/digest; keep in sync with Profile.MirrorImage in swiss/internal/site/profile.go.
export function mirrorImage(ref: string, mirror?: string): string {
  const base = mirror?.trim().replace(/\/+$/, "");
  if (!base || !ref.trim()) return ref;
  const split = splitImage(ref);
  if (!split.repository) return ref;
  const tail = split.repository.split("/").pop();
  if (!tail) return ref;
  return joinImage(`${base}/${tail}`, split.tag ?? "");
}

// Options (site mirror vs catalog/chart default) for an image slot input.
// Returns [] without a distinct mirror option so the list never offers duplicates.
export function slotImageChoices(
  slot: ImageSlot,
  engineImage?: { catalog: string; site: string },
  mirror?: string,
): SlotImageChoice[] {
  if (slot.path === "image" && engineImage) {
    return engineImage.site === engineImage.catalog
      ? []
      : [
          { key: "site", ref: engineImage.site },
          { key: "catalog", ref: engineImage.catalog },
        ];
  }
  const base = slot.defaultValue || slot.value;
  if (!base.trim()) return [];
  const site = mirrorImage(slot.value || base, mirror);
  // If slot.value was already mirrored, pair it with the un-mirrored chart default.
  const fallback = site === slot.value ? base : slot.value || base;
  if (!site || !fallback || site === fallback) return [];
  return [
    { key: "site", ref: site },
    { key: "default", ref: fallback },
  ];
}

// The text an image input shows. A half-typed map ref keeps its draft so the
// field does not eat a trailing colon.
export function imageText(value: ImageEdit | undefined): string {
  if (typeof value !== "object" || value === null) return value ?? "";
  return value.draft ?? joinImage(value.repository, value.tag ?? "");
}

function imageValue(kind: "map" | "string", raw: string): ImageEdit {
  if (!raw.trim()) return "";
  if (kind === "string") return raw;
  const split = splitImage(raw);
  const text = joinImage(split.repository, split.tag ?? "");
  const shaped: { repository: string; tag?: string } = split.tag ? { repository: split.repository, tag: split.tag } : { repository: split.repository };
  return raw === text ? shaped : { ...shaped, draft: raw };
}

// One images map. The engine is the "image" path; nothing else is special.
export function imagePatch(images: Record<string, ImageEdit>, path: string, kind: "map" | "string", raw: string): Record<string, ImageEdit> {
  return { ...images, [path]: imageValue(kind, raw) };
}

// The form-layer value, or nothing when the row is empty. Draft is left off.
function imagePayload(value: ImageEdit | undefined): string | { repository: string; tag?: string } | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (!value || !value.repository.trim()) return undefined;
  const repository = value.repository.trim();
  return value.tag ? { repository, tag: value.tag } : { repository };
}

// Image overrides already stored on a form layer, path to the shaped value.
// Empty values are left out: a clear is an empty form field, not a stored edit.
export function imageEditsFromLayer(layer: Tree): Record<string, ImageEdit> {
  const out: Record<string, ImageEdit> = {};
  for (const slot of discoverImageSlots(layer)) {
    const raw = getPath(layer, slot.path);
    if (slot.kind === "string") {
      if (typeof raw === "string" && raw.trim()) out[slot.path] = raw;
    } else if (isMap(raw) && typeof raw.repository === "string" && raw.repository.trim()) {
      const edit: { repository: string; tag?: string } = { repository: raw.repository };
      if (typeof raw.tag === "string" && raw.tag) edit.tag = raw.tag;
      out[slot.path] = edit;
    }
  }
  return out;
}

function setPath(root: Tree, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur = root;
  for (const key of parts.slice(0, -1)) {
    if (!isMap(cur[key])) cur[key] = {};
    cur = cur[key] as Tree;
  }
  cur[parts[parts.length - 1]] = value;
}

// Removes repository and tag from a map slot (any other key, such as pullPolicy,
// stays) or deletes a string slot. An emptied map is removed. Parents are left
// as they are, even when that leaves an empty object.
function dropImage(root: Tree, path: string): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur: Tree = root;
  for (const key of parts.slice(0, -1)) {
    const next = cur[key];
    if (!isMap(next)) return;
    cur = next;
  }
  const leafKey = parts[parts.length - 1];
  const value = cur[leafKey];
  if (isMap(value)) {
    delete value.repository;
    delete value.tag;
    if (Object.keys(value).length === 0) delete cur[leafKey];
    return;
  }
  if (leafKey in cur) delete cur[leafKey];
}

// Image edits the dry run left out, merged onto its overrides. Defaults stay as dumped.
export function withImageEdits(values: HelmValues, images?: Record<string, ImageEdit>): HelmValues {
  const patch: Tree = {};
  applyImageEdits(patch, images);
  if (!Object.keys(patch).length) return values;
  return { ...values, overrides: stringify(mergeHelm(parseMap(values.overrides), patch)) };
}

// Non-empty image edits, written onto the form overrides. The value is already
// the shape the slot takes; the plan does not look the kind up again.
export function applyImageEdits(overrides: Tree, images: Record<string, ImageEdit> | undefined): void {
  for (const [path, raw] of Object.entries(images ?? {})) {
    const value = imagePayload(raw);
    if (value !== undefined) setPath(overrides, path, value);
  }
}

// Rows to render. Before a dry run has listed the chart's slots, the engine
// comes from the catalog/mirror pair the page already has. A form-layer image
// the chart itself does not list is still a row, so an upgrade can show it.
export function imageRows(slots: ImageSlot[] | undefined, image?: { catalog: string; site: string }, edits?: Record<string, ImageEdit>): ImageSlot[] {
  const base = slots?.length ? slots : image ? [{ path: "image", kind: "map" as const, value: image.site }] : [];
  if (!edits) return base;
  const seen = new Set(base.map((slot) => slot.path));
  const extra: ImageSlot[] = [];
  for (const [path, value] of Object.entries(edits)) {
    if (seen.has(path) || imagePayload(value) === undefined) continue;
    extra.push({ path, kind: typeof value === "string" ? "string" : "map", value: imageText(value) });
  }
  if (!extra.length) return base;
  return base.concat(extra).sort((a, b) => (a.path === "image" ? -1 : b.path === "image" ? 1 : 0));
}

// An empty edit drops that path's form-layer override. formFromPlan seeds every
// slot the release's form layer set, so a path that layer has and the form does
// not (missing or blank) is a clear. "" and a missing key are the same.
export function dropClearedImages(layer: Tree, images: Record<string, ImageEdit> | undefined): void {
  for (const slot of discoverImageSlots(layer)) {
    if (imagePayload(images?.[slot.path]) === undefined) dropImage(layer, slot.path);
  }
}
