import { effectiveArmValues } from "./values";
// Synthetic development data only. Production calculations live in canaryd.
import type {
  ArmDraft,
  Economics,
  LLMCanary,
  MetricSummary,
  PricingTable,
  ValuationView,
} from "../types";

export function freezeFixtureEconomics(
  canary: LLMCanary,
  drafts: ArmDraft[],
  table: PricingTable,
): Economics {
  return {
    revision: 1,
    pricingRevision: table.revision,
    currency: table.currency,
    frozenAt: new Date().toISOString(),
    frozenBy: "fixture",
    arms: Object.fromEntries(
      canary.spec.arms.map((arm) => {
        const values = effectiveArmValues(arm);
        const draft = drafts.find((a) => a.name === arm.name);
        const model =
          draft?.source?.model ??
          String(
            (values.model as Record<string, unknown> | undefined)?.name ??
              "",
          );
        const key = draft?.pricingKey || model;
        if (draft?.pricingKey && !table.models[key])
          throw new Error(`Unknown pricing key ${key}`);
        const exact = table.models[key];
        const gpus = Number(
          (values.model as Record<string, unknown> | undefined)?.gpus,
        );
        const lws = values.lws as Record<string, unknown> | undefined;
        const capacity =
          gpus *
          Number(values.replicaCount ?? 1) *
          Number(lws?.enabled ? lws.size : 1);
        const gpuCount =
          draft?.gpuCount ??
          (Number.isInteger(capacity) && capacity >= 0 ? capacity : null);
        return [
          arm.name,
          {
            model,
            pricingKey: exact ? key : "__default__",
            resolution: exact ? "exact" : "default",
            prices: structuredClone(exact ?? table.default),
            gpuCount,
            gpuSource: draft?.gpuCount
              ? "manual"
              : gpuCount === null
                ? "unknown"
                : "helm-values",
          },
        ];
      }),
    ),
  };
}
export function fixtureValue(
  summary: MetricSummary,
  economics: Economics | undefined,
  name: string,
  view: ValuationView,
): MetricSummary {
  const out = { ...summary };
  const arm = economics?.arms[name];
  const rates = arm?.prices[view.currency ?? economics?.currency ?? "USD"];
  if (out.inputTPM != null && out.cachedTPM != null)
    out.uncachedTPM = Math.max(0, out.inputTPM - out.cachedTPM);
  if (
    rates &&
    out.uncachedTPM != null &&
    out.cachedTPM != null &&
    out.outputTPM != null
  ) {
    out.revenueInputPerMinute = (out.uncachedTPM * rates.inputPerMillion) / 1e6;
    out.revenueCachedPerMinute = (out.cachedTPM * rates.cachedPerMillion) / 1e6;
    out.revenueOutputPerMinute = (out.outputTPM * rates.outputPerMillion) / 1e6;
    out.revenuePerMinute =
      out.revenueInputPerMinute +
      out.revenueCachedPerMinute +
      out.revenueOutputPerMinute;
    out.revenuePerHour = out.revenuePerMinute * 60;
  }
  if (view.normalization !== "raw") {
    const factor = arm?.gpuCount
      ? (view.normalization === "as-if" ? (view.targetGPUs ?? 1) : 1) /
        arm.gpuCount
      : null;
    for (const key of [
      "inputTPM",
      "cachedTPM",
      "uncachedTPM",
      "outputTPM",
      "totalTPM",
      "revenueInputPerMinute",
      "revenueCachedPerMinute",
      "revenueOutputPerMinute",
      "revenuePerMinute",
      "revenuePerHour",
    ] as const)
      out[key] =
        factor === null || out[key] === null ? null : out[key]! * factor;
  }
  return out;
}
