import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModuleProvider } from "@/shell";
import { setLocale } from "@/shell/i18n";
import { DeploySheet } from "@/modules/inferences/components/DeploySheet";
import { api, deployApi, type Plan, type PlanRequest, type ModelResponse, type GPUSpec } from "@swiss/lib/api";
import { mergeValues, parseValues, valuesYaml } from "@/modules/inferences/override-yaml";
import "@/index.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "upgrade";
const initialView = new URLSearchParams(location.search).get("view") === "form" ? "form" : "yaml";
const gpuSpecifications: GPUSpec[] = [{ vendor: "nvidia", resource: "example.com/gpu", labelKey: "example.com/model", products: [{ product: "H100", values: ["h100"] }, { product: "H800", values: ["h800"] }, { product: "L40", values: ["l40"] }] }];
const gpuAffinity = (product: string | string[]) => ({ nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: "example.com/model", operator: "In", values: Array.isArray(product) ? product : [product] }] }] }, preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 10, preference: { matchExpressions: [{ key: "region", operator: "In", values: ["local"] }] } }] } });
const defaults = { replicaCount: 1, image: { repository: "registry/engine", tag: "target" }, scaler: { enabled: false }, cart: { enabled: true }, modelRoute: { enabled: true }, cache: { enabled: false } };
let revision = 7;
let failPreview = false;
let planCount = 0;
const requests: PlanRequest[] = [];
const saved: Plan = {
  apiVersion: "plan.swiss/v1", release: { name: "example", namespace: "models" },
  source: { catalogName: "local", model: "weights", variant: "default", version: "1", hf: "fixture/weights", schema: "v2" },
  chart: { name: "sglang", version: "0.9.32" }, engine: "sglang", profile: "local", hash: "saved",
  layers: {
    catalog: { image: { repository: "registry/engine", tag: "target" } },
    site: { customSite: "keep" },
    form: { serviceId: "example", ...(scenario === "gpu" ? { affinity: gpuAffinity("h100") } : {}), ...(scenario === "autoscale" ? { pd: { enabled: true, colocate: false }, sloRequirement: { enabled: true } } : {}), replicaCount: 2, scaler: { enabled: false }, cart: { enabled: true }, modelRoute: { enabled: true }, custom: { keep: "unmapped" } },
    edit: { image: { tag: "saved" } },
    ...(scenario === "gpu" ? { derived: { model: { gpuResource: "example.com/gpu" } } } : {}),
    ...(scenario === "canary" ? { "canary-system": { scaler: { enabled: false } } } : {}),
    ...(scenario === "autoscale" ? { autoscale: { replicaCount: 4 } } : {}),
  },
};
const model: ModelResponse = {
  ref: "local", schema: "v2",
  model: { name: "weights", displayName: "Example", source: { hf: "fixture/weights" }, defaultVariant: "default", variants: [{ id: "default", version: "1", digest: "fixture", engine: "sglang", chart: saved.chart, requires: { gpus: scenario === "gpu" ? 1 : 0, gpuProduct: scenario === "gpu" ? ["H100", "H800"] : undefined } }] },
  variant: { id: "default", version: "1", digest: "fixture", engine: "sglang", servedName: "weights", chart: saved.chart, requires: { gpus: scenario === "gpu" ? 1 : 0, gpuProduct: scenario === "gpu" ? ["H100", "H800"] : undefined }, values: defaults },
};

