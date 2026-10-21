import { describe, expect, it, vi } from "vitest";
import { createLiveApi } from "./live-api";
import { registerCanaryLocales } from "../locales";
import i18next from "i18next";

describe("live transport", () => {
  it("uses injected authentication and exposes real failures", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ error: "read-only backend permission" }),
          { status: 403 },
        ),
    );
    const api = createLiveApi(fetcher);
    await expect(api.experiments.stop("a/b")).rejects.toThrow(
      "read-only backend permission",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/canary/experiments/a%2Fb/stop",
    );
    expect(api.mode).toBe("live");
  });
  it("submits only the frozen plan ID", async () => {
    let body = "";
    const api = createLiveApi(async (_, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ id: "experiment" }));
    });
    await api.experiments.create("frozen");
    expect(JSON.parse(body)).toEqual({ prepareId: "frozen" });
  });
  it("resolves active canaries from summaries and loads their detail", async () => {
    const canary = { metadata: { name: "exp", namespace: "canary" }, spec: {} };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/experiments"))
        return new Response(
          JSON.stringify([
            {
              id: "active",
              name: "exp",
              namespace: "canary",
              cleanup: "pending",
              targetRef: { name: "prod" },
            },
            {
              id: "history",
              name: "exp",
              namespace: "canary",
              cleanup: "complete",
              targetRef: { name: "prod" },
            },
          ]),
        );
      if (path.endsWith("/experiments/active"))
        return new Response(JSON.stringify({ id: "active", canary }));
      throw new Error(`unexpected request ${path}`);
    });
    const api = createLiveApi(fetcher);
    expect(await api.canary.get("canary", "exp")).toEqual(canary);
    expect(await api.canary.list()).toEqual([canary]);
    expect(fetcher.mock.calls.map(([path]) => path)).not.toContain(
      "/api/canary/experiments/history",
    );
  });
  it("loads allowed namespaces from the deployment configuration", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ namespaces: ["team-a", "team-b"] })),
    );
    expect(await createLiveApi(fetcher).config()).toEqual({
      namespaces: ["team-a", "team-b"],
    });
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it("sends currency, GPU view and valuation revisions through authenticated transport", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    const api = createLiveApi(fetcher);
    await api.experiments.metrics("a/b", 60, 180, {
      currency: "CNY",
      normalization: "as-if",
      targetGPUs: 16,
    });
    const url = new URL(
      String(fetcher.mock.calls[0][0]),
      "https://console.example",
    );
    expect(url.pathname).toBe("/api/canary/experiments/a%2Fb/metrics");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start: "60",
      end: "180",
      currency: "CNY",
      normalization: "as-if",
      gpus: "16",
    });
    await api.experiments.revalue("a/b", 3, [
      { name: "control", pricingKey: "stable-model", gpuCount: 8 },
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(
      "/api/canary/experiments/a%2Fb/valuation",
    );
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      revision: 3,
      arms: [{ name: "control", pricingKey: "stable-model", gpuCount: 8 }],
    });
  });
  it("uses official v2 summaries without raw index fields and leaves chart resolution to Swiss", async () => {
    const api = createLiveApi(
      async () =>
        new Response(
          JSON.stringify({
            schema: "v2",
            name: "next",
            ref: "sha256:index",
            models: [
              {
                name: "model",
                defaultVariant: "arm",
                tuning: [{ baseline: { id: "old", version: "1.0.0" }, optimized: { id: "arm", version: "2.0.0" } }],
                variants: [
                  {
                    id: "arm",
                    chart: { name: "sglang", version: ">=1.0.0" },
                    engine: "sglang",
                    version: "2.0.0",
                    digest: "sha256:variant",
                    servedName: "served-model",
                    requires: { gpus: 1 },
                  },
                ],
              },
            ],
          }),
        ),
    );
    const variants = await api.catalog.variants();
    expect(variants[0].resolvedChartVersion).toBe("");
    expect(variants[0].values).toEqual({});
    expect(variants[0]).toMatchObject({ model: "model", id: "arm", version: "2.0.0", digest: "sha256:variant", servedName: "served-model", requires: { gpus: 1 } });
    expect(variants[0]).not.toHaveProperty("path");
    expect(variants[0]).not.toHaveProperty("image");
  });
  it.each([{ schema: "v1" }, { apiVersion: "catalog.swiss/v2" }])("rejects incompatible catalog contracts: %j", async (body) => {
    const api = createLiveApi(async () => new Response(JSON.stringify({ ...body, models: [] })));
    await expect(api.catalog.variants()).rejects.toThrow("catalog schema v2 is required");
  });
});
it("registers canary translations without replacing host resources", async () => {
  const host = i18next.createInstance();
  await host.init({
    lng: "zh-CN",
    resources: { "zh-CN": { shell: { title: "host" } } },
  });
  registerCanaryLocales(host);
  expect(host.t("experiments.stop", { ns: "canary" })).toBe("停止实验");
  expect(host.t("title", { ns: "shell" })).toBe("host");
});

