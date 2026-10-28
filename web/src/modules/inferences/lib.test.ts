import { describe, expect, it } from "vitest";
import type { ObjectResult, Plan, ReleaseStatus, Run } from "@swiss/lib/api";
import {
  age,
  defaultContainer,
  ofRelease,
  warnings,
  detailPath,
  installSteps,
  modelLine,
  parseTab,
  releaseState,
  revisionRows,
  rowState,
  sloBlocked,
  visibleTabs,
} from "@/modules/inferences/lib";

const status = (over: Partial<ReleaseStatus> = {}): ReleaseStatus => ({
  release: "r",
  namespace: "ns",
  exists: true,
  revision: 3,
  helmStatus: "deployed",
  pods: [],
  ready: 1,
  total: 1,
  ...over,
});

const run = (over: Partial<Run>): Run => ({
  id: 1,
  namespace: "ns",
  release: "r",
  action: "apply",
  planHash: "h",
  changed: true,
  startedAt: "2026-10-01T00:00:00Z",
  endedAt: "2026-10-01T00:01:00Z",
  ...over,
});

describe("rowState", () => {
  it("puts a failed plan phase ahead of helm's deployed", () => {
    expect(rowState({ status: "deployed", phase: "failed" }).key).toBe("failed");
  });
  it("reads helm's pending-* as applying", () => {
    expect(rowState({ status: "pending-upgrade" })).toEqual({ key: "applying", tone: "info" });
  });
  it("keeps a status it has no word for", () => {
    expect(rowState({ status: "superseded" })).toEqual({ key: "other", tone: "muted", raw: "superseded" });
  });
  it("calls helm's deployed applied, not serving", () => {
    expect(rowState({ status: "deployed", phase: "applied" })).toEqual({ key: "applied", tone: "success" });
  });
  it("calls a row without a status unknown", () => {
    expect(rowState({}).key).toBe("unknown");
  });
  it("reads an llmsvc row's operator phase over helm's deployed", () => {
    expect(rowState({ status: "deployed", phase: "Failed" }).key).toBe("failed");
    expect(rowState({ status: "deployed", phase: "Applying" }).key).toBe("applying");
    expect(rowState({ phase: "Pending" }).key).toBe("applying");
  });
});

describe("releaseState", () => {
  it("is serving when every pod is ready", () => {
    expect(releaseState(status()).key).toBe("serving");
  });
  it("is loading, not failed, while pods come up", () => {
    expect(releaseState(status({ ready: 1, total: 2 }))).toEqual({ key: "loading", tone: "warning" });
  });
  it("is not installed when there is neither a release nor a plan status", () => {
    expect(releaseState(status({ exists: false })).key).toBe("notInstalled");
  });
  it("reports an apply that never finished, even with no release yet", () => {
    expect(releaseState(status({ exists: false, planStatus: { phase: "applying" } })).key).toBe("applying");
  });
  it("is stalled when a pod has not been ready for over an hour", () => {
    const pod = (ageSeconds: number, ready = false) => ({ name: "p", phase: "Running", ready, restarts: 0, ageSeconds });
    expect(releaseState(status({ ready: 0, total: 1, pods: [pod(3 * 86400)] }))).toEqual({ key: "stalled", tone: "error" });
    expect(releaseState(status({ ready: 0, total: 1, pods: [pod(1200)] })).key).toBe("loading");
    expect(releaseState(status({ ready: 1, total: 2, pods: [pod(7200, true), pod(600)] })).key).toBe("loading");
  });
  it("is noPods when the release exists but nothing is scheduled", () => {
    expect(releaseState(status({ ready: 0, total: 0 })).key).toBe("noPods");
  });
});

