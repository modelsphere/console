import type { GPUScan, GPUScanRequest, GPUSpec, Node, Requires } from "@swiss/lib/api";

// Vendor decides the extended resource a pod requests and the node label its
// product is published under, so it is part of what a variant runs on rather
// than decoration. Absent means nvidia.
const VENDORS: Record<string, string> = {
  nvidia: "NVIDIA",
  ascend: "Ascend",
  cambricon: "Cambricon",
  hygon: "Hygon",
  amd: "AMD",
};

export const GPU_VENDORS = Object.keys(VENDORS);

export function vendorLabel(vendor?: string): string {
  return VENDORS[vendor ?? "nvidia"] ?? (vendor ?? "");
}

// The cards a variant accepts: the products it names, or any of its vendor's.
export function gpuSupport(r: Requires): string {
  return r.gpuProduct?.length ? r.gpuProduct.join(", ") : `any ${vendorLabel(r.vendor)}`;
}

export function gpuCount(r: Requires): string {
  return r.nodes && r.nodes > 1 ? `${r.gpus} GPU × ${r.nodes} nodes` : `${r.gpus} GPU`;
}

// Short card names, for filters and compact rows: NVIDIA-H100-80GB-HBM3 -> H100.
// A variant that names no product accepts any card of its vendor.
export function gpuModels(r: Requires): string[] {
  if (!r.gpuProduct?.length) {
    return [r.vendor && r.vendor !== "nvidia" ? vendorLabel(r.vendor) : "any GPU"];
  }
  return r.gpuProduct.map(
    (p) => /(?:^|-)([A-Z]{1,2}\d{2,4}[A-Z]?)(?=-|$)/i.exec(p)?.[1].toUpperCase() ?? p,
  );
}

// What a variant occupies, at a glance: "8 × H100", "8 × GPU × 2 nodes".
export function gpuShort(r: Requires): string {
  const kind = r.gpuProduct?.length
    ? gpuModels(r).join(" / ")
    : r.vendor && r.vendor !== "nvidia"
      ? vendorLabel(r.vendor)
      : "GPU";
  return `${r.gpus} × ${kind}` + (r.nodes && r.nodes > 1 ? ` × ${r.nodes} nodes` : "");
}

export const VENDOR_RESOURCES: Record<string, string> = {
  nvidia: "nvidia.com/gpu",
  ascend: "huawei.com/Ascend910",
  cambricon: "cambricon.com/mlu",
  hygon: "hygon.com/dcu",
  amd: "amd.com/gpu",
};

// Vendor match is by the node's resource: the vendor the site profile's
// nodes.gpus lists it under, else the well-known resource above when the
// profile is not readable. Product labels are never compared to the resource.
// Missing GPUResource means we do not know — do not invent a fallback.
export function matchesVendor(
  vendor: string | undefined,
  node: { GPUResource?: string; GPUProduct?: string },
  gpus?: GPUSpec[],
): boolean {
  if (!node.GPUResource) return true;
  const listed = gpus?.find((g) => g.resource === node.GPUResource);
  if (listed) return listed.vendor === (vendor ?? "nvidia");
  const expected = VENDOR_RESOURCES[vendor ?? "nvidia"];
  return !expected || node.GPUResource === expected;
}

// The products this cluster reports on a vendor's nodes: what a variant of that
// vendor can be scheduled onto, whether the catalog lists them or not. swissd
// accepts the same set when a deploy forces a product the variant does not list.
export function vendorProducts(
  nodes: { GPUProduct?: string; GPUResource?: string }[] | undefined,
  vendor: string | undefined,
  gpus?: GPUSpec[],
): string[] {
  const out = new Set<string>();
  for (const n of nodes ?? []) if (n.GPUProduct && matchesVendor(vendor, n, gpus)) out.add(n.GPUProduct);
  return [...out].sort();
}

// What the cluster's nodes carry under a resource, as swissd read them: the
// canonical products, and how many nodes report the resource with no product.
export function resourceProducts(
  nodes: { GPUProduct?: string; GPUResource?: string }[] | undefined,
  resource: string,
): { products: string[]; unlabelled: number } {
  const products = new Set<string>();
  let unlabelled = 0;
  for (const n of nodes ?? []) {
    if (n.GPUResource !== resource) continue;
    if (n.GPUProduct) products.add(n.GPUProduct);
    else unlabelled++;
  }
  return { products: [...products].sort(), unlabelled };
}

// Product badge colors: a preset per card family seen on swiss sites, so a
// product keeps its color on every page, and a hash for the rest. Written out
// in full so Tailwind generates them.
const PRODUCT_HUES = {
  green: "border-green-500/30 bg-green-500/10 text-green-700",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-700",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700",
  indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  purple: "border-purple-500/30 bg-purple-500/10 text-purple-700",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700",
  pink: "border-pink-500/30 bg-pink-500/10 text-pink-700",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  red: "border-red-500/30 bg-red-500/10 text-red-700",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-700",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  lime: "border-lime-500/30 bg-lime-500/10 text-lime-700",
} as const;

