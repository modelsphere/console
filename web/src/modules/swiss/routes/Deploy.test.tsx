import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { Deploy } from "./Deploy";
import { ModuleProvider } from "@/shell/module";

function page(engine: string, chart: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const variant = { id: "a", engine, version: "1.0.0", digest: "d", chart: { name: chart, version: "0.3.0" }, requires: { gpus: 4 }, servedName: "m" };
  qc.setQueryData(["cluster"], { allowDeploy: true, namespace: "models", catalogs: [{ name: "public", url: "u", source: "s", ref: "r", default: true }] });
  qc.setQueryData(["profile"], { profile: { defaults: {}, nodes: {} } });
  qc.setQueryData(["nodes"], { nodes: [] });
  qc.setQueryData(["history", "public", "m", ""], { ref: "r", schema: "v2", model: "m", variant: "a", revisions: [] });
  qc.setQueryData(["model", "public", "m", "", ""], {
    ref: "r",
    schema: "v2",
    model: { name: "m", source: { hf: "org/m" }, defaultVariant: "a", variants: [variant] },
    variant,
  });
  const html = renderToString(
    <QueryClientProvider client={qc}>
      <ModuleProvider module={{ id: "swiss", title: "s", basePath: "/swiss", pages: [] }}>
        <MemoryRouter initialEntries={["/deploy/m"]}>
          <Routes>
            <Route path="/deploy/:name" element={<Deploy />} />
          </Routes>
        </MemoryRouter>
      </ModuleProvider>
    </QueryClientProvider>,
  );
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("Deploy page", () => {
  it("shows the video settings for a video variant, and none of the LLM sections", () => {
    const text = page("video", "minimax-h3");
    for (const want of ["Video deploy settings", "Pools", "FL2VA", "Ref2VA", "Turbo", "Autoscaling", "Storage and database", "8 GPU s in total"]) {
      expect(text).toContain(want);
    }
    for (const llmOnly of ["Routing options", "CART", "Expose routed peer", "Adaptive concurrency", "TTFT limit", "Compile cache", "Model path"]) {
      expect(text).not.toContain(llmOnly);
    }
  });

  it("keeps the LLM settings for an LLM variant", () => {
    const text = page("sglang", "sglang");
    for (const want of ["Deploy settings", "Routing options", "CART", "SLO requirement"]) expect(text).toContain(want);
    expect(text).not.toContain("Video deploy settings");
  });
});