describe("uninstalling wins over the states a disappearing release would otherwise show", () => {
  const rows: { name: string; d: Parameters<typeof rowState>[0]; key: string }[] = [
    { name: "a row phase of uninstalling", d: { phase: "uninstalling" }, key: "uninstalling" },
    { name: "a row phase of uninstalling ahead of helm failed", d: { phase: "uninstalling", status: "failed" }, key: "uninstalling" },
    { name: "a row phase of uninstalling ahead of helm pending", d: { phase: "uninstalling", status: "pending-upgrade" }, key: "uninstalling" },
    { name: "helm's own uninstalling status", d: { status: "uninstalling" }, key: "uninstalling" },
    { name: "helm's uninstalling status ahead of a failed plan", d: { status: "uninstalling", phase: "failed" }, key: "uninstalling" },
    { name: "helm's uninstalling status ahead of an applying plan", d: { status: "uninstalling", phase: "applying" }, key: "uninstalling" },
  ];
  for (const tc of rows) {
    it(`reads ${tc.name} as uninstalling`, () => {
      expect(rowState(tc.d)).toEqual({ key: tc.key, tone: "warning" });
    });
  }

  const releases: { name: string; s: Partial<ReleaseStatus>; key: string }[] = [
    { name: "planStatus.phase uninstalling with the helm release already gone", s: { exists: false, ready: 0, total: 0, planStatus: { phase: "uninstalling" } }, key: "uninstalling" },
    { name: "planStatus.phase uninstalling ahead of a failed helm status", s: { exists: false, ready: 0, total: 0, helmStatus: "failed", planStatus: { phase: "uninstalling" } }, key: "uninstalling" },
    { name: "planStatus.phase uninstalling ahead of an applying helm status", s: { helmStatus: "pending-upgrade", planStatus: { phase: "uninstalling" } }, key: "uninstalling" },
    { name: "llmservice.phase uninstalling while pods are still ready", s: { ready: 1, total: 1, llmservice: { phase: "uninstalling" } }, key: "uninstalling" },
    { name: "llmservice.phase uninstalling ahead of a failed plan and no pods", s: { exists: false, ready: 0, total: 0, planStatus: { phase: "failed" }, llmservice: { phase: "uninstalling" } }, key: "uninstalling" },
    { name: "helm status uninstalling ahead of no pods", s: { exists: true, ready: 0, total: 0, helmStatus: "uninstalling" }, key: "uninstalling" },
  ];
  for (const tc of releases) {
    it(`reads ${tc.name} as uninstalling`, () => {
      expect(releaseState(status(tc.s))).toEqual({ key: tc.key, tone: "warning" });
    });
  }
});

describe("tabs", () => {
  it("drops the plan when the release has none", () => {
    expect(visibleTabs({ plan: false })).toEqual(["overview", "instances", "logs", "events", "resources", "check", "versions", "runs"]);
  });
  it("falls back to the overview for a tab this release does not have", () => {
    const tabs = visibleTabs({ plan: true });
    expect(parseTab("slo", tabs)).toBe("overview");
    expect(parseTab(null, tabs)).toBe("overview");
    expect(parseTab("versions", tabs)).toBe("versions");
  });
  it("edits SLO only for an applied plan with SLO turned on in the form layer, and says why not", () => {
    const plan = { layers: { form: { sloRequirement: { enabled: true } } } } as unknown as Plan;
    expect(sloBlocked(status({ planStatus: { phase: "applied" } }), plan)).toBeUndefined();
    expect(sloBlocked(status({ planStatus: { phase: "applying" } }), plan)).toBe("pending");
    expect(sloBlocked(status({ planStatus: { phase: "applied" } }), { layers: {} } as unknown as Plan)).toBe("off");
    expect(sloBlocked(status({ planStatus: { phase: "applied" } }))).toBe("off");
  });
});

describe("paths", () => {
  it("puts the namespace in the query and leaves the default tab out", () => {
    expect(detailPath("qwen 3", "ai-ns")).toBe("qwen%203/details?namespace=ai-ns");
    expect(detailPath("q", "ns", "versions")).toBe("q/details?namespace=ns&tab=versions");
  });
});

describe("modelLine", () => {
  it("joins model, version and variant, skipping what is missing", () => {
    expect(modelLine({ model: "qwen3", version: "1.2", variant: "h100x1" })).toBe("qwen3 v1.2 · h100x1");
    expect(modelLine({ model: "qwen3" })).toBe("qwen3");
    expect(modelLine({})).toBe("");
  });
});

describe("revisionRows", () => {
  it("sorts newest first and attaches the latest successful run per revision", () => {
    const rows = revisionRows(
      [{ revision: 1 }, { revision: 2, current: true }],
      [
        run({ id: 1, revision: 2, endedAt: "2026-10-01T00:00:00Z", note: "first" }),
        run({ id: 2, revision: 2, endedAt: "2026-10-02T00:00:00Z", note: "later" }),
        run({ id: 3, revision: 1, error: "boom" }),
      ],
    );
    expect(rows.map((r) => r.revision)).toEqual([2, 1]);
    expect(rows[0]!.run?.note).toBe("later");
    expect(rows[1]!.run).toBeUndefined();
  });
});

