import { type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Deployment, Plan, ReleaseStatus } from "@swiss/lib/api";
import { ModuleProvider } from "@/shell/module";
import { DeploymentDetail } from "@swiss/routes/DeploymentDetail";
import { Deployments } from "@swiss/routes/Deployments";
import { Upgrade } from "@swiss/routes/Upgrade";

const module = { id: "swiss", title: "s", basePath: "/swiss", pages: [] };
const plan = {
  apiVersion: "v1",
  release: { name: "qwen", namespace: "models" },
  source: { catalogName: "public", model: "qwen", version: "1", variant: "a" },
  chart: { name: "vllm", version: "1" },
  engine: "vllm",
  profile: "p",
  layers: { form: { sloRequirement: { enabled: true } } },
  hash: "h",
} as Plan;

const deployment = (over: Partial<Deployment>): Deployment => ({ release: "qwen", namespace: "models", revision: 3, model: "qwen", ...over });
const release = (over: Partial<ReleaseStatus> = {}): ReleaseStatus => ({
  release: "qwen",
  namespace: "models",
  exists: true,
  revision: 3,
  helmStatus: "deployed",
  pods: [],
  ready: 1,
  total: 1,
  planStatus: { phase: "applied" },
  ...over,
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
}

function buttons(html: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    label: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    disabled: /(?:^|\s)disabled(?:\s*=|\s|$)/.test(m[1]),
  }));
}

function button(html: string, label: string) {
  return buttons(html).find((b) => b.label === label);
}

function page(c: QueryClient, path: string, element: ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <ModuleProvider module={module}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/deployments" element={element} />
            <Route path="/deployments/:namespace/:release" element={element} />
            <Route path="/upgrade/:namespace/:release" element={element} />
          </Routes>
        </MemoryRouter>
      </ModuleProvider>
    </QueryClientProvider>,
  );
}

describe("swiss deployment list", () => {
  it("shows uninstalling when the helm release is already gone, and leaves a live release deployed", () => {
    const c = client();
    c.setQueryData(["cluster"], { allowDeploy: true, catalog: "u", name: "c", profile: "p", version: "0" });
    c.setQueryData(["deployments", 1], {
      cluster: "c",
      catalogRef: "r",
      page: 1,
      perPage: 25,
      summary: { total: 2, catalogBehind: 0 },
      deployments: [
        deployment({ release: "going", phase: "uninstalling", status: undefined, revision: undefined, chart: undefined }),
        deployment({ release: "steady", phase: "applied", status: "deployed" }),
      ],
    });
    const html = page(c, "/deployments", <Deployments />);
    const going = html.split(/<tr\b/).find((row) => row.includes("going"));
    const steady = html.split(/<tr\b/).find((row) => row.includes("steady"));
    expect(going).toContain("uninstalling");
    expect(going).not.toContain("SLO");
    expect(steady).toContain("deployed");
    expect(steady).toContain("SLO");
  });
});

describe("swiss deployment detail", () => {
  const cases: { name: string; status: ReleaseStatus; enabled: boolean }[] = [
    {
      name: "disables upgrade and uninstall while helm is uninstalling",
      status: release({ exists: false, ready: 0, total: 1, helmStatus: undefined, planStatus: { phase: "uninstalling" } }),
      enabled: false,
    },
    {
      name: "disables upgrade and uninstall while an LLMService is being deleted",
      status: release({ backend: "llmsvc", llmservice: { phase: "uninstalling" } }),
      enabled: false,
    },
    {
      name: "keeps upgrade and uninstall for a serving release",
      status: release(),
      enabled: true,
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const c = client();
      c.setQueryData(["cluster"], { allowDeploy: true, catalog: "u", name: "c", profile: "p", version: "0" });
      c.setQueryData(["status", "models", "qwen"], tc.status);
      c.setQueryData(["releasePlan", "models", "qwen"], plan);
      c.setQueryData(["objects", "models", "qwen"], { objects: [] });
      const html = page(c, "/deployments/models/qwen", <DeploymentDetail />);
      expect(html).toContain(tc.enabled ? "applied" : "uninstalling");
      expect(button(html, "Upgrade")?.disabled).toBe(!tc.enabled);
      expect(button(html, "Uninstall…")?.disabled).toBe(!tc.enabled);
      if (!tc.enabled) expect(html).toContain("This release is uninstalling; wait until its pods are gone");
      expect(html.includes("Configure SLO")).toBe(tc.enabled);
    });
  }
});

describe("swiss upgrade page", () => {
  it("refuses upgrade and rollback while the release is uninstalling", () => {
    const c = client();
    c.setQueryData(["release-plan", "models", "qwen"], plan);
    c.setQueryData(["status", "models", "qwen"], release({ exists: false, planStatus: { phase: "uninstalling" }, ready: 0, total: 1 }));
    const html = page(c, "/upgrade/models/qwen", <Upgrade />);
    expect(html).toContain("This release is uninstalling; wait until its pods are gone");
    expect(html).not.toContain("Compose upgrade");
    expect(html).not.toContain("Review rollback");
  });
});
