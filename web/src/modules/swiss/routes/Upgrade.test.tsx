import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { republishWarning, Upgrade, VariantChoices } from "./Upgrade";
import type { Plan } from "@swiss/lib/api";
import { ModuleProvider } from "@/shell/module";

const variant = (id: string, engine: string, extra = {}) => ({
  id, engine, version: "1.1.0", digest: "d", chart: { name: engine, version: ">=0.7.1" }, requires: { gpus: 2, gpuProduct: ["H100"] }, ...extra,
});
const listing = (hf: string) => ({
  name: "x", ref: "r", source: "s", schema: "v1", site: "https://site.example/",
  models: [{
    name: "m", source: { hf }, defaultVariant: "a",
    tuning: [{ baseline: { id: "a", version: "1.1.0" }, optimized: { id: "c", version: "1.1.0" }, uplift: 40, report: "perf.html" }],
    variants: [
      variant("a", "sglang", { default: true, description: "TP2 on H100", link: "https://docs.example/a" }),
      variant("b", "vllm"), variant("c", "sglang", { description: "tuned" })],
  }],
});

const deployed = {
  apiVersion: "v1", release: { name: "qwen", namespace: "models" },
  source: { catalogName: "public", model: "m", hf: "org/m", version: "1.0.0", variant: "a", digest: "sha256:0123456789abcdef0123" },
  chart: { name: "sglang", version: "0.7.1" }, engine: "sglang", profile: "prod", layers: {}, hash: "h",
} as Plan;

const cards = (moving: boolean, selected: string) => {
  const m = listing("org/m").models[0];
  const html = renderToString(
    <ModuleProvider module={{ id: "swiss", title: "s", basePath: "/swiss", pages: [] }}>
      <MemoryRouter>
        <VariantChoices
          variants={m.variants}
          current={deployed}
          moving={moving}
          selected={selected}
          onPick={() => {}}
          tuning={m.tuning}
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
    qc.setQueryData(["catalog", "public"], listing("org/m"));
    qc.setQueryData(["catalog", "internal"], listing("org/m"));
    qc.setQueryData(["history", "public", "m", "a"], { ref: "r", schema: "v1", model: "m", variant: "a", revisions: [
      { version: "1.1.0", digest: "d", current: true }, { version: "1.0.0", digest: "sha256:0123456789abcdef0123" }] });
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

describe("republishWarning", () => {
  const source = (version: string, digest: string, schema?: "v2") =>
    ({ ...deployed.source, version, digest, schema }) as Plan["source"];
  const revisions = [{ version: "1.1.0", digest: "d2" }, { version: "1.0.0", digest: "d1" }];
  const changed = "version 1.0.0 variant a: upstream digest changed since this was deployed";

  it("warns only while the target stays on the deployed version and variant", () => {
    expect(republishWarning(source("1.0.0", "d1"), "v1", revisions, "1.0.0", "a")).toBeUndefined();
    expect(republishWarning(source("1.0.0", "old"), "v1", revisions, "1.0.0", "a")).toBe(changed);
    expect(republishWarning(source("1.0.0", "old"), "v1", revisions, "1.1.0", "a")).toBeUndefined();
    expect(republishWarning(source("1.0.0", "old"), "v1", revisions, "1.0.0", "b")).toBeUndefined();
  });

  it("compares within the schema the plan was composed from", () => {
    expect(republishWarning(source("1.0.0", "old", "v2"), "v2", revisions, "1.0.0", "a")).toBe(changed);
    // A v1 plan against its catalog switched to v2 is a migration, not a rewrite.
    expect(republishWarning(source("1.0.0", "old"), "v2", revisions, "1.0.0", "a")).toBeUndefined();
  });
});
