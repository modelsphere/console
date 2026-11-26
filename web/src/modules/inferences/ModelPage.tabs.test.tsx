import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogModel, CatalogResponse, ClusterInfo, ModelResponse, ModelVariant } from "@swiss/lib/api";
import type { ResourcePresentationProps } from "@/extensions/types";
import type { Capabilities } from "@/shell/api";
import { CapabilityContext } from "@/shell/capabilities";
import { createRegistration, type InstalledPlugin } from "@/shell/global-sdk/runtime";
import { ModuleProvider } from "@/shell/module";
import { PermissionsProvider } from "@/shell/permissions";
import { CatalogPage } from "./CatalogPage";
import { ModelPage } from "./ModelPage";

const auth = vi.hoisted(() => ({ name: "alice", permissions: [] as string[] }));
vi.mock("@/shell/auth", () => ({ useAuth: () => ({ me: auth }) }));

const module = { id: "inferences", title: "Inference", basePath: "/inferences", pages: [] };
const catalog = "internal";
const source = "https://catalog.example/internal";
const variant: ModelVariant = {
  id: "recipe-a",
  version: "1.2.3",
  digest: "sha256:1234",
  engine: "vllm",
  chart: { name: "vllm", version: "1.0.0" },
  requires: { gpus: 1 },
  default: true,
};
const model: CatalogModel = {
  name: "qwen",
  source: { hf: "example/qwen", revision: "commit" },
  defaultVariant: variant.id,
  variants: [variant],
};
const cluster: ClusterInfo = {
  name: "dev",
  profile: "default",
  catalog: source,
  version: "1",
  allowDeploy: true,
  catalogs: [{ name: catalog, url: source, source, schema: "v2" }],
};
const index: CatalogResponse = { name: catalog, ref: "main", source, schema: "v2", models: [model] };
const detail: ModelResponse = {
  ref: "main",
  schema: "v2",
  localPath: "/weights/qwen",
  model,
  variant: { ...variant, servedName: "qwen-inference" },
};
const backend = { name: "tuning-api", prefix: "/api/tuning" };
const enabled: Capabilities = { "tuning-api": { configured: true, canRead: true, canWrite: false } };
const detailPath = "/inferences/catalog/qwen?catalog=internal";
const runtimes: ReturnType<typeof createRegistration>[] = [];

afterEach(() => {
  auth.permissions = [];
  for (const runtime of runtimes.splice(0)) {
    runtime.rollback();
    runtime.end();
  }
});

function render(path: string, capabilities: Capabilities = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["cluster"], cluster);
  client.setQueryData(["catalog", catalog], index);
  client.setQueryData(["model", catalog, model.name, "", ""], detail);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CapabilityContext.Provider value={{ data: capabilities, loading: false, failed: false, retry: () => undefined }}>
        <PermissionsProvider>
          <ModuleProvider module={module}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/inferences/catalog" element={<CatalogPage />} />
                <Route path="/inferences/catalog/:name" element={<ModelPage />} />
              </Routes>
            </MemoryRouter>
          </ModuleProvider>
        </PermissionsProvider>
      </CapabilityContext.Provider>
    </QueryClientProvider>,
  );
}

function registerPlugin(id: string, pluginBackend?: InstalledPlugin["backend"]) {
  const runtime = createRegistration();
  runtime.begin({ id, entry: `/plugins/${id}/index.js`, backend: pluginBackend });
  runtimes.push(runtime);
  runtime.sdk.registerPlugin({ name: id, version: "1.0.0", menus: [{ name: "home", path: `/${id}` }] });
  runtime.sdk.registerPluginRoutes(id, { [`/${id}`]: () => null });
  return runtime;
}

describe("ModelPage resource tabs", () => {
  it("uses the model and catalog as context, orders tab contributions, and requires UI and backend access", () => {
    const tuning = registerPlugin("tuning", backend);
    const History = vi.fn((_props: ResourcePresentationProps) => <p>Task panel content</p>);
    tuning.sdk.registerPluginComponent("tuning", "History", History);
    tuning.sdk.registerPresentationExtension("tuning", {
      id: "history",
      resourceType: "catalog-model",
      placement: "resource.tabs",
      key: "history",
      authKey: "tuning.tasks.view",
      tab: { title: "Task history", order: 10 },
      component: "History",
    });
    tuning.finish();
    const guide = registerPlugin("guide");
    guide.sdk.registerPluginComponent("guide", "History", () => <p>Guide panel content</p>);
    guide.sdk.registerPresentationExtension("guide", {
      id: "history", resourceType: "catalog-model", placement: "resource.tabs", key: "history",
      tab: { title: "Guide history", order: 5 }, component: "History",
    });
    guide.finish();
    const url = detailPath + "&tab=plugin:tuning:history";

    expect(render(url, enabled)).not.toContain("Task history");
    auth.permissions = ["tuning.tasks.view"];
    const denied = render(url, { "tuning-api": { configured: true, canRead: false, canWrite: false } });
    expect(denied).toContain("recipe-a");
    expect(denied).not.toContain("Task history");
    expect(History).not.toHaveBeenCalled();

    const allowed = render(url, enabled);
    expect(allowed).toContain("Task panel content");
    expect(allowed).not.toContain("Guide panel content");
    expect(allowed.indexOf("Guide history")).toBeLessThan(allowed.indexOf("Task history"));
    expect(History.mock.lastCall?.[0]).toMatchObject({
      resourceType: "catalog-model",
      resourceKey: JSON.stringify([catalog, model.name]),
      resource: { catalog, model, schema: "v2", localPath: "/weights/qwen", servedName: "qwen-inference" },
    });

    const info = render(detailPath + "&tab=info", enabled);
    expect(info).toContain("qwen-inference");
    expect(info).not.toContain("Task panel content");

    tuning.rollback();
    const removed = render(url, enabled);
    expect(removed).toContain("recipe-a");
    expect(removed).not.toContain("Task history");
    expect(removed).toContain("Guide history");
  });
});

