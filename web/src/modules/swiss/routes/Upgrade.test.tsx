import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { Upgrade, VariantChoices } from "./Upgrade";
import type { Plan } from "@swiss/lib/api";
import { ModuleProvider } from "@/shell/module";

const variant = (id: string, engine: string, extra = {}) => ({
  id, engine, chart: { name: engine, version: ">=0.7.1" }, requires: { gpus: 2, gpuProduct: ["H100"] }, ...extra,
});
const index = (hf: string) => ({
  name: "x", ref: "r", source: "s",
  index: { apiVersion: "v1", site: "https://site.example/", count: 1, models: [{
    name: "m", source: { hf }, latest: "1.1.0",
    tuning: [{ version: "1.1.0", baseline: "a", optimized: "c", uplift: 40, report: "perf.html" }],
    versions: [
      { version: "1.1.0", path: "p", digest: "d", variants: [
        variant("a", "sglang", { default: true, description: "TP2 on H100", link: "https://docs.example/a" }),
        variant("b", "vllm"), variant("c", "sglang", { description: "tuned" })] },
      { version: "1.0.0", path: "p", digest: "d", variants: [variant("a", "sglang")] },
    ] }] },
});

const deployed = {
  apiVersion: "v1", release: { name: "qwen", namespace: "models" },
  source: { catalogName: "public", model: "m", hf: "org/m", version: "1.0.0", variant: "a", digest: "sha256:0123456789abcdef0123" },
  chart: { name: "sglang", version: "0.7.1" }, engine: "sglang", profile: "prod", layers: {}, hash: "h",
} as Plan;

const cards = (moving: boolean, selected: string) => {
  const m = index("org/m").index.models[0];
  const html = renderToString(
    <ModuleProvider module={{ id: "swiss", title: "s", basePath: "/swiss", pages: [] }}>
      <MemoryRouter>
        <VariantChoices
          variants={m.versions[0].variants}
          current={deployed}
          moving={moving}
          selected={selected}
          onPick={() => {}}
          tuning={m.tuning}
          version="1.1.0"
          report="https://site.example/models/m/perf.html"
          nodes={[{ Name: "n1", GPUProduct: "H100", GPUs: 8, Schedulable: true } as never]}
        />
      </MemoryRouter>
    </ModuleProvider>,
  );
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

describe("VariantChoices", () => {
  it("shows what the model page shows, with the deployed and chosen variants marked", () => {
    const text = cards(false, "a");
    for (const want of ["deployed", "Selected", "optimized +40%", "Report", "Docs", "TP2 on H100", "1 matching node", "Select"]) {
      expect(text).toContain(want);
    }
  });

  it("dims variants on another engine when moving catalogs", () => {
    const text = cards(true, "a");
    expect(text).toContain("Runs on vllm; a catalog move keeps sglang");
    expect(text).not.toContain("deployed");
  });
});

describe("Upgrade page", () => {
  // No DOM here: a server render runs every component, which is what catches a
  // page that compiles but throws.
  it("renders the target rows and the variant cards the model page shows", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(["release-plan", "models", "qwen"], {
      apiVersion: "v1", release: { name: "qwen", namespace: "models" },
      source: { catalogName: "public", model: "m", hf: "org/m", version: "1.0.0", variant: "a", digest: "sha256:0123456789abcdef0123" },
      chart: { name: "sglang", version: "0.7.1" }, engine: "sglang", profile: "prod", layers: {}, hash: "h",
    });
    qc.setQueryData(["cluster"], { allowDeploy: true, namespace: "models", catalogs: [
      { name: "public", url: "u1", source: "s1", ref: "r", default: true }, { name: "internal", url: "u2", source: "s2", ref: "r" }] });
    qc.setQueryData(["nodes"], { nodes: [{ Name: "n1", GPUProduct: "H100", GPUs: 8, Schedulable: true }] });
    qc.setQueryData(["catalog", "public"], index("org/m"));
    qc.setQueryData(["catalog", "internal"], index("org/m"));
    qc.setQueryData(["chart-versions", "public", "m", "", "a"], { chart: "sglang", range: ">=0.7.1", variant: "a", versions: ["0.8.6", "0.7.1"] });
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <ModuleProvider module={{ id: "swiss", title: "s", basePath: "/swiss", pages: [] }}>
        <MemoryRouter initialEntries={["/upgrade/models/qwen"]}>
          <Routes><Route path="/upgrade/:namespace/:release" element={<Upgrade />} /></Routes>
        </MemoryRouter>
        </ModuleProvider>
      </QueryClientProvider>,
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const want of ["Upgrade target", "keep public", "latest (1.1.0)", "keep 0.7.1", "Catalog allows &gt;=0.7.1",
      "sglang · 2 GPU", "kept"]) {
      expect(text).toContain(want);
    }
    // The cards live in the dialog, closed until the variant field is clicked.
    expect(text).not.toContain("Choose a variant");
  });
});
