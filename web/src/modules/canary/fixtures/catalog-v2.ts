import type { CatalogIndexV2, CatalogVariant } from "../types";

const COMMIT = "7cbd6a8c0e1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c";

function digest(n: string): string {
  const hex = (n + "0".repeat(64)).replace(/[^a-f0-9]/g, "a").slice(0, 64);
  return `sha256:${hex}`;
}

const qwenTp2Values: CatalogVariant["values"] = {
  model: { hostPathType: "Directory", contextLength: "" },
  extraArgs: [
    "--tp-size=2",
    "--mem-fraction-static=0.85",
    "--trust-remote-code",
  ],
  env: [{ name: "NVIDIA_DISABLE_REQUIRE", value: "1" }],
};

const qwenTp8BaselineValues: CatalogVariant["values"] = {
  model: { hostPathType: "Directory", contextLength: "262144" },
  extraArgs: [
    "--tp-size=8",
    "--mem-fraction-static=0.8",
    "--trust-remote-code",
  ],
  env: [{ name: "NVIDIA_DISABLE_REQUIRE", value: "1" }],
};

const qwenTp8OptValues: CatalogVariant["values"] = {
  model: { hostPathType: "Directory", contextLength: "262144" },
  extraArgs: [
    "--chunked-prefill-size=16384",
    "--tp-size=8",
    "--mem-fraction-static=0.8",
    "--trust-remote-code",
  ],
  env: [{ name: "NVIDIA_DISABLE_REQUIRE", value: "1" }],
};

const kimiSglangValues: CatalogVariant["values"] = {
  model: { mountPath: "/model", hostPathType: "Directory", contextLength: "" },
  extraArgs: [
    "--tp-size=8",
    "--kv-cache-dtype=fp8_e4m3",
    "--trust-remote-code",
  ],
};

const kimiVllmValues: CatalogVariant["values"] = {
  extraArgs: ["--tensor-parallel-size=8", "--trust-remote-code"],
  env: [{ name: "NVIDIA_DISABLE_REQUIRE", value: "1" }],
};

/** Variant files the wizard reads for chart+values stubs. Schema v2 only. */
export const catalogVariants: CatalogVariant[] = [
  {
    apiVersion: "catalog.swiss/v2",
    kind: "Variant",
    model: "qwen3.6-35b-a3b",
    id: "sglang-tp2-h100",
    version: "1.1.0",
    servedName: "qwen",
    description: "TP2 on two H100 or H800 GPUs, single node.",
    engine: "sglang",
    chart: { name: "sglang", version: ">=0.7.1" },
    resolvedChartVersion: "0.8.0",
    image: { repository: "lmsysorg/sglang", tag: "v0.5.18-cu129" },
    requires: {
      gpus: 2,
      topology: "single-node",
      gpuProduct: ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H800"],
    },
    values: qwenTp2Values,
    digest: digest("qwen-tp2"),
    path: "models/qwen3.6-35b-a3b/sglang-tp2-h100.yaml",
  },
  {
    apiVersion: "catalog.swiss/v2",
    kind: "Variant",
    model: "qwen3.6-35b-a3b",
    id: "sglang-tp8-h100-baseline",
    version: "1.1.0",
    servedName: "qwen",
    description: "Baseline: TP8 on eight H100 GPUs, single node.",
    engine: "sglang",
    chart: { name: "sglang", version: ">=0.7.1" },
    resolvedChartVersion: "0.8.0",
    image: { repository: "lmsysorg/sglang", tag: "v0.5.19-cu129" },
    requires: {
      gpus: 8,
      topology: "single-node",
      gpuProduct: ["NVIDIA-H100-80GB-HBM3"],
    },
    values: qwenTp8BaselineValues,
    digest: digest("qwen-tp8b"),
    path: "models/qwen3.6-35b-a3b/sglang-tp8-h100-baseline.yaml",
  },
  {
    apiVersion: "catalog.swiss/v2",
    kind: "Variant",
    model: "qwen3.6-35b-a3b",
    id: "sglang-tp8-h100-optimized",
    version: "1.1.0",
    servedName: "qwen",
    description: "Tuned TP8 on eight H100 GPUs.",
    engine: "sglang",
    chart: { name: "sglang", version: ">=0.7.1" },
    resolvedChartVersion: "0.8.0",
    image: { repository: "lmsysorg/sglang", tag: "v0.5.19-cu129" },
    requires: {
      gpus: 8,
      topology: "single-node",
      gpuProduct: ["NVIDIA-H100-80GB-HBM3"],
    },
    values: qwenTp8OptValues,
    digest: digest("qwen-tp8o"),
    path: "models/qwen3.6-35b-a3b/sglang-tp8-h100-optimized.yaml",
  },
  {
    apiVersion: "catalog.swiss/v2",
    kind: "Variant",
    model: "kimi-k3",
    id: "sglang-tp8-b300-optimized",
    version: "1.0.5",
    servedName: "kimi-k3",
    description: "Tuned SGLang TP8 on eight B300 GPUs.",
    engine: "sglang",
    chart: { name: "sglang", version: ">=0.7.9" },
    resolvedChartVersion: "0.7.9",
    image: { repository: "lmsysorg/sglang", tag: "v0.5.19" },
    requires: {
      gpus: 8,
      topology: "single-node",
      gpuProduct: ["NVIDIA-B300-SXM6-AC"],
    },
    values: kimiSglangValues,
    digest: digest("kimi-sgl"),
    path: "models/kimi-k3/sglang-tp8-b300-optimized.yaml",
  },
  {
    apiVersion: "catalog.swiss/v2",
    kind: "Variant",
    model: "kimi-k3",
    id: "vllm-tp8-b300",
    version: "1.0.5",
    servedName: "kimi-k3",
    description: "vLLM TP8 on eight B300 GPUs (cross-engine vs SGLang).",
    engine: "vllm",
    chart: { name: "vllm", version: ">=0.4.6" },
    resolvedChartVersion: "0.5.0",
    image: { repository: "4pdosc/vllm-openai", tag: "v0.30.1-nightly" },
    requires: {
      gpus: 8,
      topology: "single-node",
      gpuProduct: ["NVIDIA-B300-SXM6-AC"],
    },
    values: kimiVllmValues,
    digest: digest("kimi-vllm"),
    path: "models/kimi-k3/vllm-tp8-b300.yaml",
  },
];

