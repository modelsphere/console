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
import type {
  CatalogResponse,
  ClusterInfo,
  Deployment,
  DeploymentsResponse,
  NodesResponse,
  ReleaseStatus,
  RunsResponse,
} from "@swiss/lib/api";

const auth = vi.hoisted(() => ({ permissions: ["*"] }));
vi.mock("@/shell/auth", () => ({
  useAuth: () => ({ me: { name: "tester", isAdmin: true, groups: [], permissions: auth.permissions } }),
}));
const clients: QueryClient[] = [];
const deploymentsKey = ["deployments", "dashboard", "all"];
const historyKey = ["runs", "dashboard", "timeline"];
const deployment: Deployment = {
  release: "qwen",
  namespace: "models",
  model: "Qwen3",
  version: "1",
  route: "qwen",
  revision: 2,
  status: "deployed",
};
const live: ReleaseStatus = {
  release: "qwen",
  namespace: "models",
  exists: true,
  revision: 2,
  helmStatus: "deployed",
  pods: [],
  ready: 1,
  total: 2,
};
const nodes: NodesResponse = {
  cluster: "test-cluster",
  nodes: [
    {
      Name: "worker",
      GPUProduct: "H100",
      GPUs: 8,
      Ready: true,
      Schedulable: true,
      Kubelet: "v1.30.12",
      gpusUsed: 4,
      gpusFree: 4,
    },
  ],
  summary: { nodes: 1, gpus: 8, gpusUsed: 4 },
};
const cluster: ClusterInfo = {
  name: "test-cluster",
  profile: "site.yaml",
  namespace: "models",
  catalog: "https://catalog.example",
  version: "0.6.3",
  allowDeploy: true,
  catalogs: [
    { name: "default", url: "https://catalog.example", source: "https://catalog.example/index.json", default: true },
  ],
};
const catalog: CatalogResponse = {
  name: "default",
  ref: "main",
  source: "https://catalog.example",
  schema: "v2",
  models: [
    {
      name: "alpha",
      displayName: "Alpha Model",
      source: { hf: "org/alpha" },
      defaultVariant: "base",
      variants: [
        { id: "base", version: "2", digest: "b2", engine: "vllm", chart: { name: "vllm", version: "2" }, requires: { gpus: 1 } },
        { id: "tuned", version: "2", digest: "t2", engine: "sglang", chart: { name: "sglang", version: "2" }, requires: { gpus: 2 } },
      ],
    },
  ],
};
const history = recordedTimeline([], "2026-10-10T12:15:00Z", "2026-10-11T12:15:00Z", true);

