import { describe, expect, it } from "vitest";
import type { ObjectResult, Plan, ReleaseStatus, Run } from "@swiss/lib/api";
import {
  age,
  detailPath,
  installSteps,
  modelLine,
  parseTab,
  releaseState,
  revisionRows,
  rowState,
  showSLO,
  swissLinks,
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
  it("calls a row without a status unknown", () => {
    expect(rowState({}).key).toBe("unknown");
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
  it("is noPods when the release exists but nothing is scheduled", () => {
    expect(releaseState(status({ ready: 0, total: 0 })).key).toBe("noPods");
  });
});

describe("tabs", () => {
  it("drops SLO and plan when the release has neither", () => {
    expect(visibleTabs({ slo: false, plan: false })).toEqual(["overview", "instances", "resources", "check", "versions", "runs"]);
  });
  it("falls back to the overview for a tab this release does not have", () => {
    const tabs = visibleTabs({ slo: false, plan: true });
    expect(parseTab("slo", tabs)).toBe("overview");
    expect(parseTab(null, tabs)).toBe("overview");
    expect(parseTab("versions", tabs)).toBe("versions");
  });
  it("shows SLO only for an applied plan with SLO turned on in the form layer", () => {
    const plan = { layers: { form: { sloRequirement: { enabled: true } } } } as unknown as Plan;
    expect(showSLO(status({ planStatus: { phase: "applied" } }), plan)).toBe(true);
    expect(showSLO(status({ planStatus: { phase: "applying" } }), plan)).toBe(false);
    expect(showSLO(status({ planStatus: { phase: "applied" } }), { layers: {} } as unknown as Plan)).toBe(false);
  });
});

describe("paths", () => {
  it("puts the namespace in the query and leaves the default tab out", () => {
    expect(detailPath("qwen 3", "ai-ns")).toBe("qwen%203/details?namespace=ai-ns");
    expect(detailPath("q", "ns", "versions")).toBe("q/details?namespace=ns&tab=versions");
  });
  it("points the write paths at swiss's wizards", () => {
    const l = swissLinks("/swiss");
    expect(l.upgrade("ns", "r")).toBe("/swiss/upgrade/ns/r");
    expect(l.rollback("ns", "r", 2)).toBe("/swiss/upgrade/ns/r?rollback=2");
    expect(l.runs("ns", "r")).toBe("/swiss/runs?namespace=ns&release=r");
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
  it("reports a routed release with its backends and route", () => {
    const steps = installSteps(status(), route({ ready: true }) as never, {});
    expect(steps[2]).toEqual({ key: "route", state: "ok", detail: "ready", params: { n: 2, route: "/qwen/" } });
  });
  it("calls a deleted ModelRoute bad", () => {
    expect(installSteps(status(), route({ missing: true }) as never, {})[2]!.state).toBe("bad");
  });
});

describe("age", () => {
  it("reads seconds, minutes and hours", () => {
    expect(age(45)).toBe("45s");
    expect(age(720)).toBe("12m");
    expect(age(3 * 3600 + 7 * 60)).toBe("3h7m");
  });
});