function indexVariant(v: CatalogVariant) {
  return {
    id: v.id,
    version: v.version,
    digest: v.digest ?? digest(v.id),
    engine: v.engine,
    chart: v.chart,
    requires: v.requires,
    servedName: v.servedName,
    description: v.description,
  };
}

export const catalogIndexV2: CatalogIndexV2 = {
  schema: "v2",
  name: "fixture",
  ref: COMMIT,
  models: [
    {
      name: "qwen3.6-35b-a3b",
      displayName: "Qwen3.6 35B-A3B",
      description: "Stock Qwen3.6-35B-A3B on two or eight H100 GPUs.",
      family: "qwen",
      tags: ["chat", "moe"],
      defaultVariant: "sglang-tp2-h100",
      source: { hf: "Qwen/Qwen3.6-35B-A3B" },
      tuning: [
        {
          baseline: { id: "sglang-tp8-h100-baseline", version: "1.1.0" },
          optimized: { id: "sglang-tp8-h100-optimized", version: "1.1.0" },
          uplift: 4.3,
          report: "qwen3.6-35b-a3b-h100-report.html",
        },
      ],
      variants: catalogVariants
        .filter((v) => v.model === "qwen3.6-35b-a3b")
        .map(indexVariant),
    },
    {
      name: "kimi-k3",
      displayName: "Kimi K3",
      description: "Kimi K3 with SGLang and vLLM on eight B300 GPUs.",
      family: "kimi",
      tags: ["chat", "reasoning"],
      defaultVariant: "sglang-tp8-b300-optimized",
      source: { hf: "moonshotai/Kimi-K3" },
      tuning: [
        {
          baseline: { id: "sglang-tp8-b300-baseline", version: "1.0.5" },
          optimized: { id: "sglang-tp8-b300-optimized", version: "1.0.5" },
          uplift: 57.6,
        },
      ],
      variants: catalogVariants
        .filter((v) => v.model === "kimi-k3")
        .map(indexVariant),
    },
  ],
};

export function findVariant(
  model: string,
  id: string,
  version?: string,
): CatalogVariant | undefined {
  return catalogVariants.find(
    (v) =>
      v.model === model && v.id === id && (!version || v.version === version),
  );
}
