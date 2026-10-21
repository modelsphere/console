import type { TFunction } from "i18next";
import { errorEn, validationEn } from "../error-locales";

type ErrorKey = Exclude<keyof typeof errorEn, "details">;
type Params = Record<string, string | number>;
export class CanaryApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly params: Params = {},
  ) {
    super(message);
    this.name = "CanaryApiError";
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string")
    return error.replace(/^(?:Error|TypeError):\s*/, "");
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "";
}
const exact: Record<string, ErrorKey> = {
  "invalid canary name (maximum 28 characters)": "invalidName",
  "invalid canary namespace (maximum 63 characters)": "invalidNamespace",
  "invalid canary name (maximum 28 characters) or namespace":
    "invalidNameNamespace",
  "a production helmrelease is required": "targetRequired",
  "two to eight arms are required": "armCount",
  "select two distinct comparison arms": "compareArms",
  "traffic weights must be nonnegative integers": "weights",
  "weights must be integers >= 0": "weights",
  "traffic weights cannot both be zero": "zeroWeights",
  "production + canary must be > 0": "zeroWeights",
  "gateway, production service and subpath are required": "gatewayRequired",
  "gateway and production service must match the deployment configuration":
    "gatewayMismatch",
  "only perarm proxy without session affinity is supported": "proxyMode",
  "route.serviceport must be an integer between 1 and 65535, or zero to use the default":
    "routePort",
  "force header requires a valid header name and non-empty value":
    "forceHeader",
  "route must equal the production deployment path": "routeMismatch",
  "production deployment is unavailable": "targetUnavailable",
  "pricing changed; reload before saving": "pricingChanged",
  "valuation changed; reload before saving": "valuationChanged",
  "each priced currency requires three finite token prices between 0 and 1000000":
    "prices",
  "currency must be usd or cny": "currency",
  "normalization must be raw, per-gpu or as-if": "normalization",
  "as-if normalization requires gpus between 1 and 1024": "gpuRange",
  "duplicate valuation arm": "valuationArm",
  "unknown valuation arm": "valuationArm",
  "frozen arm configuration is unavailable": "frozenUnavailable",
  "end must be after start": "range",
  "name already exists": "nameExists",
  "name already exists; existing cr was left untouched": "nameExists",
  "stop experiment first": "stopFirst",
  "archiving requires a stopped experiment and an archived boolean":
    "stopFirst",
  "prepared plan belongs to another identity": "planIdentity",
  "unrelated existing cr was left untouched": "uidMismatch",
  "same-name cr has a different uid; deletion refused": "uidMismatch",
  "cr uid changed": "uidMismatch",
  "cr has no uid": "uidMismatch",
  "catalog schema v2 is required": "catalogSchema",
  "catalog schema v1 is not supported": "catalogSchema",
  "request must contain one json document": "json",
  "prometheus is not configured": "prometheus",
  "historical minute unavailable": "historicalMinute",
  "prometheus retention expired before collection": "historicalMinute",
  "not found": "notFound",
  "sql: no rows in result set": "notFound",
  "trusted console proxy credential and identity required": "unauthorized",
  "failed to fetch": "network",
  "load failed": "network",
  "networkerror when attempting to fetch resource.": "network",
};
const validation: Record<string, keyof typeof validationEn> = {
  required: "required",
  "must be a DNS label": "dns",
  "required DNS label": "requiredDNS",
  "1–20 chars, DNS label": "armName",
  "must be a chart name": "chartName",
  "must be an exact version, not a range": "exactVersion",
  "at least one arm is required": "oneArm",
  "must match ^/.+": "routePath",
  "required; must match ^/.+": "routePath",
  "must be a port from 1 to 65535": "port",
  "invalid header name": "headerName",
  "name and value are both required": "headerPair",
  "Shared is not supported; use PerArm": "perArm",
  "not available in PerArm mode": "affinity",
};
type Rule = [RegExp, ErrorKey, ...string[]];
const rules: Rule[] = [
  [
    /^namespace ([^;\n]+) is not enabled for experiments$/,
    "namespaceDisabled",
    "namespace",
  ],
  [/^invalid or duplicate arm "(.*)"$/, "invalidArm", "arm"],
  [
    /^arm ([^;\n]+) chart.version must be an exact version$/,
    "exactChart",
    "arm",
  ],
  [
    /^arm ([^;\n]+) requires a pinned catalog source and positive replicas$/,
    "pinnedSource",
    "arm",
  ],
  [/^(traffic\.[\w]+) is required$/, "requiredField", "field"],
  [/^([^;\n]+) must be an object$/, "objectField", "field"],
  [/^([^;\n]+) must be a boolean$/, "booleanField", "field"],
  [/^([^;\n]+) must be a string$/, "stringField", "field"],
  [
    /^([^;\n]+) must not be null; remove the key to use the default$/,
    "nullField",
    "field",
  ],
  [/^arm ([^;\n]+) GPU total must be between 1 and 1024$/, "armGPU", "arm"],
  [/^arm ([^;\n]+) has an invalid pricing key$/, "armPricingKey", "arm"],
  [
    /^arm ([^;\n]+) pricing key "(.*)" is not configured$/,
    "missingPricingKey",
    "arm",
    "key",
  ],
  [/^invalid pricing key "(.*)"$/, "pricingKey", "key"],
  [
    /^pricing key ([^;\n]+) requires at least one currency$/,
    "priceCurrency",
    "key",
  ],
  [/^Unknown pricing key ([^;\n]+)$/, "unknownPricingKey", "key"],
  [
    /^arm ([^;\n]+) requires an exact remotely fetchable chart$/,
    "remoteChart",
    "arm",
  ],
  [
    /^arm ([^;\n]+) never reported in the measurement window$/,
    "armNoData",
    "arm",
  ],
  [
    /^arm ([^;\n]+) reported nothing in the minute ending ([^;\n]+)$/,
    "armMinuteMissing",
    "arm",
    "time",
  ],
];
function translateMessage(
  message: string,
  t: TFunction,
  depth = 0,
): string | null {
  if (depth > 4) return null;
  const normalized = message.toLowerCase();
  const key = Object.hasOwn(exact, normalized) ? exact[normalized] : undefined;
  if (key) return t(`errors.${key}`);
  if (Object.hasOwn(validation, message))
    return t(`validation.${validation[message]}`);
  for (const [pattern, key, ...names] of rules) {
    const match = pattern.exec(message);
    if (match)
      return t(
        `errors.${key}`,
        Object.fromEntries(names.map((name, i) => [name, match[i + 1]])),
      );
  }
  let match = /^duplicate arm name "(.*)"$/.exec(message);
  if (match) return t("validation.duplicateArm", { arm: match[1] });
  match = /^must be (canary\.[\w.]+\/v[\w]+)$/.exec(message);
  if (match) return t("validation.apiVersion", { version: match[1] });
  match = /^must not set (.+) on the CR \(managed by the operator\)$/.exec(
    message,
  );
  if (match) return t("validation.operatorOwned", { fields: match[1] });
  match = /^YAML must be an object with named keys\.(?: \((.+)\))?$/.exec(
    message,
  );
  if (match) {
    if (!match[1]) return t("errors.yamlObject");
    return match[1].endsWith(": recursive alias")
      ? t("errors.yamlRecursive", { field: match[1].slice(0, -17) })
      : t("errors.yamlValue", { field: match[1] });
  }
  if (message.startsWith("prepare a new plan before creation:"))
    return t("errors.prepareAgain");
  if (
    message.startsWith(
      "stop this experiment with its original operator before migrating the API group:",
    )
  )
    return t("errors.legacyStop");
  if (
    /exporter (?:replacement|changed)|Synthetic exporter replacement gap/i.test(
      message,
    )
  )
    return t("errors.exporterGap");
  if (/context deadline exceeded|request timed out/i.test(message))
    return t("errors.timeout");
  const parts = message.split("; ");
  if (parts.length > 1) {
    const translated = parts
      .slice(0, 16)
      .map(
        (part) =>
          translateMessage(part, t, depth + 1) ?? t("errors.requestFailed"),
      );
    return [...new Set(translated)].join("\n");
  }
  match = /^arm ([^:]+): (.+)$/s.exec(message);
  if (match)
    return t("errors.armContext", {
      arm: match[1],
      message:
        translateMessage(match[2], t, depth + 1) ?? t("errors.requestFailed"),
    });
  match = /^([^:\n]+): (.+)$/s.exec(message);
  if (match) {
    const translated = translateMessage(match[2], t, depth + 1);
    if (translated)
      return t("errors.fieldContext", { field: match[1], message: translated });
  }
  return null;
}
export function describeError(
  error: unknown,
  t: TFunction,
  fallback: ErrorKey = "requestFailed",
): { summary: string; details: string } {
  const details = errorMessage(error);
  const object =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status =
    typeof object.status === "number"
      ? object.status
      : Number(/^HTTP (\d+)$/.exec(details)?.[1]);
  const statusKey: ErrorKey | undefined =
    status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "notFound"
          : status === 413
            ? "tooLarge"
            : status === 429
              ? "rateLimited"
              : undefined;
  if (statusKey) return { summary: t(`errors.${statusKey}`), details };
  if (
    typeof object.code === "string" &&
    object.code !== "details" &&
    Object.hasOwn(errorEn, object.code)
  ) {
    const names = [
      "arm",
      "namespace",
      "field",
      "key",
      "message",
      "time",
      "line",
      "column",
    ];
    const params: Params =
      object.params && typeof object.params === "object"
        ? Object.fromEntries(
            Object.entries(object.params).filter(
              ([key, v]) =>
                names.includes(key) &&
                (typeof v === "string" || typeof v === "number"),
            ),
          )
        : {};
    return { summary: t(`errors.${object.code}`, params), details };
  }
  if (object.name === "YAMLException") {
    const mark = object.mark as { line?: number; column?: number } | undefined;
    return {
      summary: t("errors.yamlSyntax", {
        line: (mark?.line ?? 0) + 1,
        column: (mark?.column ?? 0) + 1,
      }),
      details,
    };
  }
  const summary = translateMessage(details, t);
  return {
    summary:
      summary ??
      t(
        `errors.${status === 409 ? "conflict" : status >= 500 ? "server" : object.name === "AbortError" ? "cancelled" : fallback}`,
      ),
    details,
  };
}

export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const object =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return Object.assign(new Error(errorMessage(error)), {
    ...(typeof object.status === "number" ? { status: object.status } : {}),
    ...(typeof object.code === "string"
      ? { code: object.code, params: object.params }
      : {}),
  });
}