// First match wins, so a name containing another comes first (H200 before H20).
const PRODUCT_PRESETS: [RegExp, keyof typeof PRODUCT_HUES][] = [
  [/H200/i, "emerald"],
  [/H100/i, "green"],
  [/H800/i, "teal"],
  [/H20(?!\d)/i, "cyan"],
  [/A100/i, "blue"],
  [/A800/i, "sky"],
  [/GB[23]00/i, "purple"],
  [/B300/i, "indigo"],
  [/B200/i, "violet"],
  [/RTX|L40|L20|6000/i, "amber"],
  [/910B3/i, "rose"],
  [/910B4/i, "pink"],
  [/910/i, "fuchsia"],
  [/950/i, "orange"],
  [/MI\d{3}/i, "red"],
];

// The vendor's default resource, and its row, in the GPU table.
export const DEFAULT_GPU_CLASS = "gap-1 border-amber-400/70 bg-amber-400/20 text-amber-800";
export const DEFAULT_GPU_ROW_CLASS = "bg-amber-400/5";
export const SET_DEFAULT_GPU_CLASS = "h-6 gap-1 border-dashed px-2 text-xs font-normal text-muted-foreground hover:border-solid hover:border-amber-400/70 hover:bg-amber-400/10 hover:text-amber-800";

// A scanned product's names worth showing: none when its only name is itself.
export const scanNames = (p: GPUScan["products"][number]) => (p.names.length === 1 && p.names[0].name === p.product ? [] : p.names);

// What a scan sends of an entry.
export const scanRequest = ({ resource, labelKey, products }: GPUSpec): GPUScanRequest => ({ resource, labelKey, products });

export function productClass(product: string): string {
  const preset = PRODUCT_PRESETS.find(([re]) => re.test(product));
  if (preset) return PRODUCT_HUES[preset[1]];
  const hues = Object.values(PRODUCT_HUES);
  let h = 0;
  for (const ch of product) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}

// The resources the site lists for a vendor, its default first.
export const vendorResources = (gpus: GPUSpec[], vendor?: string) => gpus.filter((g) => g.vendor === (vendor ?? "nvidia")).map((g) => g.resource);

// The products a deploy may pick from: those under the resource it picked,
// else every one of its vendor's.
export function pickableProducts(
  nodes: { GPUProduct?: string; GPUResource?: string }[] | undefined,
  vendor: string | undefined,
  gpus: GPUSpec[] | undefined,
  resource?: string,
): string[] {
  return resource ? resourceProducts(nodes, resource).products : vendorProducts(nodes, vendor, gpus);
}

export interface GPUCapacity {
  nodes: number;
  gpus: number;
  // Of the nodes that take pods: GPUs free, and nodes with room for one pod.
  // Absent when this cluster's usage could not be read.
  free?: { gpus: number; nodes: number };
}

// What a deploy's resource and products can land on. No resource is any of
// the vendor's; no products is any product.
export function gpuCapacity(
  nodes: Node[] | undefined,
  pick: { vendor?: string; resource?: string; products?: string[]; perPod: number },
  gpus?: GPUSpec[],
): GPUCapacity | undefined {
  if (!nodes) return undefined;
  const hit = nodes.filter(
    (n) =>
      n.GPUs > 0 &&
      (pick.resource ? n.GPUResource === pick.resource : matchesVendor(pick.vendor, n, gpus)) &&
      (!pick.products?.length || pick.products.includes(n.GPUProduct)),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const out: GPUCapacity = { nodes: hit.length, gpus: sum(hit.map((n) => n.GPUs)) };
  if (hit.every((n) => n.gpusFree !== undefined)) {
    const open = hit.filter((n) => n.Schedulable && n.Ready);
    out.free = { gpus: sum(open.map((n) => n.gpusFree ?? 0)), nodes: open.filter((n) => (n.gpusFree ?? 0) >= pick.perPod).length };
  }
  return out;
}

// A deploy form's capacity: what its resource and products, else the variant's
// products, can land on, and the room one pod needs on how many nodes.
export function deployCapacity(r: Requires, pick: { gpuResource: string; gpuProducts: string[] }, nodes: Node[] | undefined, gpus: GPUSpec[] | undefined) {
  const products = pick.gpuProducts.length ? pick.gpuProducts : r.gpuProduct;
  return {
    value: gpuCapacity(nodes, { vendor: r.vendor, resource: pick.gpuResource || undefined, products, perPod: r.gpus }, gpus),
    perPod: r.gpus,
    needNodes: r.nodes ?? 1,
  };
}

// The selected products a variant does not list. A variant naming none accepts
// any card of its vendor, so for it nothing is unlisted.
export function unlistedProducts(listed: string[] | undefined, selected: string[]): string[] {
  return listed?.length ? selected.filter((p) => !listed.includes(p)) : [];
}

// What the product picker offers: every product of the variant's vendor this
// cluster reports, the listed ones first. With no inventory -- nothing reported,
// or the nodes not read -- the variant's own list stands in. A product already
// selected is always offered, so it can be cleared.
export function productChoices(
  listed: string[] | undefined,
  present: string[] | undefined,
  selected: string[],
): string[] {
  const base = present?.length ? present : (listed ?? []);
  const off = (p: string) => (unlistedProducts(listed, [p]).length ? 1 : 0);
  return [...new Set([...base, ...selected])].sort((a, b) => off(a) - off(b) || a.localeCompare(b));
}
