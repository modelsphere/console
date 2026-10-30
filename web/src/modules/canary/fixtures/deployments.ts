import type { ProductionTarget } from "../types";

/** Production traffic-route keys (HelmRelease by name). Not arm templates. */
export const productionTargets: ProductionTarget[] = [
  {
    kind: "LLMService",
    backend: "llmsvc",
    name: "qwen-prod",
    namespace: "llm-serving",
    model: "qwen3.6-35b-a3b",
    variant: "sglang-tp8-h100-baseline",
    version: "1.1.0",
    route: "qwen",
    chart: "sglang-0.8.0",
    gateway: {
      name: "openresty",
      namespace: "llm-route",
      hostname: "ai-cloud.example.com",
      sectionName: "https",
    },
    openrestyService: "openresty",
  },
  {
    kind: "HelmRelease",
    name: "kimi-prod",
    namespace: "llm-serving",
    model: "kimi-k3",
    variant: "sglang-tp8-b300-optimized",
    version: "1.0.5",
    route: "kimi-k3",
    chart: "sglang-0.7.9",
    gateway: { name: "openresty", namespace: "llm-route" },
    openrestyService: "openresty",
  },
  {
    kind: "HelmRelease",
    name: "glm-prod",
    namespace: "models",
    model: "glm5.3",
    variant: "sglang-tp8-h100",
    version: "1.0.0",
    route: "glm",
    chart: "sglang-0.8.0",
    gateway: { name: "edge", namespace: "models-route", sectionName: "http" },
    openrestyService: "glm-openresty",
  },
];
