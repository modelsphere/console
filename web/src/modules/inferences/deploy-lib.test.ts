import { describe, expect, it } from "vitest";
import type { DiffResult, Plan } from "@swiss/lib/api";
import type { Node } from "@swiss/lib/api";
import { SECTIONS, chartChoice, clusterTaints, defaultServiceId, extraValue, fracOutOfRange, initialValue, pickTaints, pickedTaints, pipelineState, serviceIdError, taintToleration, whatMoves } from "@/modules/inferences/deploy-lib";

const diff = (over: Partial<DiffResult>): DiffResult => ({ planHash: "h", changed: true, output: "", revision: 3, exists: true, ...over });

describe("deploy sections", () => {
  it("keeps SLO and monitoring controls in routing instead of a separate section", () => {
    expect(SECTIONS).toEqual(["basic", "resources", "routing", "advanced"]);
  });
});

describe("route values", () => {
  it("rejects a floor fraction outside (0, 1]", () => {
    expect(fracOutOfRange("")).toBe(false);
    expect(fracOutOfRange("0.4")).toBe(false);
    expect(fracOutOfRange("1")).toBe(false);
    expect(fracOutOfRange("0")).toBe(true);
    expect(fracOutOfRange("1.5")).toBe(true);
    expect(fracOutOfRange("x")).toBe(true);
  });
  it("reads an added setting's value", () => {
    expect(extraValue({ nginxExtras: [{ key: "adaptive_cc_min", value: " 4 " }] }, "adaptive_cc_min")).toBe("4");
    expect(extraValue({ nginxExtras: [] }, "adaptive_cc_min")).toBe("");
  });
  it("starts a boolean setting at openresty's default and others empty", () => {
    expect(initialValue("no-such-key")).toBe("");
  });
});

describe("chartChoice", () => {
  const running = { name: "sglang", version: "0.7.1" };
  it("keeps the running chart when the range still allows it", () => {
    const c = chartChoice({ data: { chart: "sglang", range: "^0.7", variant: "v", versions: ["0.7.3", "0.7.1"] } }, "", running);
    expect(c).toMatchObject({ keep: true, fallback: "0.7.1", resolved: "0.7.1", pinned: false, options: ["0.7.3", "0.7.1"] });
  });
  it("falls back to the newest when the running one left the range", () => {
    expect(chartChoice({ data: { chart: "sglang", range: "^0.8", variant: "v", versions: ["0.8.2"] } }, "", running)).toMatchObject({ keep: false, fallback: "0.8.2" });
  });
  it("offers nothing to choose for a pinned chart", () => {
    expect(chartChoice({ data: { chart: "sglang", range: "0.7.1", variant: "v", versions: ["0.7.1"] } }, "")).toMatchObject({ pinned: true, options: [] });
  });
  it("reports a failed listing and keeps what was typed", () => {
    expect(chartChoice({ error: new Error("boom") }, "0.7.9", running)).toMatchObject({ error: "boom", resolved: "0.7.9" });
  });
});

describe("pipelineState", () => {
  it("installs when the dry run finds no release", () => {
    expect(pipelineState({ diff: diff({ exists: false }), applied: false })).toMatchObject({ action: "install", canApply: true, canForce: false });
  });
  it("blocks applying an unchanged plan", () => {
    expect(pipelineState({ diff: diff({ changed: false }), applied: false })).toMatchObject({ action: "apply", nothingToDo: true, canApply: false });
  });
  it("waits for the dry run, and does not apply twice", () => {
    expect(pipelineState({ diff: null, exists: true, applied: false }).canApply).toBe(false);
    expect(pipelineState({ diff: diff({}), applied: true }).canApply).toBe(false);
  });
  it("names a rollback a rollback, without force", () => {
    expect(pipelineState({ rollback: true, diff: diff({}), applied: false })).toMatchObject({ action: "rollback", canForce: false });
  });
});

describe("whatMoves", () => {
  const plan = (version: string, chart: string, variant: string): Plan =>
    ({ source: { model: "m", version, variant, digest: "sha256:0123456789abcdef" }, chart: { name: "sglang", version: chart }, hash: version }) as Plan;
  it("marks what changes and what stays", () => {
    const rows = whatMoves(plan("1.0", "0.7.1", "a"), plan("1.1", "0.7.1", "a"), "default");
    expect(rows.filter((r) => r.changed).map((r) => r.key)).toEqual(["version"]);
    expect(rows.find((r) => r.key === "digest")?.to).toBe("0123456789ab");
  });
});

describe("service id", () => {
  it("must be a DNS-1035 label of at most 53 characters", () => {
    expect(serviceIdError("qwen3-8b")).toBeUndefined();
    expect(serviceIdError("")).toBe("required");
    expect(serviceIdError("mimo-v2.5")).toBe("format");
    expect(serviceIdError("3b-model")).toBe("format");
    expect(serviceIdError("Qwen")).toBe("format");
    expect(serviceIdError("a-")).toBe("format");
    expect(serviceIdError("a".repeat(54))).toBe("length");
  });
  it("is made from the model name by default", () => {
    expect(defaultServiceId("mimo-v2.5")).toBe("mimo-v2-5");
    expect(defaultServiceId("Qwen3.6-35B-A3B")).toBe("qwen3-6-35b-a3b");
    expect(defaultServiceId("1st.model")).toBe("st-model");
    expect(serviceIdError(defaultServiceId("x".repeat(60) + "-y"))).toBeUndefined();
  });
});

describe("cluster taints", () => {
  const node = (Name: string, Taints?: string[]) => ({ Name, GPUProduct: "", GPUs: 0, Schedulable: true, Ready: true, Taints }) as Node;
  const nodes = [
    node("a", ["storage=nof:NoSchedule", "node.kubernetes.io/unschedulable=:NoSchedule"]),
    node("b", ["storage=nof:NoSchedule", "gpu=:NoExecute"]),
    node("c"),
  ];

  it("lists each taint once with its node count, without Kubernetes' own", () => {
    expect(clusterTaints(nodes).map((c) => [c.taint, c.nodes])).toEqual([
      ["gpu=:NoExecute", 1],
      ["storage=nof:NoSchedule", 2],
    ]);
  });

  it("matches a taint exactly, and one with no value by Exists", () => {
    expect(taintToleration("storage=nof:NoSchedule")).toEqual({ key: "storage", operator: "Equal", value: "nof", effect: "NoSchedule" });
    expect(taintToleration("example.com/gpu=:NoExecute")).toEqual({ key: "example.com/gpu", operator: "Exists", value: "", effect: "NoExecute" });
    expect(taintToleration("bad")).toBeUndefined();
  });

  it("adds and removes rows for picked taints, keeping every other row", () => {
    const offered = clusterTaints(nodes);
    const own = { key: "custom", operator: "Exists" as const, value: "", effect: "" };
    const rows = pickTaints([own], offered, ["storage=nof:NoSchedule"]);
    expect(rows).toEqual([own, { key: "storage", operator: "Equal", value: "nof", effect: "NoSchedule" }]);
    expect(pickedTaints(rows, offered)).toEqual(["storage=nof:NoSchedule"]);
    expect(pickTaints(rows, offered, [])).toEqual([own]);
  });
});