function client() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  clients.push(c);
  return c;
}
function seed(c: QueryClient, deployments: Deployment[] = [deployment]) {
  c.setQueryData(["cluster"], cluster);
  c.setQueryData(["catalog", "default"], catalog);
  c.setQueryData<DeploymentsResponse>(deploymentsKey, {
    cluster: "test-cluster",
    catalogRef: "main",
    deployments,
    page: 1,
    perPage: DASHBOARD_PAGE_SIZE,
    summary: { total: deployments.length ? 42 : 0, catalogBehind: 0 },
  });
  c.setQueryData(["nodes"], nodes);
  c.setQueryData(["status", "models", "qwen"], live);
  c.setQueryData(historyKey, history);
  c.setQueryData<RunsResponse>(["runs", "dashboard"], {
    hasStore: true,
    runs: [
      {
        id: 1,
        namespace: "models",
        release: "qwen",
        action: "apply",
        planHash: "hash",
        changed: true,
        startedAt: "2026-10-11T12:00:00Z",
        endedAt: "2026-10-11T12:01:00Z",
      },
    ],
  });
}
function render(c: QueryClient, basePath = inferencesModule.basePath) {
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <MemoryRouter>
        <PermissionsProvider>
          <Home modules={[{ ...inferencesModule, basePath }]} />
        </PermissionsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function fail(c: QueryClient, key: readonly unknown[], message: string) {
  c.getQueryCache()
    .build(c, { queryKey: key })
    .setState({ status: "error", fetchStatus: "idle", error: new Error(message) });
}
afterEach(() => {
  setLocale(DEFAULT_LOCALE);
  auth.permissions = ["*"];
  clients.splice(0).forEach((c) => c.clear());
});

describe("model operations dashboard", () => {
  it("shows prominent supported model and full recipe totals without arbitrary previews", () => {
    const c = client();
    seed(c);
    const html = render(c);
    expect(html).toContain('aria-label="支持模型: 1"');
    expect(html).toContain('aria-label="配方总数: 2"');
    expect(html).not.toContain("Alpha Model");
    expect(html).not.toContain("模型展示");
    expect(html).not.toContain("max-w-[1600px]");
  });
  it("counts all configured catalogs even when none is marked default", () => {
    const c = client();
    seed(c);
    c.setQueryData(["cluster"], {
      ...cluster,
      catalogs: [
        { name: "first", url: "first", source: "first" },
        { name: "second", url: "second", source: "second" },
      ],
    });
    c.setQueryData(["catalog", "first"], catalog);
    c.setQueryData(["catalog", "second"], {
      ...catalog,
      models: catalog.models.map((m) => ({ ...m, name: "beta", source: { hf: "org/beta" } })),
    });
    const html = render(c);
    expect(html).toContain('aria-label="支持模型: 2"');
    expect(html).toContain('aria-label="配方总数: 4"');
  });
  it("does not present partial catalog results as a complete capability total", () => {
    const c = client();
    seed(c);
    c.setQueryData(["cluster"], {
      ...cluster,
      catalogs: [...cluster.catalogs!, { name: "broken", url: "broken", source: "broken" }],
    });
    fail(c, ["catalog", "broken"], "catalog-read-failed");
    const html = render(c);
    expect(html).toContain('aria-label="支持模型: -"');
    expect(html).toContain('aria-label="配方总数: -"');
    expect(html).toContain("catalog-read-failed");
    expect(html).toContain("重试");
  });
  it("shows an operational 24-hour trend separately from the current service snapshot", () => {
    const c = client();
    seed(c);
    c.setQueryData(historyKey, {
      ...history,
      buckets: history.buckets.map((b, i) => ({ ...b, started: i === 2 ? 7 : 0, updated: i === 3 ? 2 : 0 })),
    });
    const html = render(c);
    expect(html).toContain("模型部署动态");
    expect(html).toContain("过去 24 小时");
    expect(html).toContain("部署启动");
    expect(html).toContain("更新 / 回滚");
    expect(html).toContain('role="img"');
    expect(html).toContain("展示 1 / 42 个服务");
  });
  it("does not fake a zero time series when history persistence is unavailable", () => {
    const c = client();
    seed(c);
    c.setQueryData(historyKey, { ...history, hasStore: false, buckets: [] });
    const html = render(c);
    expect(html).toContain("未启用部署历史记录");
    expect(html).not.toContain('aria-label="过去 24 小时部署启动');
  });
  it("does not draw a complete graph from capped legacy history", () => {
    const c = client();
    seed(c);
    c.setQueryData(historyKey, { ...history, complete: false, buckets: [] });
    const html = render(c);
    expect(html).toContain("24 小时数据不完整");
    expect(html).not.toContain('aria-label="过去 24 小时部署启动');
  });
  it("keeps chart errors local and retryable", () => {
    const c = client();
    seed(c);
    fail(c, historyKey, "timeline-read-failed");
    const html = render(c);
    expect(html).toContain("timeline-read-failed");
    expect(html).toContain("重试");
    expect(html).toContain("Qwen3 v1");
  });
  it("uses live instance readiness rather than just deployed Helm status", () => {
    const c = client();
    seed(c);
    const html = render(c);
    expect(html).toContain("1 / 2");
    expect(html).toContain("加载中");
    expect(html).not.toContain("运行中");
    c.setQueryData(["status", "models", "qwen"], { ...live, ready: 2 });
    expect(render(c)).toContain("运行中");
  });
  it("keeps node GPU usage unknown on insufficient pod-list permissions", () => {
    const c = client();
    seed(c);
    c.setQueryData(["nodes"], {
      ...nodes,
      usageError: "pod-list-forbidden",
      summary: { ...nodes.summary, gpusUsed: 12345 },
    });
    const html = render(c);
    expect(html).toContain("未测量");
    expect(html).toContain("pod-list-forbidden");
    expect(html).not.toContain("12345");
  });
  it("preserves empty service deployment entry and recent operation links", () => {
    const c = client();
    seed(c, []);
    const html = render(c);
    expect(html).toContain("还没有推理服务");
    expect(html).toContain("部署模型");
    expect(html).toContain('href="/inferences/catalog"');
    expect(html).toContain("tab=runs");
  });
  it("does not restore the removed global refresh control", () => {
    const c = client();
    seed(c);
    const html = render(c);
    expect(html).not.toContain('aria-label="刷新"');
    expect(html).not.toContain('title="刷新"');
  });
  it("retains boxed surfaces and collapsed session information", () => {
    const c = client();
    seed(c);
    const html = render(c);
    const panels = ["模型部署动态", "算力概况", "推理服务", "集群信息", "算力资源", "最近操作"];
    for (const label of panels) {
      expect(html.match(new RegExp(`<section[^>]*aria-label="${label}"`, "g"))).toHaveLength(1);
    }
    expect(html.match(/overflow-hidden rounded-lg border border-border bg-card/g)).toHaveLength(panels.length);
    expect(html).toContain('class="rounded-lg border border-border bg-card p-4 text-sm"');
    expect(html).not.toContain("<details open");
  });
  it("keeps extra-wide columns balanced and capacity stretched beside the trend", () => {
    const c = client();
    seed(c);
    const html = render(c);
    expect(html).toContain("2xl:grid-cols-[minmax(0,1fr)_minmax(360px,20%)]");
    expect(html).toContain("min-[120rem]:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]");
    expect(html).toContain('class="min-w-0 h-full" aria-label="算力概况"');
    expect(html).toContain("flex flex-1 items-center justify-center");
  });
  it("keeps Kubernetes node versions distinct from the inference backend version", () => {
    const c = client();
    seed(c);
    const html = render(c);
    expect(html).toContain("K8s 节点版本");
    expect(html).toContain("v1.30.12");
    expect(html).toContain("swissd 版本");
    expect(html).toContain("0.6.3");
  });
  it("retains the session when no overview modules are installed", () => {
    const html = renderToStaticMarkup(<Home modules={[]} />);
    expect(html.match(/<summary[^>]*>当前会话<\/summary>/g)).toHaveLength(1);
    expect(html).toContain("tester");
    expect(html).not.toContain("<details open");
  });
  it("does not request inference data without view permission", () => {
    auth.permissions = [];
    const c = client();
    const html = render(c);
    expect(html).not.toContain('aria-label="推理运行概览"');
    expect(html).toContain("当前会话");
    expect(html).toContain("tester");
    expect(c.getQueryCache().getAll()).toHaveLength(0);
  });
  it("keeps all navigation under the mounted module and translates to English", () => {
    setLocale("en-US");
    const c = client();
    seed(c);
    const html = render(c, "/serving");
    expect(html).toContain("Supported models");
    expect(html).toContain("Total recipes");
    expect(html).toContain("Model Deployment Activity");
    expect(html).toContain('href="/serving/catalog"');
    expect(html).toContain('href="/serving/qwen/details?namespace=models"');
    expect(html).not.toContain("dashboard.");
  });
});
