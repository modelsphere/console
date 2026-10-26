import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "yaml";
import { upgradeEditsYAML } from "./upgrade-values";
import { EMPTY, planRequest } from "@swiss/components/DeploySettings";
import type { Plan, PlanRequest } from "@swiss/lib/api";
import { AdaptivePlanChangedError, composeAdaptivePlan, isAdaptiveOption, toggleAdaptive, withAdaptiveConcurrency } from "./adaptive-concurrency";
import { DeployForm } from "./components/DeployForm";
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

  it.each([false, true])("keeps upgrade YAML minimal through adaptive cleanup (edited: %s)", async (edited) => {
    const baseline = "image: {tag: old}\nresources: {limits: {cpu: '4'}}\nmodelRoute: {nginx: {values: {adaptive_cc: 'true', adaptive_cc_min: '80'}}}\n";
    const upgradeForm = { ...form, adaptiveCc: false, edits: baseline.replace("cpu: '4'", edited ? "cpu: '6'" : "cpu: '4'") };
    const edits = upgradeEditsYAML(baseline, upgradeForm.edits, { custom: "retained" });
    const upgradeRequest = planRequest({ ...upgradeForm, edits }, { model: "weights", fromRelease: "model" });
    const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockImplementation(async (req) => ({
      ...validated, hash: compose.mock.calls.length === 1 ? "proposed" : "cleaned",
      layers: { form: compose.mock.calls.length === 1 ? validated.layers.form : req.overrides!, edit: parse(req.editsYAML!) },
    }));

    const result = await composeAdaptivePlan(upgradeRequest, upgradeForm, options, compose, "private");

    expect(compose).toHaveBeenCalledTimes(2);
    for (const [req] of compose.mock.calls) {
      expect(parse(req.editsYAML!)).toEqual(edited ? { custom: "retained", resources: { limits: { cpu: "6" } } } : { custom: "retained" });
    }
    expect(valuesOf(compose.mock.calls[1][0])).toEqual({ adaptive_cc: "false", default_max: "42", future_nonadaptive: "keep" });
    expect(result.hash).toBe("cleaned");
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