describe("model catalog resource actions", () => {
  it("passes the selected catalog, model and pinned recipe to permitted actions", () => {
    const listPath = "/inferences/catalog?catalog=internal";
    expect(render(listPath, enabled)).not.toContain("<footer");
    expect(render(detailPath, enabled)).not.toContain("<footer");
    const tuning = registerPlugin("tuning", backend);
    const ModelAction = vi.fn((_props: ResourcePresentationProps) => <button type="button">Start model task</button>);
    let showRecipeActions = true;
    const RecipeAction = vi.fn((_props: ResourcePresentationProps) => showRecipeActions ? <button type="button">Start recipe task</button> : null);
    const BaselineAction = () => showRecipeActions ? <button type="button">Set as baseline</button> : null;
    tuning.sdk.registerPluginComponent("tuning", "ModelAction", ModelAction);
    tuning.sdk.registerPluginComponent("tuning", "RecipeAction", RecipeAction);
    tuning.sdk.registerPluginComponent("tuning", "BaselineAction", BaselineAction);
    tuning.sdk.registerPresentationExtension("tuning", {
      id: "list-tune", resourceType: "catalog-model", placement: "collection.card.actions",
      key: "tune", component: "ModelAction", authKey: "tuning.tasks.write",
    });
    tuning.sdk.registerPresentationExtension("tuning", {
      id: "model-tune", resourceType: "catalog-model", placement: "resource.header.actions",
      key: "tune", component: "ModelAction", authKey: "tuning.tasks.write",
    });
    tuning.sdk.registerPresentationExtension("tuning", {
      id: "recipe-tune", resourceType: "catalog-variant", placement: "collection.card.actions",
      key: "tune", component: "RecipeAction", authKey: "tuning.tasks.write",
    });
    tuning.sdk.registerPresentationExtension("tuning", {
      id: "recipe-baseline", resourceType: "catalog-variant", placement: "collection.card.actions",
      key: "baseline", component: "BaselineAction", authKey: "tuning.baselines.write",
    });
    tuning.finish();
    expect(render(listPath, enabled)).not.toContain("Start model task");
    auth.permissions = ["tuning.tasks.write", "tuning.baselines.write"];
    const denied = render(detailPath, { "tuning-api": { configured: true, canRead: false, canWrite: false } });
    expect(denied).not.toContain("Start model task");
    expect(denied).not.toContain("Start recipe task");
    expect(denied).not.toContain("<footer");

    const list = render(listPath, enabled);
    expect(list).toMatch(/<footer\b[^>]*justify-end[^>]*>\s*<button[^>]*>Start model task<\/button><\/footer>/);
    expect(list).not.toContain("Start recipe task");
    const modelKey = JSON.stringify([catalog, model.name]);
    expect(ModelAction.mock.lastCall?.[0]).toMatchObject({ resourceKey: modelKey, resource: { catalog, model, schema: "v2" } });

    const page = render(detailPath, enabled);
    expect(page).toContain("Start model task");
    const footer = page.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
    expect(footer).toContain("justify-end");
    expect(footer).toContain("Start recipe task");
    expect(footer).toContain("Set as baseline");
    expect(page.match(/<header\b[^>]*>[\s\S]*?<\/header>/g)?.join()).not.toMatch(/Start recipe task|Set as baseline/);
    expect(ModelAction.mock.lastCall?.[0]).toMatchObject({
      resourceKey: modelKey, resource: { catalog, model, schema: "v2", localPath: "/weights/qwen", servedName: "qwen-inference" },
    });
    expect(RecipeAction.mock.lastCall?.[0]).toMatchObject({
      resourceType: "catalog-variant",
      resourceKey: JSON.stringify([catalog, model.name, variant.id, variant.version, variant.digest]),
      resource: { catalog, model, schema: "v2", variant },
    });

    showRecipeActions = false;
    expect(render(detailPath, enabled)).toMatch(/<footer\b[^>]*empty:hidden[^>]*><\/footer>/);
  });
});
