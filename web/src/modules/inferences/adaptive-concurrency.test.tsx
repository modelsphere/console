import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY, planRequest } from "@swiss/components/DeploySettings";
import type { Plan, PlanRequest } from "@swiss/lib/api";
import { AdaptivePlanChangedError, composeAdaptivePlan, composeReferencedPlan, isAdaptiveOption, toggleAdaptive, withAdaptiveConcurrency } from "./adaptive-concurrency";
import { DeployForm } from "./components/DeployForm";
import { RecoveryFields } from "./components/RecoveryFields";
import { recoverySettings } from "./recovery";
import type { RouteDirective, RouteOptions } from "./routeOptions";

const directive = (key: string, needsAdaptive: boolean, group = "Adaptive concurrency"): RouteDirective => ({ key, label: key, group, needsAdaptive, kind: "number", detail: "help", fallback: "", value: null, set: false });
const options: RouteOptions = {
  route: "model",
  directives: [directive("adaptive_cc_min", true), directive("adaptive_cc_init", true), directive("learned_limit", true), directive("default_max", false, "Capacity & failover")],
  advanced: [directive("adaptive_cc_ttl", true), directive("rt_limit_factor", false, "Capacity & failover")],
};
const form = { ...EMPTY, serviceId: "model", adaptiveCcMinFrac: "0.6", nginxExtras: [
  { key: "adaptive_cc_min", value: "80" }, { key: "adaptive_cc_ttl", value: "60" }, { key: "learned_limit", value: "99" }, { key: "default_max", value: "42" }, { key: "rt_limit_factor", value: "2" },
] };
const validated: Plan = {
  apiVersion: "plan.swiss/v1", release: { name: "model", namespace: "models" },
  source: { catalog: "https://catalog.example.com", catalogName: "private", model: "weights", variant: "gpu", version: "1.0.0", hf: "example/weights", digest: "sha256:version" },
  chart: { name: "vllm", version: "0.8.20" }, engine: "vllm", profile: "site", hash: "validated",
  layers: { form: { schedulerName: "custom-scheduler", image: { repository: "example/engine", tag: "custom" }, modelRoute: { nginx: { values: { adaptive_cc: "false", adaptive_cc_min_frac: "0.6", adaptive_cc_min: "80", learned_limit: "99", default_max: "42", future_nonadaptive: "keep" } } } } },
};
const valuesOf = (request: PlanRequest) => ((request.overrides?.modelRoute as { nginx: { values: Record<string, unknown> } }).nginx.values);
const request: PlanRequest = { ...planRequest({ ...form, adaptiveCc: false }, { model: "weights", fromRelease: "model" }), editsYAML: "custom: retained\n" };
const render = (adaptiveCc: boolean) => renderToStaticMarkup(<DeployForm form={{ ...form, adaptiveCc }} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={{ basic: false, resources: false, routing: true, advanced: false }} onExpand={() => {}} idPrefix="test-" routeOptions={options} />);

