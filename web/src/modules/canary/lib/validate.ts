import type { CanaryDraft, LLMCanary } from "../types";
import { CANARY_API_VERSION } from "./kubernetes";
import {
  armNameOk,
  dnsLabel,
  isExactChartVersion,
  stripOperatorOwned,
} from "./values";

export interface ValidationIssue {
  path: string;
  message: string;
}

const CHART_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
/** CRD: spec.route.path pattern `^/.+` (longer than the fallback "/"). */
const ROUTE_PATH = /^\/.+/;

export const WIZARD_STEPS = [
  "target",
  "arms",
  "traffic",
  "route",
  "review",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

function weightIssues(production: number, canary: number): ValidationIssue[] {
  if (
    !Number.isInteger(production) ||
    !Number.isInteger(canary) ||
    production < 0 ||
    canary < 0
  ) {
    return [{ path: "spec.traffic", message: "weights must be integers >= 0" }];
  }
  if (production + canary <= 0) {
    return [
      { path: "spec.traffic", message: "production + canary must be > 0" },
    ];
  }
  return [];
}

export function validateCanary(cr: LLMCanary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { metadata, spec } = cr;

  if (cr.apiVersion !== CANARY_API_VERSION)
    issues.push({
      path: "apiVersion",
      message: `must be ${CANARY_API_VERSION}`,
    });

  if (!dnsLabel(metadata.name))
    issues.push({ path: "metadata.name", message: "must be a DNS label" });
  if (!dnsLabel(metadata.namespace))
    issues.push({ path: "metadata.namespace", message: "must be a DNS label" });

  if (!spec.targetRef.kind)
    issues.push({ path: "spec.targetRef.kind", message: "required" });
  if (!spec.targetRef.name)
    issues.push({ path: "spec.targetRef.name", message: "required" });
  if (spec.targetRef.namespace && !dnsLabel(spec.targetRef.namespace)) {
    issues.push({
      path: "spec.targetRef.namespace",
      message: "must be a DNS label",
    });
  }

  if (!spec.arms.length)
    issues.push({ path: "spec.arms", message: "at least one arm is required" });
  const names = new Set<string>();
  spec.arms.forEach((arm, i) => {
    const p = `spec.arms[${i}]`;
    if (!armNameOk(arm.name))
      issues.push({ path: `${p}.name`, message: "1–20 chars, DNS label" });
    if (names.has(arm.name))
      issues.push({
        path: `${p}.name`,
        message: `duplicate arm name "${arm.name}"`,
      });
    names.add(arm.name);
    if (!CHART_NAME.test(arm.chart.name))
      issues.push({ path: `${p}.chart.name`, message: "must be a chart name" });
    if (!isExactChartVersion(arm.chart.version)) {
      issues.push({
        path: `${p}.chart.version`,
        message: "must be an exact version, not a range",
      });
    }
    const { removed } = stripOperatorOwned(arm.values);
    if (removed.length) {
      issues.push({
        path: `${p}.values`,
        message: `must not set ${removed.join(", ")} on the CR (managed by the operator)`,
      });
    }
  });

  issues.push(...weightIssues(spec.traffic.production, spec.traffic.canary));

  if (!spec.gateway.name.trim())
    issues.push({ path: "spec.gateway.name", message: "required" });
  if (!spec.gateway.namespace.trim() || !dnsLabel(spec.gateway.namespace)) {
    issues.push({
      path: "spec.gateway.namespace",
      message: "required DNS label",
    });
  }

  if (
    !spec.route.productionOpenrestyService ||
    !dnsLabel(spec.route.productionOpenrestyService)
  ) {
    issues.push({
      path: "spec.route.productionOpenrestyService",
      message: "required DNS label",
    });
  }
  if (spec.route.path !== undefined && !ROUTE_PATH.test(spec.route.path)) {
    issues.push({ path: "spec.route.path", message: "must match ^/.+" });
  }
  if (spec.route.servicePort !== undefined) {
    const port = spec.route.servicePort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push({
        path: "spec.route.servicePort",
        message: "must be a port from 1 to 65535",
      });
    }
  }
  if (spec.route.forceHeader) {
    if (!HEADER_NAME.test(spec.route.forceHeader.name)) {
      issues.push({
        path: "spec.route.forceHeader.name",
        message: "invalid header name",
      });
    }
    if (!spec.route.forceHeader.value) {
      issues.push({
        path: "spec.route.forceHeader.value",
        message: "required",
      });
    }
  }

  if (spec.proxy?.mode === "Shared") {
    issues.push({
      path: "spec.proxy.mode",
      message: "Shared is not supported; use PerArm",
    });
  }
  if (spec.proxy?.mode !== "Shared" && spec.proxy?.sessionAffinity) {
    issues.push({
      path: "spec.proxy.sessionAffinity",
      message: "not available in PerArm mode",
    });
  }

  return issues;
}

export function validateDraft(
  draft: CanaryDraft,
  canary: LLMCanary,
): ValidationIssue[] {
  const issues = validateCanary(canary);
  if (!draft.route.path || !ROUTE_PATH.test(draft.route.path)) {
    if (!issues.some((issue) => issue.path === "spec.route.path")) {
      issues.push({
        path: "spec.route.path",
        message: "required; must match ^/.+",
      });
    }
  }
  const header = draft.route.forceHeader;
  if ((header.name && !header.value) || (!header.name && header.value)) {
    issues.push({
      path: "spec.route.forceHeader",
      message: "name and value are both required",
    });
  }
  return issues;
}

/** Whether the linear wizard may leave this step. Review has no Next. */
export function wizardStepComplete(
  step: WizardStep,
  draft: CanaryDraft,
): boolean {
  switch (step) {
    case "target":
      return (
        dnsLabel(draft.name) &&
        dnsLabel(draft.namespace) &&
        draft.targetRef.kind.trim().length > 0 &&
        draft.targetRef.name.trim().length > 0 &&
        (!draft.targetRef.namespace || dnsLabel(draft.targetRef.namespace))
      );
    case "arms":
      return (
        draft.arms.length > 0 &&
        draft.arms.every(
          (arm) =>
            armNameOk(arm.name) &&
            CHART_NAME.test(arm.chart.name) &&
            isExactChartVersion(arm.chart.version),
        )
      );
    case "traffic":
      return (
        weightIssues(draft.traffic.production, draft.traffic.canary).length ===
        0
      );
    case "route":
      return (
        draft.gateway.name.trim().length > 0 &&
        dnsLabel(draft.gateway.namespace) &&
        ROUTE_PATH.test(draft.route.path ?? "") &&
        dnsLabel(draft.route.productionOpenrestyService)
      );
    case "review":
      return false;
    default:
      return false;
  }
}
