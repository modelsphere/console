import type { LLMCanary } from "../types";

const now = "2026-10-10T08:00:00Z";

export const fixtureCanaries: LLMCanary[] = [
  {
    apiVersion: "canary.modelsphere.dev/v1alpha1",
    kind: "LLMCanary",
    metadata: {
      name: "qwen-tune",
      namespace: "llm-serving",
      generation: 3,
      creationTimestamp: "2026-10-08T02:10:00Z",
    },
    spec: {
      targetRef: {
        kind: "HelmRelease",
        name: "qwen-prod",
        namespace: "llm-serving",
      },
      arms: [
        {
          name: "baseline",
          chart: { name: "sglang", version: "0.8.0" },
          values: {
            replicaCount: 1,
            model: { localPath: "/mnt/models/qwen3.6-35b-a3b" },
            extraArgs: ["--tp-size=8"],
          },
          source: {
            model: "qwen3.6-35b-a3b",
            version: "1.1.0",
            variant: "sglang-tp8-h100-baseline",
          },
        },
        {
          name: "candidate",
          chart: { name: "sglang", version: "0.8.0" },
          values: {
            replicaCount: 1,
            model: { localPath: "/mnt/models/qwen3.6-35b-a3b" },
            extraArgs: ["--chunked-prefill-size=16384", "--tp-size=8"],
          },
          source: {
            model: "qwen3.6-35b-a3b",
            version: "1.1.0",
            variant: "sglang-tp8-h100-optimized",
          },
        },
      ],
      proxy: { mode: "PerArm", replicas: 2 },
      traffic: { production: 90, canary: 10 },
      gateway: {
        name: "openresty",
        namespace: "llm-route",
        hostname: "ai-cloud.example.com",
        sectionName: "https",
      },
      route: {
        enabled: true,
        productionOpenrestyService: "openresty",
        path: "/qwen",
        forceHeader: { name: "x-canary", value: "force" },
      },
    },
    status: {
      phase: "Serving",
      observedGeneration: 3,
      armsReadySince: "2026-10-08T03:00:00Z",
      arms: [
        { name: "baseline", ready: true },
        { name: "candidate", ready: true },
      ],
      canaryProxy: { name: "qwen-tune-openresty", ready: true },
      canaryProxies: [
        { name: "qwen-tune-openresty-baseline", arm: "baseline", ready: true },
        {
          name: "qwen-tune-openresty-candidate",
          arm: "candidate",
          ready: true,
        },
      ],
      routeName: "canary-llm-serving-qwen-tune",
      routePath: "/qwen",
      gatewayNamespace: "llm-route",
      conditions: [
        {
          type: "Provisioned",
          status: "True",
          reason: "ArmsReady",
          lastTransitionTime: now,
        },
        {
          type: "TrafficProgrammed",
          status: "True",
          reason: "RouteProgrammed",
          lastTransitionTime: now,
        },
        {
          type: "Degraded",
          status: "False",
          reason: "NoIssues",
          lastTransitionTime: now,
        },
      ],
    },
  },
  {
    apiVersion: "canary.modelsphere.dev/v1alpha1",
    kind: "LLMCanary",
    metadata: {
      name: "kimi-engine",
      namespace: "llm-serving",
      generation: 1,
      creationTimestamp: "2026-10-12T11:00:00Z",
    },
    spec: {
      targetRef: {
        kind: "HelmRelease",
        name: "kimi-prod",
        namespace: "llm-serving",
      },
      arms: [
        {
          name: "sglang",
          chart: { name: "sglang", version: "0.7.9" },
          values: { replicaCount: 1, extraArgs: ["--tp-size=8"] },
          source: {
            model: "kimi-k3",
            version: "1.0.5",
            variant: "sglang-tp8-b300-optimized",
          },
        },
        {
          name: "vllm",
          chart: { name: "vllm", version: "0.5.0" },
          values: { replicaCount: 1, extraArgs: ["--tensor-parallel-size=8"] },
          source: {
            model: "kimi-k3",
            version: "1.0.5",
            variant: "vllm-tp8-b300",
          },
        },
      ],
      proxy: { mode: "PerArm", replicas: 2 },
      traffic: { production: 99, canary: 1 },
      gateway: { name: "openresty", namespace: "llm-route" },
      route: {
        enabled: false,
        productionOpenrestyService: "openresty",
        path: "/kimi-k3",
      },
    },
    status: {
      phase: "Provisioning",
      observedGeneration: 1,
      arms: [
        { name: "sglang", ready: true },
        { name: "vllm", ready: false },
      ],
      canaryProxy: { name: "kimi-engine-openresty", ready: false },
      routePath: "/kimi-k3",
      gatewayNamespace: "llm-route",
      conditions: [
        {
          type: "Provisioned",
          status: "False",
          reason: "ArmsNotReady",
          message: "arm vllm is not ready",
          lastTransitionTime: now,
        },
        {
          type: "TrafficProgrammed",
          status: "False",
          reason: "TrafficDisabled",
          lastTransitionTime: now,
        },
      ],
    },
  },
  {
    apiVersion: "canary.modelsphere.dev/v1alpha1",
    kind: "LLMCanary",
    metadata: {
      name: "glm-fail",
      namespace: "models",
      generation: 2,
      creationTimestamp: "2026-10-09T16:40:00Z",
    },
    spec: {
      targetRef: { kind: "HelmRelease", name: "glm-prod", namespace: "models" },
      arms: [
        {
          name: "candidate",
          chart: { name: "sglang", version: "0.8.0" },
          values: { replicaCount: 1, scaler: { minReplicas: 1 } },
        },
      ],
      traffic: { production: 50, canary: 50 },
      gateway: { name: "edge", namespace: "models-route", sectionName: "http" },
      route: {
        enabled: true,
        productionOpenrestyService: "glm-openresty",
        path: "/glm",
      },
    },
    status: {
      phase: "Failed",
      observedGeneration: 2,
      arms: [{ name: "candidate", ready: false }],
      routeName: "canary-models-glm-fail",
      routePath: "/glm",
      gatewayNamespace: "models-route",
      conditions: [
        {
          type: "Degraded",
          status: "True",
          reason: "InvalidValues",
          message:
            "arm candidate must not set scaler.enabled: the operator writes it on both arms",
          lastTransitionTime: now,
        },
      ],
    },
  },
  {
    apiVersion: "canary.modelsphere.dev/v1alpha1",
    kind: "LLMCanary",
    metadata: {
      name: "kimi-old",
      namespace: "llm-serving",
      generation: 8,
      creationTimestamp: "2026-09-30T09:00:00Z",
    },
    spec: {
      targetRef: {
        kind: "HelmRelease",
        name: "kimi-prod",
        namespace: "llm-serving",
      },
      arms: [
        {
          name: "baseline",
          chart: { name: "sglang", version: "0.7.9" },
          values: { replicaCount: 1 },
        },
      ],
      traffic: { production: 100, canary: 0 },
      gateway: {
        name: "openresty",
        namespace: "llm-route",
        hostname: "ai-cloud.example.com",
      },
      route: {
        enabled: false,
        productionOpenrestyService: "openresty",
        path: "/kimi-k3",
      },
      drain: { maxWait: "1h" },
    },
    status: {
      phase: "Draining",
      observedGeneration: 8,
      drainStartedAt: "2026-10-13T01:10:00Z",
      drainInFlight: 3,
      routePath: "/kimi-k3",
      gatewayNamespace: "llm-route",
      arms: [{ name: "baseline", ready: true }],
      conditions: [
        {
          type: "TrafficProgrammed",
          status: "False",
          reason: "WithdrawFailed",
          lastTransitionTime: now,
        },
      ],
    },
  },
];
