import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home } from "@/shell/pages/Home";
import { PermissionsProvider } from "@/shell/permissions";
import { inferencesModule } from "@/modules/inferences";
import { DASHBOARD_PAGE_SIZE } from "@/modules/inferences/Dashboard";
import { recordedTimeline } from "@/modules/inferences/dashboard-lib";
import { DEFAULT_LOCALE, setLocale } from "@/shell/i18n";
import type { CatalogResponse, ClusterInfo, Deployment, DeploymentsResponse, NodesResponse, ReleaseStatus, RunsResponse } from "@swiss/lib/api";

vi.mock("@/shell/auth", () => ({ useAuth: () => ({ me: { name: "tester", isAdmin: true, groups: [], permissions: ["*"] } }) }));

const from = "2026-10-10T12:15:00Z";
const to = "2026-10-11T12:15:00Z";
const row = (release: string): Deployment => ({ release, namespace: "models", revision: 1, status: "deployed" });
const status = (release: string, ready: number, total: number, extra: Partial<ReleaseStatus> = {}): ReleaseStatus => ({ release, namespace: "models", exists: true, revision: 1, pods: [], ready, total, ...extra });
const nodes: NodesResponse = { cluster: "c", nodes: [], summary: { nodes: 1, gpus: 1, gpusUsed: 0 } };
const cluster: ClusterInfo = { name: "c", profile: "p", catalog: "u", version: "0", allowDeploy: true, catalogs: [{ name: "default", url: "u", source: "u", default: true }] };
const catalog: CatalogResponse = { name: "default", ref: "r", source: "u", schema: "v2", models: [] };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
}
function seed(c: QueryClient, deployments: Deployment[]) {
  c.setQueryData(["cluster"], cluster);
  c.setQueryData(["catalog", "default"], catalog);
  c.setQueryData<DeploymentsResponse>(["deployments", "dashboard", "all"], { cluster: "c", catalogRef: "r", deployments, page: 1, perPage: 100, summary: { total: deployments.length, catalogBehind: 0 } });
  c.setQueryData(["nodes"], nodes);
  c.setQueryData(["runs", "dashboard", "timeline"], recordedTimeline([], from, to, true));
  c.setQueryData<RunsResponse>(["runs", "dashboard"], { hasStore: true, runs: [] });
}
function render(c: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <MemoryRouter>
        <PermissionsProvider>
          <Home modules={[inferencesModule]} />
        </PermissionsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function fail(c: QueryClient, key: readonly unknown[], message: string) {
  c.getQueryCache().build(c, { queryKey: key }).setState({ status: "error", fetchStatus: "idle", error: new Error(message) });
}
afterEach(() => setLocale(DEFAULT_LOCALE));

describe("home service health", () => {
  it("counts every service's live state, not only the visible rows", () => {
    const c = client();
    const deployments = ["ok-a", "ok-b", "bad", "loading"].map(row);
    seed(c, deployments);
    c.setQueryData(["status", "models", "ok-a"], status("ok-a", 2, 2));
    c.setQueryData(["status", "models", "ok-b"], status("ok-b", 2, 2));
    c.setQueryData(["status", "models", "bad"], status("bad", 0, 1, { helmStatus: "failed" }));
    c.setQueryData(["status", "models", "loading"], status("loading", 0, 2));
    const html = render(c);
    expect(html).toContain('aria-label="可用服务: 2"');
    expect(html).toContain('aria-label="异常服务: 1"');
    expect(html).toContain('aria-label="加载 / 变更中: 1"');
    expect(html).toContain('aria-label="就绪实例: 4 / 7"');
  });

  it("lists troubled services before healthy ones in the preview", () => {
    const c = client();
    seed(c, ["ok-a", "bad", "loading"].map(row));
    c.setQueryData(["status", "models", "ok-a"], status("ok-a", 1, 1));
    c.setQueryData(["status", "models", "bad"], status("bad", 0, 1, { helmStatus: "failed" }));
    c.setQueryData(["status", "models", "loading"], status("loading", 0, 1));
    const html = render(c);
    expect(html.indexOf(">bad<")).toBeLessThan(html.indexOf(">loading<"));
    expect(html.indexOf(">loading<")).toBeLessThan(html.indexOf(">ok-a<"));
  });

  it("warns instead of guessing when a service state cannot be read", () => {
    const c = client();
    seed(c, ["ok-a", "bad"].map(row));
    c.setQueryData(["status", "models", "ok-a"], status("ok-a", 1, 1));
    fail(c, ["status", "models", "bad"], "status-forbidden");
    const html = render(c);
    expect(html).toContain("有 1 个服务状态未确认");
    expect(html).toContain("重试");
    expect(html).not.toContain('aria-label="异常服务: 1"');
  });

  it("shows the deployment trend in the left column, above the service list", () => {
    const c = client();
    seed(c, []);
    const html = render(c);
    const trend = html.indexOf("模型部署动态");
    expect(trend).toBeGreaterThan(-1);
    expect(trend).toBeLessThan(html.indexOf('aria-label="推理服务"'));
    expect(trend).toBeLessThan(html.indexOf("<aside"));
    expect(html.indexOf("集群信息")).toBeGreaterThan(html.indexOf("<aside"));
    expect(html).toContain("展示 0 / 0 个服务");
  });

  it("places session below cluster info and resources beside activity below services", () => {
    const c = client();
    seed(c, []);
    const html = render(c);
    const asideStart = html.indexOf("<aside");
    const aside = html.slice(asideStart, html.indexOf("</aside>", asideStart));
    const services = html.indexOf('aria-label="推理服务"');
    const resources = html.indexOf('aria-label="算力资源"');
    const activity = html.indexOf('aria-label="最近操作"');
    expect(resources).toBeGreaterThan(services);
    expect(activity).toBeGreaterThan(resources);
    expect(activity).toBeLessThan(asideStart);
    expect(aside.includes("集群信息")).toBe(true);
    expect(aside.indexOf("当前会话")).toBeGreaterThan(aside.indexOf("集群信息"));
    expect(aside.includes('aria-label="算力资源"')).toBe(false);
    expect(aside.includes('aria-label="最近操作"')).toBe(false);
    expect(html.match(/<summary[^>]*>当前会话<\/summary>/g)).toHaveLength(1);
  });

  it(`keeps the preview bounded at ${DASHBOARD_PAGE_SIZE} rows`, () => {
    const c = client();
    seed(c, Array.from({ length: 9 }, (_, i) => row(`svc-${i}`)));
    expect(render(c)).toContain("展示 6 / 9 个服务");
  });
});
