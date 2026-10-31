import type {
  ArmDraft,
  CanaryDraft,
  CatalogVariant,
  JsonObject,
  LLMCanary,
} from "../types";
import { mergeLayers, stripOperatorOwned } from "./values";
import { toYaml } from "./yaml";
import { validateDraft, type ValidationIssue } from "./validate";
import { CANARY_API_VERSION, CANARY_GROUP } from "./kubernetes";

export const DERIVED_OPERATOR_LAYER: JsonObject = {
  scaler: { enabled: false },
  cart: { enabled: true },
  sloRequirement: { enabled: false },
};

export function layersFromVariant(
  variant: CatalogVariant,
  replicaCount: number,
  extraForm: JsonObject = {},
): ArmDraft["layers"] {
  const catalog: JsonObject = { ...variant.values };
  if (variant.image) catalog.image = { ...variant.image };
  return {
    catalog,
    form: {
      replicaCount,
      ...extraForm,
    },
    derived: DERIVED_OPERATOR_LAYER,
  };
}

export function armValuesForCr(arm: ArmDraft): {
  values: JsonObject;
  stripped: string[];
} {
  const merged = mergeLayers(arm.layers);
  const { stripped, removed } = stripOperatorOwned(merged);
  return { values: stripped, stripped: removed };
}

export function draftToCanary(draft: CanaryDraft): {
  canary: LLMCanary;
  stripped: Record<string, string[]>;
} {
  const stripped: Record<string, string[]> = {};
  const canary: LLMCanary = {
    apiVersion: CANARY_API_VERSION,
    kind: "LLMCanary",
    metadata: {
      name: draft.name,
      namespace: draft.namespace,
      annotations: {
        [`${CANARY_GROUP}/catalog-schema`]: "catalog.swiss/v2",
      },
    },
    spec: {
      targetRef: {
        kind: draft.targetRef.kind || "HelmRelease",
        name: draft.targetRef.name,
        ...(draft.targetRef.namespace
          ? { namespace: draft.targetRef.namespace }
          : {}),
      },
      arms: draft.arms.map((arm) => {
        const built = armValuesForCr(arm);
        stripped[arm.name] = built.stripped;
        return {
          name: arm.name,
          chart: arm.chart,
          values: built.values,
        };
      }),
      proxy: {
        mode: "PerArm",
        replicas: draft.proxy.replicas || 2,
        ...(draft.proxy.values && Object.keys(draft.proxy.values).length > 0
          ? { values: draft.proxy.values }
          : {}),
      },
      traffic: {
        production: draft.traffic.production,
        canary: draft.traffic.canary,
      },
      gateway: {
        name: draft.gateway.name,
        namespace: draft.gateway.namespace,
        ...(draft.gateway.hostname ? { hostname: draft.gateway.hostname } : {}),
        ...(draft.gateway.sectionName
          ? { sectionName: draft.gateway.sectionName }
          : {}),
      },
      route: {
        enabled: draft.route.enabled,
        productionOpenrestyService: draft.route.productionOpenrestyService,
        ...(draft.route.path ? { path: draft.route.path } : {}),
        ...(draft.route.servicePort !== undefined
          ? { servicePort: draft.route.servicePort }
          : {}),
        ...(draft.route.forceHeader.name && draft.route.forceHeader.value
          ? { forceHeader: { ...draft.route.forceHeader } }
          : {}),
      },
    },
  };
  return { canary, stripped };
}

export interface EmitResult {
  canary: LLMCanary;
  issues: ValidationIssue[];
  yaml: string;
  stripped: Record<string, string[]>;
}

export function emitManifests(draft: CanaryDraft): EmitResult {
  const { canary, stripped } = draftToCanary(draft);
  const issues = validateDraft(draft, canary);
  const yaml = toYaml(canary);
  return { canary, issues, yaml, stripped };
}

export function emptyDraft(): CanaryDraft {
  return {
    name: "",
    namespace: "llm-serving",
    targetRef: { kind: "HelmRelease", name: "", namespace: "llm-serving" },
    arms: [],
    traffic: { production: 90, canary: 10 },
    gateway: { name: "", namespace: "" },
    route: {
      enabled: false,
      productionOpenrestyService: "",
      path: "",
      forceHeader: { name: "", value: "" },
    },
    proxy: { mode: "PerArm", replicas: 2, sessionAffinity: false },
  };
}
