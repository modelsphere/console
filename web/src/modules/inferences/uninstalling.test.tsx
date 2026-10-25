import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Deployment, Plan, ReleaseStatus } from "@swiss/lib/api";
import { ModuleProvider } from "@/shell/module";
import { InferenceDetail } from "@/modules/inferences/InferenceDetail";
import { InferenceList } from "@/modules/inferences/InferenceList";

const module = { id: "inferences", title: "模型服务", basePath: "/inferences", pages: [] };
const cluster = { name: "c", profile: "p", catalog: "u", version: "0", allowDeploy: true };
const plan = {
  apiVersion: "v1",
  release: { name: "qwen", namespace: "models" },
  source: { model: "qwen", version: "1", variant: "a" },
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

function button(html: string, label: string) {
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text !== label) continue;
    const at = m.index ?? 0;
    return {
      disabled: /(?:^|\s)disabled(?:\s*=|\s|$)/.test(m[1]),
      reason: /cursor-not-allowed/.test(html.slice(Math.max(0, at - 400), at)),
    };
  }
}

function renderList(rows: Deployment[]) {
  const c = client();
  c.setQueryData(["cluster"], cluster);
  c.setQueryData(["deployments", "inferences", 1, 25], {
    cluster: "c",
    catalogRef: "r",
    deployments: rows,
    page: 1,
    perPage: 25,
    summary: { total: rows.length, catalogBehind: 0 },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <ModuleProvider module={module}>
        <MemoryRouter>
          <InferenceList />
        </MemoryRouter>
      </ModuleProvider>
    </QueryClientProvider>,
  );
}

function renderDetail(status: ReleaseStatus) {
  const c = client();
  c.setQueryData(["cluster"], cluster);
  c.setQueryData(["status", "models", "qwen"], status);
  c.setQueryData(["releasePlan", "models", "qwen"], plan);
  c.setQueryData(["objects", "models", "qwen"], { objects: [] });
  c.setQueryData(["revisions", "models", "qwen"], { revisions: [{ revision: 2 }, { revision: 3, current: true }] });
  c.setQueryData(["runs", "models", "qwen"], { hasStore: true, runs: [] });
  c.setQueryData(["k8s-events", "models", "qwen"], { items: [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <ModuleProvider module={module}>
        <MemoryRouter initialEntries={["/inferences/qwen/details?namespace=models&tab=versions"]}>
          <Routes>
            <Route path="/inferences/:release/details" element={<InferenceDetail />} />
          </Routes>
        </MemoryRouter>
      </ModuleProvider>
    </QueryClientProvider>,
  );
}

describe("inference list while a deployment is uninstalling", () => {
  const html = renderList([
    deployment({ release: "going", phase: "uninstalling", status: undefined, revision: undefined, chart: undefined }),
    deployment({ release: "steady", phase: "applied", status: "deployed" }),
  ]);

  it("shows uninstalling for a row whose helm release is already gone, and applied for a live one", () => {
    const going = html.split(/<tr\b/).find((row) => row.includes("going"));
    const steady = html.split(/<tr\b/).find((row) => row.includes("steady"));
    expect(going).toContain("卸载中");
    expect(steady).toContain("已应用");
    expect(steady).not.toContain("卸载中");
  });
});

describe("inference detail write actions", () => {
  const cases: { name: string; status: ReleaseStatus; label: string; enabled: boolean }[] = [
    {
      name: "an uninstalling helm release",
      status: release({ exists: false, ready: 0, total: 1, helmStatus: undefined, pods: [{ name: "qwen-0", phase: "Running", ready: false, restarts: 0, ageSeconds: 30 }], planStatus: { phase: "uninstalling" } }),
      label: "卸载中",
      enabled: false,
    },
    {
      name: "an LLMService with a deletion timestamp",
      status: release({ ready: 1, total: 1, backend: "llmsvc", llmservice: { phase: "uninstalling" } }),
      label: "卸载中",
      enabled: false,
    },
    {
      name: "a serving release",
      status: release(),
      label: "运行中",
      enabled: true,
    },
  ];

  for (const tc of cases) {
    it(`${tc.name} shows ${tc.label} and ${tc.enabled ? "keeps" : "disables"} upgrade, uninstall, SLO edit and rollback`, () => {
      const html = renderDetail(tc.status);
      expect(html).toContain(tc.label);
      // The header keeps the health check. Write actions carry their reason on a
      // tooltip trigger; that popup is not in the static markup.
      const check = button(html, "服务检查");
      expect(check?.disabled).toBe(false);
      expect(check?.reason).toBe(false);
      for (const label of ["升级", "卸载", "编辑 SLO"]) {
        const found = button(html, label);
        expect(found, label).toBeDefined();
        expect(found?.disabled, label).toBe(!tc.enabled);
        expect(found?.reason, label).toBe(!tc.enabled);
      }
      // The current revision cannot roll back to itself. The older one can, until uninstall starts.
      const backs = html
        .split(/<tr\b/)
        .filter((row) => row.includes("回滚到此版"))
        .map((row) => ({ current: row.includes("当前"), ...button(row, "回滚到此版") }));
      expect(backs.map((b) => b.current).sort()).toEqual([false, true]);
      expect(backs.find((b) => b.current)?.disabled).toBe(true);
      const older = backs.find((b) => !b.current);
      expect(older?.disabled).toBe(!tc.enabled);
      expect(older?.reason).toBe(!tc.enabled);
    });
  }
});