describe("installSteps", () => {
  const route = (r: Partial<ObjectResult> & { ready?: boolean }) => ({
    result: { ref: { apiVersion: "v1", kind: "ModelRoute", name: "r" }, ...r } as ObjectResult,
    spec: { nginx: { route: "qwen" } },
    status: { ready: r.ready, backends: 2 },
  });

  it("marks everything off for a release that is not installed", () => {
    const steps = installSteps(status({ exists: false, total: 0, ready: 0 }), {}, {});
    expect(steps.map((s) => s.state)).toEqual(["off", "off", "off", "off"]);
  });
  it("reports uninstalling on the applied step while pods are still leaving", () => {
    const steps = installSteps(status({ exists: false, total: 0, ready: 0, helmStatus: "failed", planStatus: { phase: "uninstalling" } }), {}, {});
    expect(steps[0]).toEqual({ key: "applied", state: "wait", detail: "uninstalling" });
  });
  it("reports a routed release with its backends and route", () => {
    const steps = installSteps(status(), route({ ready: true }) as never, {});
    expect(steps[2]).toEqual({ key: "route", state: "ok", detail: "ready", params: { n: 2, route: "/qwen/" } });
  });
  it("does not claim there is no route when the objects could not be read", () => {
    const steps = installSteps(status(), {}, {}, true);
    expect(steps.slice(2).map((s) => [s.state, s.detail])).toEqual([
      ["wait", "unreadable"],
      ["wait", "unreadable"],
    ]);
  });
  it("calls a deleted ModelRoute bad", () => {
    expect(installSteps(status(), route({ missing: true }) as never, {})[2]!.state).toBe("bad");
  });

  const scaler = (conditions: { type: string; status: string; reason?: string; message?: string }[], cur = 1, want = 1) => ({
    result: { ref: { apiVersion: "v1", kind: "LLMScaler", name: "r" } } as ObjectResult,
    status: { currentReplicas: cur, desiredReplicas: want, conditions },
  });
  const step = (conditions: { type: string; status: string; reason?: string; message?: string }[], cur = 1, want = 1) =>
    installSteps(status(), {}, scaler(conditions, cur, want) as never)[3];

  it("reads a healthy scaler as steady, including ScalingLimited=False", () => {
    expect(step([
      { type: "ScalingActive", status: "True", reason: "DecisionReceived" },
      { type: "AbleToScale", status: "True", reason: "Synced" },
      { type: "ScalingLimited", status: "False", reason: "DesiredWithinRange" },
    ])).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 1 } });
  });
  it("calls AbleToScale=False a failure and shows its message", () => {
    expect(step([
      { type: "ScalingActive", status: "True", reason: "DecisionReceived" },
      { type: "AbleToScale", status: "False", reason: "TargetNotFound", message: "deployment demo is gone" },
    ])).toEqual({ key: "scaler", state: "bad", detail: "failingMessage", params: { reason: "TargetNotFound", message: "deployment demo is gone" } });
  });
  it("calls ScalingActive=False a failure", () => {
    expect(step([
      { type: "ScalingActive", status: "False", reason: "DecisionUnavailable" },
      { type: "AbleToScale", status: "True", reason: "Synced" },
    ])).toEqual({ key: "scaler", state: "bad", detail: "failing", params: { reason: "DecisionUnavailable" } });
  });
  it("prefers AbleToScale when it and ScalingActive are both False", () => {
    expect(step([
      { type: "ScalingActive", status: "False", reason: "InvalidSpec", message: "bad query" },
      { type: "AbleToScale", status: "False", reason: "TargetWriteFailed", message: "apiserver rejected the scale" },
    ])).toEqual({ key: "scaler", state: "bad", detail: "failingMessage", params: { reason: "TargetWriteFailed", message: "apiserver rejected the scale" } });
  });
  it("uses the condition type when a failure gives no reason", () => {
    expect(step([{ type: "AbleToScale", status: "False" }])).toEqual({ key: "scaler", state: "bad", detail: "failing", params: { reason: "AbleToScale" } });
  });
  it("does not treat ScalingLimited as a failure", () => {
    expect(step([
      { type: "ScalingLimited", status: "False", reason: "DesiredWithinRange" },
      { type: "SomeOther", status: "False", reason: "Whatever" },
    ])).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 1 } });
    expect(step([
      { type: "ScalingActive", status: "True", reason: "MetricsAvailable" },
      { type: "AbleToScale", status: "True", reason: "Synced" },
      { type: "ScalingLimited", status: "True", reason: "TooManyReplicas" },
    ])).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 1 } });
  });
  it("reports a hold as steady even when the replica count has not caught up", () => {
    for (const reason of ["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"]) {
      expect(step([
        { type: "ScalingActive", status: "True", reason: "MetricsAvailable" },
        { type: "AbleToScale", status: "True", reason },
      ], 3, 1)).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 3 } });
    }
  });
  it("lets a failure win over a hold", () => {
    expect(step([
      { type: "ScalingActive", status: "False", reason: "DecisionUnavailable" },
      { type: "AbleToScale", status: "True", reason: "ScaleDownStabilized" },
    ], 3, 1)).toEqual({ key: "scaler", state: "bad", detail: "failing", params: { reason: "DecisionUnavailable" } });
  });
  it("treats DeferralTimedOut as a normal scale", () => {
    expect(step([
      { type: "ScalingActive", status: "True", reason: "DecisionReceived" },
      { type: "AbleToScale", status: "True", reason: "DeferralTimedOut" },
    ], 1, 2)).toEqual({ key: "scaler", state: "wait", detail: "scaling", params: { cur: 1, want: 2 } });
  });
  // Operator 0.5.0 sets DecisionAvailable only under the Custom provider, and no condition under Prometheus.
  it("reads a 0.5.0 scaler with a decision as steady", () => {
    expect(step([
      { type: "DecisionAvailable", status: "True", reason: "DecisionReceived", message: "decision server recommends 2 replicas" },
    ], 2, 2)).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 2 } });
  });
  it("calls a 0.5.0 DecisionAvailable=False a failure, with its message", () => {
    expect(step([
      { type: "DecisionAvailable", status: "False", reason: "DecisionUnavailable", message: "decision server returned 404" },
    ])).toEqual({ key: "scaler", state: "bad", detail: "failingMessage", params: { reason: "DecisionUnavailable", message: "decision server returned 404" } });
  });
  it("reads a 0.5.0 Prometheus scaler with no conditions from its replicas", () => {
    expect(step([], 1, 3)).toEqual({ key: "scaler", state: "wait", detail: "scaling", params: { cur: 1, want: 3 } });
    expect(step([], 3, 3)).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 3 } });
  });
  it("fails on AbleToScale=False with its message when ScalingActive is missing", () => {
    expect(step([
      { type: "AbleToScale", status: "False", reason: "TargetUnreadable", message: "cannot read deployment demo" },
    ])).toEqual({ key: "scaler", state: "bad", detail: "failingMessage", params: { reason: "TargetUnreadable", message: "cannot read deployment demo" } });
  });
  it("prefers ScalingActive over DecisionAvailable", () => {
    expect(step([
      { type: "ScalingActive", status: "True", reason: "MetricsAvailable" },
      { type: "DecisionAvailable", status: "False", reason: "DecisionUnavailable" },
      { type: "AbleToScale", status: "True", reason: "Synced" },
    ])).toEqual({ key: "scaler", state: "ok", detail: "steady", params: { n: 1 } });
  });
});

