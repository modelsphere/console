import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployForm } from "./DeployForm";
import { EMPTY, planRequest, type Form } from "@swiss/components/DeploySettings";
import type { RouteOptions } from "@/modules/inferences/route-options";

const catalog: RouteOptions = {
  route: "model",
  directives: [],
  advanced: [{ key: "rt_limit_factor", label: "Runtime limit factor", group: "Capacity & failover", kind: "number", fallback: "7.25", detail: "Scales the pool limit.", needsAdaptive: false, value: 9, set: true }],
};

function render(routeOptions?: RouteOptions, upgrade = false, form: Form = { ...EMPTY, serviceId: "model", nginxExtras: [{ key: "rt_limit_factor", value: "" }] }, catalogRoute?: string) {
  const props = {
    form, upgrade,
    onChange: () => {}, submitted: false, target: null, defaults: {}, gpuOptions: [],
    expanded: { basic: false, resources: false, routing: true, advanced: false },
    onExpand: () => {}, idPrefix: "test-", routeOptions, catalogRoute,
  };
  return renderToStaticMarkup(<DeployForm {...props} />);
}

describe("deploy route catalog", () => {
  it("shows the running engine's default instead of the bundled default", () => {
    expect(render(catalog).includes('placeholder="7.25"')).toBe(true);
  });

  it("does not show stale bundled defaults without a live catalog", () => {
    expect(render().includes('placeholder="1"')).toBe(false);
    expect(render().includes("0.4")).toBe(false);
  });

  it("does not show another route's runtime values on a new deployment or an unmatched upgrade", () => {
    expect(render(catalog).includes("当前：9")).toBe(false);
    expect(render({ ...catalog, route: "another" }, true).includes("当前：9")).toBe(false);
    expect(render(catalog, true).includes("当前：9")).toBe(true);
    expect(render(catalog, true).includes("路由配置")).toBe(true);
  });

  it("shows runtime state for a release fallback when the old plan has no explicit route identity", () => {
    const legacyForm = { ...EMPTY, nginxExtras: [{ key: "rt_limit_factor", value: "" }] };
    expect(render(catalog, true, legacyForm, "model").includes("当前：9")).toBe(true);
    expect(render(catalog, true, legacyForm, "another").includes("当前：9")).toBe(false);
    expect(render(catalog, false, legacyForm, "model").includes("当前：9")).toBe(false);
  });

  it("renders new engine directives without a console release and leaves advanced defaults out of the default view", () => {
    const live: RouteOptions = { ...catalog, directives: [{ key: "future_knob", label: "New engine knob", group: "New engine group", kind: "text", fallback: "dynamic default", detail: "New engine help", value: "current", set: false }] };
    const html = render(live);
    expect(html.includes("New engine knob")).toBe(true);
    expect(html.includes("New engine help")).toBe(true);
    expect(html.includes('placeholder="dynamic default"')).toBe(true);
    expect(html.includes("New engine group")).toBe(true);
    const emptyForm = { ...EMPTY, serviceId: "model" };
    expect(render(live, false, emptyForm).includes('placeholder="7.25"')).toBe(false);
  });

  it("uses host defaults for named fields and does not mutate stored overrides when showing runtime state", () => {
    const form = { ...EMPTY, serviceId: "model", route: "model", nginxExtras: [{ key: "rt_limit_factor", value: "2" }] };
    const before = planRequest(form, { model: "model" });
    const live: RouteOptions = { ...catalog, directives: [
      { key: "tps_limit_tps", label: "TPS", group: "Thresholds", kind: "number", fallback: "73", detail: "Engine threshold help", value: 81, set: true },
      { key: "adaptive_cc_min_frac", label: "Floor fraction", group: "Adaptive concurrency", kind: "number", fallback: "0.61", detail: "Engine fraction help", value: 0.61, set: false },
    ] };
    const html = render(live, true, form);
    expect(html.includes('placeholder="73"')).toBe(true);
    expect(html.includes('placeholder="0.61"')).toBe(true);
    expect(html.includes('value="2"')).toBe(true);
    expect(html.includes("当前：81")).toBe(true);
    expect(html.includes("引擎默认值或派生值")).toBe(true);
    expect(planRequest(form, { model: "model" })).toEqual(before);
  });
});
