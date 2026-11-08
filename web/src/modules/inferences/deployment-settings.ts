import { EMPTY as SWISS_EMPTY, formFromPlan as swissFormFromPlan, planRequest as swissPlanRequest, type Form } from "@swiss/components/DeploySettings";
import type { GPUSpec, Plan, SiteProfile } from "@swiss/lib/api";
import { presetValues } from "@swiss/lib/formLayer";

// The site's monitor ConfigMap (modelRoute.monitor.outputConfigMap) turns Monitor on in the form layer.
// An unknown profile (unread, unparsed) decides nothing: an upgrade keeps its plan's Monitor.
export const monitorOn = (profile: SiteProfile) => !!profile.route?.monitorConfigMap?.trim();

function monitorSettings(form: Form, on: boolean): Form {
  return on ? { ...form, monitor: true } : { ...form, monitor: false, monitorModel: "", monitorGpuType: "" };
}

export const EMPTY: Form = monitorSettings(SWISS_EMPTY, false);

// Keeps the plan's monitor model and GPU type; planRequest decides whether they are sent.
export const formFromPlan = (plan: Pick<Plan, "release" | "layers">, gpuSpecs?: GPUSpec[]): Form => swissFormFromPlan(plan, gpuSpecs);

export const planRequest = (form: Form, options: Parameters<typeof swissPlanRequest>[1], profile?: SiteProfile) =>
  swissPlanRequest(profile ? monitorSettings(form, monitorOn(profile)) : form, {
    ...options,
    gpuSpecs: profile?.nodes?.gpus ?? options.gpuSpecs,
    preset: presetValues(profile, form.preset),
    siteEnv: profile?.extra ?? options.siteEnv,
  });
