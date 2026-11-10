import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrafficEditor, canAdjustTraffic, validTrafficWeights } from "./TrafficEditor";
import { CanaryProvider } from "../lib/provider";
import { fixtureApi } from "../lib/api";
import type { Experiment } from "../types";

const experiment = {
  id: "exp", uid: "uid", state: "Running", cleanup: "pending",
  canary: { metadata: { generation: 2 }, spec: { traffic: { production: 100, canary: 0 }, route: { enabled: true } },
    status: { phase: "Serving", observedGeneration: 2, conditions: [{ type: "TrafficProgrammed", status: "True" }] } },
} as Experiment;
const render = (e: Experiment, canWrite = true) => renderToStaticMarkup(<CanaryProvider api={fixtureApi} canWrite={canWrite}><TrafficEditor experiment={e} /></CanaryProvider>);

describe("live traffic editing", () => {
  it.each([["100", "0", true], ["90", "10", true], ["0", "100", true], ["1", "3", true], ["0", "0", false], ["", "10", false], ["-1", "10", false], ["1.1", "2", false], ["Infinity", "1", false], ["1000001", "1", false]])("validates %s:%s", (production, canary, valid) => {
    expect(validTrafficWeights(String(production), String(canary))).toBe(valid);
  });
  it("shows the form only to writers of observed running experiments", () => {
    expect(render(experiment)).toContain("Apply weights");
    expect(render(experiment, false)).not.toContain("Apply weights");
    expect(canAdjustTraffic({ ...experiment, state: "Stopping" }, true)).toBe(false);
    expect(canAdjustTraffic({ ...experiment, stopAt: new Date().toISOString() }, true)).toBe(false);
    expect(canAdjustTraffic({ ...experiment, canary: { ...experiment.canary, status: { ...experiment.canary.status, observedGeneration: 1 } } }, true)).toBe(false);
  });
  it("shows pending changes and audit history to readers without enabling edits", () => {
    const e: Experiment = { ...experiment, trafficChanges: [{ id: "change", from: { production: 100, canary: 0 }, to: { production: 90, canary: 10 }, requestedAt: "2026-10-22T00:00:00Z", requestedBy: "writer", expectedGeneration: 2, status: "applying" }] };
    const html = render(e, false);
    expect(html).toContain("100:0 → 90:10");
    expect(html).toContain("Applying");
    expect(html).toContain("writer");
    expect(html).not.toContain("Apply weights");
  });
});