describe("age", () => {
  it("reads seconds, minutes and hours", () => {
    expect(age(45)).toBe("45s");
    expect(age(720)).toBe("12m");
    expect(age(3 * 3600 + 7 * 60)).toBe("3h7m");
  });
});

describe("ofRelease", () => {
  it("keeps the release's own objects", () => {
    for (const n of ["mimo", "mimo-cart", "mimo-7d9f8c6b5", "mimo-7d9f8c6b5-x2k9p", "mimo-cart-5c6d7-abcde", "mimo-0", "mimo-0-1"]) expect(ofRelease(n, "mimo")).toBe(true);
  });
  it("drops a sibling release that shares the prefix", () => {
    expect(ofRelease("mimo-v2-5", "mimo")).toBe(false);
    expect(ofRelease("mimo-v2-5-7d9f8c6b5-x2k9p", "mimo")).toBe(false);
    expect(ofRelease("mimox", "mimo")).toBe(false);
  });
  it("keeps any pod the status lists", () => {
    expect(ofRelease("odd-name", "mimo", ["odd-name"])).toBe(true);
  });
  it("counts warnings", () => {
    expect(warnings([{ type: "Warning" }, { type: "Normal" }, { type: "Warning" }])).toBe(2);
  });
});

describe("defaultContainer", () => {
  it("picks a crashing app container before a healthy sidecar", () => {
    expect(defaultContainer([{ name: "reload", state: "running", ready: true }, { name: "cart", state: "waiting", restartCount: 193 }])).toBe("cart");
  });
  it("else the first running app container, skipping init", () => {
    expect(defaultContainer([{ name: "init", init: true, state: "terminated" }, { name: "engine", state: "waiting" }, { name: "side", state: "running" }])).toBe("side");
    expect(defaultContainer([{ name: "init", init: true, state: "running" }, { name: "engine", state: "waiting" }])).toBe("engine");
    expect(defaultContainer([])).toBe("");
  });
});