describe("arm chart versions", () => {
  it("queries the authenticated Swiss proxy for the exact catalog and historical variant revision", async () => {
    const response = { chart: "sglang", range: ">=0.7.1", variant: "tp8+h100", versions: ["0.9.0", "0.8.0", "0.8.0"] };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(response)));
    const api = createLiveApi(fetcher, "/custom/canary");
    expect(await api.catalog.chartVersions({ catalog: "public & private", model: "model/name", variant: "tp8+h100", version: "1.2.0+build" }))
      .toEqual({ ...response, versions: ["0.9.0", "0.8.0"] });
    const [input, init] = fetcher.mock.calls[0];
    const url = new URL(String(input), "https://console.example");
    expect(url.pathname).toBe("/api/deploy/catalog/model%2Fname/chart-versions");
    expect(Object.fromEntries(url.searchParams)).toEqual({ catalog: "public & private", variant: "tp8+h100", version: "1.2.0+build" });
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(init?.body).toBeUndefined();
  });
  it("preserves no available versions rather than inventing a pin", async () => {
    const data = { chart: "vllm", range: ">=99.0.0", variant: "arm", versions: [] };
    const api = createLiveApi(async () => new Response(JSON.stringify(data)));
    expect(await api.catalog.chartVersions({ model: "m", variant: "arm", version: "1.0.0" })).toEqual(data);
  });
  it.each([
    { chart: "sglang", range: "*", variant: "arm", versions: [">=0.8.0"] },
    { chart: "sglang", range: "*", variant: "other", versions: ["0.8.0"] },
    { chart: "sglang", range: "*", variant: "arm", versions: [null] },
    { chart: "sglang", range: "*", variant: "arm", versions: "0.8.0" },
    null,
  ])("rejects malformed or mismatched Swiss responses: %j", async (data) => {
    const api = createLiveApi(async () => new Response(JSON.stringify(data)));
    await expect(api.catalog.chartVersions({ model: "m", variant: "arm", version: "1.0.0" }))
      .rejects.toMatchObject({ code: "badResponse" });
  });
  it("keeps permission failures available for localized rendering", async () => {
    const api = createLiveApi(async () => new Response(JSON.stringify({ error: "backend swiss denied" }), { status: 403 }));
    await expect(api.catalog.chartVersions({ model: "m", variant: "arm", version: "1.0.0" }))
      .rejects.toMatchObject({ status: 403, message: "backend swiss denied" });
  });
  it("sends independently selected exact arm versions unchanged to prepare", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    const api = createLiveApi(fetcher);
    const { emptyDraft } = await import("./emit");
    const draft = emptyDraft();
    draft.arms = ["0.9.0", "0.8.0"].map((version, i) => ({
      name: i === 0 ? "baseline" : "candidate", chart: { name: "sglang", version },
      replicaCount: 1, layers: {}, source: { catalog: "upstreamv2", model: "m", variant: "tp8", version: "1.0.0" },
    }));
    await api.experiments.prepare(draft);
    const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(payload.arms.map((a: { chart: { version: string } }) => a.chart.version)).toEqual(["0.9.0", "0.8.0"]);
  });
});