function compose(request: PlanRequest): Plan {
  requests.push(structuredClone(request));
  if (request.gpuProducts?.includes("L40") && !request.forceGpuProducts) throw new Error("Fixture: unverified GPU selection was not accepted explicitly");
  const hasForm = Object.keys(request.overrides ?? {}).length > 0;
  const form = mergeValues(request.fromRelease ? saved.layers.form : {}, request.overrides ?? {});
  if (request.serviceId) form.serviceId = request.serviceId;
  if (request.localPath) form.model = mergeValues((form.model as Record<string, unknown>) ?? {}, { localPath: request.localPath });
  if (request.gpuProducts?.length) form.affinity = mergeValues((form.affinity as Record<string, unknown>) ?? {}, gpuAffinity(request.gpuProducts.map((product) => product.toLowerCase())));
  if ((form.scaler as { enabled?: boolean })?.enabled) delete form.replicaCount;
  const layers: Plan["layers"] = {
    catalog: saved.layers.catalog, site: saved.layers.site, form,
    edit: request.fromRelease && !hasForm ? saved.layers.edit : parseValues(request.editsYAML ?? ""),
    ...(scenario === "gpu" ? { derived: { model: { gpuResource: request.gpuResource || "example.com/gpu" }, ...(!request.gpuProducts?.length ? { affinity: gpuAffinity(["h100", "h800"]) } : {}) } } : {}),
  };
  const pd = (mergeValues(form, layers.edit).pd as { enabled?: boolean; colocate?: boolean });
  if (request.fromRelease && scenario === "autoscale" && pd?.enabled && !pd.colocate && (form.sloRequirement as { enabled?: boolean })?.enabled) layers.autoscale = saved.layers.autoscale;

  return { ...saved, layers, hash: `fixture-${++planCount}`, release: { name: request.release || "example", namespace: request.namespace || "models" } };
}

api.cluster = async () => ({ name: "local", profile: "local", catalog: "local", catalogs: [{ name: "local", source: "local", url: "local" }], namespace: "models", version: "fixture", allowDeploy: true });
api.nodes = async () => ({ cluster: "local", summary: { nodes: 2, gpus: 16, gpusUsed: 0 }, nodes: scenario === "gpu" ? ["H100", "H800", "L40"].map((product) => ({ Name: product, GPUProduct: product, GPUResource: "example.com/gpu", GPUs: 8, Schedulable: true, Ready: true, gpusFree: 8, gpusUsed: 0 })) : [] });
api.profile = async () => ({ profile: { defaults: { features: { scaler: false, cart: true } }, nodes: { gpus: gpuSpecifications } } }) as Awaited<ReturnType<typeof api.profile>>;
api.releasePlan = async () => structuredClone(saved);
api.catalog = async () => ({ name: "local", ref: "local", source: "local", schema: "v2", models: [model.model] });
api.model = async () => structuredClone(model);
api.history = async () => ({ ref: "local", schema: "v2", model: "weights", variant: "default", revisions: [{ version: "1", digest: "fixture" }] });
api.status = async () => ({ exists: true, revision, backend: "helm" }) as Awaited<ReturnType<typeof api.status>>;
api.revisionValues = async () => ({ namespace: "models", release: "example", revision, all: "replicaCount: 2\nimage:\n  tag: running\n", supplied: "replicaCount: 2\n" });
deployApi.plan = async (request) => compose(request);
deployApi.helmValues = async (request) => {
  if (failPreview) throw new Error("Fixture: chart values unavailable");
  const plan = compose(request);
  const merged = Object.values(plan.layers).reduce((values, layer) => mergeValues(values, layer), {});
  return { defaults: valuesYaml(defaults), overrides: valuesYaml(merged) };
};
deployApi.diff = async (request) => ({ planHash: "planHash" in request ? request.planHash : "", changed: true, output: "+ replicaCount: edited\n", revision, exists: true });
deployApi.apply = async () => { throw new Error("Fixture never applies deployments"); };
deployApi.install = async () => { throw new Error("Fixture never installs deployments"); };
window.fetch = async (input) => {
  if (String(input).includes("/api/llm/route-options")) return new Response(null, { status: 404 });
  throw new Error(`Fixture blocked unexpected network access: ${String(input)}`);
};
Object.assign(window, {
  deploymentFixture: {
    advanceRevision: () => ++revision,
    failPreview: (fail: boolean) => { failPreview = fail; },
    requests: () => structuredClone(requests),
  },
});
setLocale("zh-CN");

function Fixture() {
  const [open, setOpen] = useState(true);
  return <main className="p-8"><h1>Local deployment configuration fixture</h1><button onClick={() => setOpen(true)}>Reopen</button><DeploySheet target={open ? (scenario === "create" ? { kind: "deploy", model: "weights", catalog: "local" } : { kind: "upgrade", namespace: "models", release: "example" }) : null} initialView={initialView} onClose={() => setOpen(false)} /></main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ModuleProvider module={{ id: "inferences", title: "推理服务", basePath: "/inferences", pages: [] }}><Fixture /></ModuleProvider></MemoryRouter></QueryClientProvider></StrictMode>);
