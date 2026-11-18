import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { draftOf, draftProblem, editOf, VideoSLOCard } from "./VideoSLOCard";
import { sloPath, type ObjectResult } from "@swiss/lib/api";
import { jobSLOs } from "@swiss/lib/video";

const job = (serviceId: string, spec: Record<string, unknown> = {}): ObjectResult => ({
  ref: { apiVersion: "inference.modelsphere.dev/v1alpha1", kind: "JobSLORequirement", namespace: "video", name: serviceId },
  live: { spec: { serviceId, minimumDeployment: { type: "replica", value: 1 }, queue: { maxDepth: 5 }, ...spec } },
});
const objects = [
  job("h3-minimax-h3-server-ref2va", { queue: { maxDepth: 2 } }),
  job("h3-minimax-h3-server-fl2va", { maximumDeployment: { type: "replica", value: 4 } }),
  { ref: { apiVersion: "v1", kind: "LLMScaler", namespace: "video", name: "x" }, live: { spec: {} } },
];

describe("jobSLOs", () => {
  it("lists a video release's JobSLOs by the service id their objects carry", () => {
    expect(jobSLOs(objects).map((s) => [s.serviceId, s.pool])).toEqual([
      ["h3-minimax-h3-server-fl2va", "fl2va"],
      ["h3-minimax-h3-server-ref2va", "ref2va"],
    ]);
    expect(jobSLOs([job("custom")])[0].pool).toBeUndefined();
  });
});

describe("sloPath", () => {
  it("names the SLO object by serviceId, and keeps the release's own path without one", () => {
    expect(sloPath("video", "h3")).toBe("/api/releases/video/h3/slo");
    expect(sloPath("video", "h3", "h3-minimax-h3-server-fl2va")).toBe("/api/releases/video/h3/slo?serviceId=h3-minimax-h3-server-fl2va");
  });
});

describe("JobSLO edits", () => {
  const stored = { found: true, highPriority: false, minimumDeployment: { type: "replica", value: 1 }, queue: { maxDepth: 5, promql: "sum(h3_queue_tasks)" } };

  it("sends priority, min, a max only when given, and the queue depth", () => {
    const d = draftOf(stored);
    expect(d.maxValue).toBe("");
    expect(editOf(d)).toEqual({ highPriority: false, minimumDeployment: { type: "replica", value: 1 }, queue: { maxDepth: 5 } });
    expect(editOf({ ...d, maxValue: "6", maxDepth: "3", highPriority: true })).toEqual({
      highPriority: true,
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 6 },
      queue: { maxDepth: 3 },
    });
  });

  it("refuses a maximum below the minimum and anything that is not a whole number", () => {
    const d = draftOf(stored);
    expect(draftProblem({ ...d, minValue: "3", maxValue: "2" })).toMatch(/below/);
    expect(draftProblem({ ...d, maxDepth: "1.5" })).toMatch(/whole number/);
    expect(draftProblem(d)).toBeUndefined();
  });
});

describe("VideoSLOCard", () => {
  it("shows one section per pool, with queue bounds and no TTFT or OTPS", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(["objects", "video", "h3"], { objects });
    qc.setQueryData(["slo", "video", "h3", "h3-minimax-h3-server-fl2va"], { found: true, minimumDeployment: { type: "replica", value: 1 }, maximumDeployment: { type: "replica", value: 4 }, queue: { maxDepth: 5, promql: "sum(q)" } });
    qc.setQueryData(["slo", "video", "h3", "h3-minimax-h3-server-ref2va"], { found: true, minimumDeployment: { type: "replica", value: 1 }, queue: { maxDepth: 2 } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <VideoSLOCard namespace="video" release="h3" canEdit />
      </QueryClientProvider>,
    );
    for (const want of ["FL2VA pool", "Ref2VA pool", "autoscaled", "not scaled: no maximum", "Max queue depth", "empty = autoscaling off"]) expect(html).toContain(want);
    // The queue query is the chart's internals, not something a user sets.
    for (const hidden of ["TTFT", "OTPS", "Queue query", "sum(q)"]) expect(html).not.toContain(hidden);
  });

  it("says how to get SLOs on a release that has none", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(["objects", "video", "h3"], { objects: [] });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <VideoSLOCard namespace="video" release="h3" canEdit />
      </QueryClientProvider>,
    );
    expect(html).toContain("No JobSLORequirement");
  });
});