describe("unified adaptive concurrency settings", () => {
  it("classifies future gateway options by needsAdaptive and keeps default_max independent", () => {
    expect(isAdaptiveOption("learned_limit", options)).toBe(true);
    expect(isAdaptiveOption("default_max", options)).toBe(false);
    expect(isAdaptiveOption("adaptive_cc_future", undefined)).toBe(true);
  });

  it("clears common, advanced and dynamically declared adaptive rows on toggle-off", () => {
    const patch = toggleAdaptive(form, false, options);
    expect(patch).toMatchObject({ adaptiveCc: false, adaptiveCcMinFrac: "" });
    expect(patch.nginxExtras).toEqual([{ key: "default_max", value: "42" }, { key: "rt_limit_factor", value: "2" }]);
    expect(form.nginxExtras).toHaveLength(5);
    expect(toggleAdaptive({ ...form, adaptiveCc: false }, true, options).nginxExtras).toEqual(patch.nginxExtras);
  });

  it("shows the master switch and labelled floor fraction with the common parameters", () => {
    const html = render(true);
    expect(html).toContain('aria-label="自适应并发"');
    expect(html).toContain("下限比例");
    expect(html).toContain('aria-label="自适应下限"');
    expect(html).toContain('aria-label="起始并发"');
    expect(html).toContain("高级自适应参数");
  });

  it("hides all dependent inputs when off while capacity and unrelated advanced values remain", () => {
    const html = render(false);
    expect(html).not.toContain('aria-label="自适应下限"');
    expect(html).not.toContain('aria-label="起始并发"');
    expect(html).not.toContain("learned_limit");
    expect(html).not.toContain("adaptive_cc_ttl");
    expect(html).not.toContain("高级自适应参数");
    expect(html).toContain('aria-label="默认节点并发上限"');
    expect(html).toContain('value="42"');
    expect(html).toContain('value="2"');
  });

  it("removes adaptive request values instead of emitting null tombstones or dead values", () => {
    const result = withAdaptiveConcurrency(request, { ...form, adaptiveCc: false }, options);
    expect(valuesOf(result)).toMatchObject({ adaptive_cc: "false", default_max: "42", rt_limit_factor: "2" });
    expect(Object.keys(valuesOf(result)).some((key) => isAdaptiveOption(key, options))).toBe(false);
    expect(result.fromRelease).toBe("model");
  });

  it("retains existing server upgrade validation before cleaning inherited values", async () => {
    const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockImplementation(async (req) => compose.mock.calls.length === 1 ? validated : { ...validated, hash: "cleaned", layers: { form: req.overrides! } });
    const result = await composeAdaptivePlan(request, { ...form, adaptiveCc: false }, options, compose, "private");
    expect(compose).toHaveBeenCalledTimes(2);
    expect(compose.mock.calls[0][0].fromRelease).toBe("model");
    const cleaned = compose.mock.calls[1][0];
    expect(cleaned).toMatchObject({ fromRelease: undefined, release: "model", namespace: "models", catalog: "private", model: "weights", variant: "gpu", version: "1.0.0", chartVersion: "0.8.20", editsYAML: "custom: retained\n" });
    expect(cleaned.overrides).toMatchObject({ schedulerName: "custom-scheduler", image: { repository: "example/engine", tag: "custom" } });
    expect(valuesOf(cleaned)).toEqual({ adaptive_cc: "false", default_max: "42", future_nonadaptive: "keep" });
    expect(result.hash).toBe("cleaned");
    expect((validated.layers.form.modelRoute as { nginx: { values: object } }).nginx.values).toHaveProperty("adaptive_cc_min");
  });

  it("never bypasses a server rejection of the initial upgrade", async () => {
    const compose = vi.fn().mockRejectedValue(new Error("cross-catalog model mismatch"));
    await expect(composeAdaptivePlan(request, { ...form, adaptiveCc: false }, options, compose)).rejects.toThrow("cross-catalog model mismatch");
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it.each(["changed source", "uncleared values", "changed site"])("refuses an unsafe second plan: %s", async (failure) => {
    const cleanForm = withAdaptiveConcurrency(request, { ...form, adaptiveCc: false }, options, validated, "private").overrides!;
    const second = failure === "changed source" ? { ...validated, source: { ...validated.source, digest: "different" }, layers: { form: cleanForm } } : failure === "changed site" ? { ...validated, layers: { form: cleanForm, site: { changed: true } } } : validated;
    const compose = vi.fn().mockResolvedValueOnce(validated).mockResolvedValueOnce(second);
    await expect(composeAdaptivePlan(request, { ...form, adaptiveCc: false }, options, compose)).rejects.toBeInstanceOf(AdaptivePlanChangedError);
  });

  it("does not recompose when no dependent stored settings need clearing", async () => {
    const clean = { ...validated, layers: { form: { modelRoute: { nginx: { values: { adaptive_cc: "false", default_max: "42" } } } } } };
    const compose = vi.fn().mockResolvedValue(clean);
    expect(await composeAdaptivePlan(request, { ...form, adaptiveCc: false }, options, compose)).toBe(clean);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("keeps enabled adaptive settings and the original request intact", async () => {
    const active = planRequest(form, { model: "weights", fromRelease: "model" });
    expect(withAdaptiveConcurrency(active, form, options)).toBe(active);
    const compose = vi.fn().mockResolvedValue(validated);
    await composeAdaptivePlan(active, form, options, compose);
    expect(compose).toHaveBeenCalledTimes(1);
  });
});

 describe("assigned experiment arm upgrade", () => {
 it("disables every section except adaptive concurrency", () => {
 const html = renderToStaticMarkup(<DeployForm form={form} adaptiveOnly upgrade onChange={() => {}} submitted={false} target={<input aria-label="version" />} defaults={{}} gpuOptions={[]} expanded={{ basic: true, resources: true, routing: true, advanced: true }} onExpand={() => {}} idPrefix="assigned-" routeOptions={options} />);
 expect(html.match(/<fieldset disabled=""/g)).toHaveLength(5);
 const adaptive = html.indexOf('aria-label="自适应并发"');
 expect(adaptive).toBeGreaterThan(0);
 expect(html.lastIndexOf("</fieldset>", adaptive)).toBeGreaterThan(html.lastIndexOf("<fieldset", adaptive));
 expect(html).toContain("覆盖 YAML");
 const switches = html.match(/<[^>]*role="switch"[^>]*>/g) ?? [];
 expect(switches.length).toBeGreaterThan(3);
 for (const control of switches) {
  if (control.includes('aria-label="自适应并发"')) expect(control).not.toMatch(/aria-disabled="true"|\sdata-disabled=""/);
  else expect(control).toMatch(/aria-disabled="true"|\sdata-disabled=""/);
 }
 });
 });


describe("referenced service UI protection", () => {
 it("uses general live-plan composition and clears old dependent options", async () => {
  const live = { ...validated, layers: { form: { modelRoute: { nginx: { values: { adaptive_cc: "true", adaptive_cc_ttl: "60", default_max: "42" } } } } } };
  const updated = { ...live, layers: { form: { modelRoute: { nginx: { values: { adaptive_cc: "false", adaptive_cc_ttl: null, default_max: "42" } } } } } };
  const compose = vi.fn().mockResolvedValue(updated);
  expect(await composeReferencedPlan(live, { ...form, adaptiveCc: false }, options, compose)).toBe(updated);
  expect(compose).toHaveBeenCalledWith({ reuseSource: true, fromRelease: live.release.name, namespace: live.release.namespace, overrides: { modelRoute: { nginx: { values: { adaptive_cc: "false", adaptive_cc_ttl: null } } } } });
 });
 it("allows the adaptive form layer to be created without other changes", async () => {
  const live = { ...validated, layers: {} };
  const updated = { ...live, layers: { form: { modelRoute: { nginx: { values: { adaptive_cc: "true" } } } } } };
  expect(await composeReferencedPlan(live, { ...form, adaptiveCc: true }, options, vi.fn().mockResolvedValue(updated))).toBe(updated);
 });
 it.each([
  { continuationGateway: { enabled: true } },
  { storageKVOffload: { mooncake: { master: "changed.svc:50051" } } },
  { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {} } } },
 ])("rejects non-adaptive drift introduced by newer deployment settings: %j", async (changes) => {
  const changed = { ...validated, layers: { ...validated.layers, form: { ...validated.layers.form, ...changes } } };
  await expect(composeReferencedPlan(validated, form, options, vi.fn().mockResolvedValue(changed))).rejects.toBeInstanceOf(AdaptivePlanChangedError);
 });
 it("blocks a returned plan that changes source or ordinary values", async () => {
  const changed = { ...validated, chart: { ...validated.chart, version: "unexpected" } };
  await expect(composeReferencedPlan(validated, form, options, vi.fn().mockResolvedValue(changed))).rejects.toBeInstanceOf(AdaptivePlanChangedError);
 });
});


describe("replica scaling controls", () => {
 it("exposes autoscaling separately from SLO and sends a fixed replica count without YAML edits", () => {
  const fixed = { ...form, slo: false, scaler: false, replicaCount: "2" };
  const html = renderToStaticMarkup(<DeployForm form={fixed} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={{ basic: true, resources: true, routing: false, advanced: false }} onExpand={() => {}} idPrefix="fixed-" />);
  expect(html).toContain('aria-label="自动伸缩"');
  expect(html).toContain('aria-label="副本数"');
  expect(html).not.toContain('aria-label="最少副本"');
  expect(planRequest(fixed, { model: "weights" }).overrides).toMatchObject({ scaler: { enabled: false }, replicaCount: 2, sloRequirement: { enabled: false } });
  expect(planRequest({ ...fixed, scaler: true }, { model: "weights" }).overrides).toMatchObject({ scaler: { enabled: true }, sloRequirement: { enabled: false } });
 });
 it("shows scaler bounds when enabled and locks them for assigned experiment arms", () => {
  const html = renderToStaticMarkup(<DeployForm form={{ ...form, scaler: true }} adaptiveOnly upgrade onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={{ basic: true, resources: true, routing: false, advanced: false }} onExpand={() => {}} idPrefix="scaled-" />);
  expect(html).toContain('aria-label="最少副本"');
  expect(html).toContain('aria-label="最多副本"');
  const scaler = html.match(/<[^>]*role="switch"[^>]*aria-label="自动伸缩"[^>]*>/)?.[0];
  expect(scaler).toMatch(/aria-disabled="true"|\sdata-disabled=""/);
 });
});


describe("referenced arm recovery controls", () => {
 it("locks recovery switches while leaving adaptive concurrency editable", () => {
  const html = renderToStaticMarkup(<DeployForm form={form} adaptiveOnly upgrade onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={{ basic: false, resources: false, routing: true, advanced: false }} onExpand={() => {}} idPrefix="recovery-" routeOptions={options} recovery={<RecoveryFields disabled settings={{ ...recoverySettings(), enabled: true }} onChange={() => {}} />} />);
  expect(html).toContain("生成中断恢复");
  const switches = html.match(/<[^>]*role="switch"[^>]*>/g) ?? [];
  expect(switches.some(control => control.includes('aria-label="生成中断恢复"'))).toBe(true);
  for (const control of switches) {
   if (control.includes('aria-label="自适应并发"')) expect(control).not.toMatch(/aria-disabled="true"|\sdata-disabled=""/);
   else expect(control).toMatch(/aria-disabled="true"|\sdata-disabled=""/);
  }
 });
});
