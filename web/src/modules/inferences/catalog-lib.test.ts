import { describe, expect, it } from "vitest";
import type { CatalogModel, Node } from "@swiss/lib/api";
import { facetsOf } from "@swiss/lib/catalog";
import {
  activeFilters,
  catalogPath,
  facetOptions,
  filtersFrom,
  fitness,
  matches,
  modelPath,
  withFilters,
  withoutFilters,
} from "@/modules/inferences/catalog-lib";

const model = (over: Partial<CatalogModel>): CatalogModel => ({
  name: "qwen3-8b",
  family: "qwen",
  tags: ["chat"],
  source: { hf: "Qwen/Qwen3-8B" },
  defaultVariant: "h100x1",
  variants: [
    { id: "h100x1", version: "1.0", digest: "d", engine: "sglang", default: true, chart: { name: "sglang", version: "0.7.1" }, requires: { gpus: 1, gpuProduct: ["NVIDIA-H100-80GB-HBM3"] } },
    { id: "v100x2", version: "1.0", digest: "d", engine: "vllm", chart: { name: "vllm", version: "0.6.2" }, requires: { gpus: 2 } },
  ],
  ...over,
});

const node = (over: Partial<Node>): Node => ({ Schedulable: true, GPUs: 8, GPUProduct: "NVIDIA-H100-80GB-HBM3", ...over }) as Node;

describe("filters and the URL", () => {
  it("reads swiss's parameter names, defaulting the sort to name", () => {
    const f = filtersFrom(new URLSearchParams("q=qwen&engine=vllm&tuned=1&sort=bogus"));
    expect(f).toMatchObject({ q: "qwen", engine: "vllm", tuned: true, hidedep: false, sort: "name" });
    expect(activeFilters(f)).toEqual(["q", "engine", "tuned"]);
  });
  it("drops empty values and the default sort, and keeps the catalog when clearing", () => {
    const p = withFilters(new URLSearchParams("catalog=upstream&q=x"), { q: "", sort: "name", hidedep: true });
    expect(p.toString()).toBe("catalog=upstream&hidedep=1");
    expect(withoutFilters(new URLSearchParams("catalog=upstream&q=x&tag=chat")).toString()).toBe("catalog=upstream");
  });
});

describe("matches", () => {
  const x = facetsOf(model({}));
  it("needs every search term", () => {
    expect(matches(x, filtersFrom(new URLSearchParams("q=qwen h100")))).toBe(true);
    expect(matches(x, filtersFrom(new URLSearchParams("q=qwen a800")))).toBe(false);
  });
  it("filters on engine, hardware and tag", () => {
    expect(matches(x, filtersFrom(new URLSearchParams("engine=vllm&hardware=H100&tag=chat")))).toBe(true);
    expect(matches(x, filtersFrom(new URLSearchParams("tag=vision")))).toBe(false);
  });
  it("hides deprecated models when asked", () => {
    expect(matches(facetsOf(model({ deprecated: "replaced" })), filtersFrom(new URLSearchParams("hidedep=1")))).toBe(false);
  });
});

describe("facetOptions", () => {
  it("counts each value once per model, most common first", () => {
    const o = facetOptions([facetsOf(model({})), facetsOf(model({ name: "b", family: "glm", tags: ["chat", "code"] }))]);
    expect(o.tag).toEqual([
      { value: "chat", count: 2 },
      { value: "code", count: 1 },
    ]);
    expect(o.engine).toEqual([
      { value: "sglang", count: 2 },
      { value: "vllm", count: 2 },
    ]);
  });
});

describe("fitness", () => {
  const v = model({}).variants[0]!;
  it("is unknown without the node list", () => {
    expect(fitness(v, undefined)).toBeNull();
  });
  it("counts schedulable nodes with enough GPUs of the product", () => {
    expect(fitness(v, [node({}), node({ Schedulable: false }), node({ GPUProduct: "NVIDIA-A100" })])).toEqual({ ok: true, matching: 1, needed: 1 });
  });
  it("fails a multi-node variant short of nodes", () => {
    expect(fitness({ requires: { gpus: 8, nodes: 2 } }, [node({})])).toEqual({ ok: false, matching: 1, needed: 2 });
  });
});

describe("paths", () => {
  it("carries the catalog and version", () => {
    expect(catalogPath("")).toBe("catalog");
    expect(modelPath("qwen 3", "up", "1.0")).toBe("catalog/qwen%203?catalog=up&version=1.0");
  });
});
