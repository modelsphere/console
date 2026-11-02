import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plan, SiteProfile } from "@swiss/lib/api";
import { EMPTY as SWISS_EMPTY } from "@swiss/components/DeploySettings";
import { EMPTY, formFromPlan, planRequest } from "./deployment-settings";
import { DeployForm } from "./components/DeployForm";
import { ProfileForm } from "./components/ProfileForm";

const site = (monitorConfigMap?: string): SiteProfile => ({ name: "site", model: { pathTemplate: "/models/{{name}}" }, route: { monitorConfigMap } });

function renderDeploy(form = EMPTY) {
  return renderToStaticMarkup(<DeployForm form={form} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={{ basic: false, resources: false, routing: true, advanced: false }} onExpand={() => {}} idPrefix="test-" />);
}

describe("Monitor", () => {
  it("defaults Monitor off while retaining the independent ServiceMonitor default", () => {
    expect(EMPTY.monitor).toBe(false);
    expect(EMPTY.serviceMonitor).toBe(SWISS_EMPTY.serviceMonitor);
  });

  it("turns Monitor off and drops its inputs when the profile names no monitor ConfigMap", () => {
    const form = { ...SWISS_EMPTY, monitor: true, monitorModel: "unpublished-model", monitorGpuType: "unpublished-gpu" };
    for (const profile of [undefined, site(), site("  ")]) {
      const request = planRequest(form, { model: "model" }, profile);
      expect((request.overrides?.modelRoute as Record<string, unknown>).monitor).toEqual({ enabled: false });
      expect(request.overrides?.serviceMonitor).toEqual({ enabled: true });
    }
    expect(form.monitor).toBe(true);
  });

  it("turns Monitor on in the form layer when the profile names a monitor ConfigMap", () => {
    const request = planRequest({ ...EMPTY, monitorModel: "model", monitorGpuType: "gpu" }, { model: "model" }, site("models/monitor"));
    expect((request.overrides?.modelRoute as Record<string, unknown>).monitor).toEqual({ enabled: true, model: "model", gpuType: "gpu" });
  });

  it("seeds upgrades from the plan and lets the profile decide Monitor, keeping the ServiceMonitor decision", () => {
    const plan = { release: { name: "model", namespace: "models" }, layers: { form: { modelRoute: { monitor: { enabled: false, model: "old", gpuType: "old" } }, serviceMonitor: { enabled: false } } } } as unknown as Plan;
    const form = formFromPlan(plan);
    expect(form).toMatchObject({ serviceMonitor: false });
    expect((planRequest(form, { model: "model" }, site("models/monitor")).overrides?.modelRoute as Record<string, unknown>).monitor).toEqual({ enabled: true, model: "old", gpuType: "old" });
    expect((planRequest(form, { model: "model" }).overrides?.modelRoute as Record<string, unknown>).monitor).toEqual({ enabled: false });
  });

  it("has no Monitor controls in deploy settings but keeps ServiceMonitor", () => {
    const html = renderDeploy({ ...SWISS_EMPTY, monitorModel: "unpublished-model", monitorGpuType: "unpublished-gpu" });
    expect(html).not.toContain('aria-label="监控"');
    expect(html).not.toContain("unpublished-model");
    expect(html).not.toContain("unpublished-gpu");
    expect(html).toContain('aria-label="ServiceMonitor"');
  });

  it("shows the monitor ConfigMap in the site profile beside the nginx route fields", () => {
    const html = renderToStaticMarkup(<ProfileForm value={{ name: "site", model: { pathTemplate: "/models/{{name}}" }, route: { monitorConfigMap: "models/monitor", nginxConfigMap: "models/routes" } }} onChange={() => {}} submitted={false} />);
    expect(html).toContain("models/monitor");
    expect(html).toContain("models/routes");
  });
});
