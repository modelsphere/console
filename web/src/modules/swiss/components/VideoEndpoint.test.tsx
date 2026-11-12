import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { videoExamples } from "./VideoEndpoint";
import { Endpoint } from "./Endpoint";
import type { ReleaseStatus } from "@swiss/lib/api";

const status = { release: "h3", namespace: "video", exists: true, revision: 1, pods: [], ready: 1, total: 1, route: "h3", url: "https://gw.example.com/h3" } as ReleaseStatus;

describe("videoExamples", () => {
  it("submits, polls and downloads on the route, with the key on all but the download", () => {
    const [submit, poll, download] = videoExamples(status).map((e) => e.curl);
    expect(submit).toContain("curl -X POST https://gw.example.com/h3/v2/video_generation");
    expect(submit).toContain('"model": "MiniMax-H3"');
    expect(submit).toContain('Authorization: Bearer $SWISS_API_KEY');
    expect(poll).toContain("https://gw.example.com/h3/v2/query/video_generation/$TASK_ID");
    expect(poll).toContain("Authorization");
    expect(download).toBe("curl -L https://gw.example.com/h3/v2/video_generation/$TASK_ID/content -o output.mp4");
  });

  it("uses the auth header the site declares", () => {
    expect(videoExamples({ ...status, authHeader: "X-Api-Key", authPrefix: "" })[0].curl).toContain('-H "X-Api-Key: $SWISS_API_KEY"');
  });
});

describe("Endpoint", () => {
  const render = (engine: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(["releasePlan", "video", "h3"], { engine, release: { name: "h3", namespace: "video" }, layers: {} });
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Endpoint namespace="video" release="h3" status={status} />
      </QueryClientProvider>,
    );
  };

  it("offers the job API and no chat checks for a video release", () => {
    const html = render("video");
    expect(html).toContain("/v2/video_generation");
    expect(html).not.toContain("/v1/chat/completions");
    expect(html).not.toContain("Health check");
    // The readiness probe stands in for the serving check.
    expect(html).toContain("Readiness check");
    expect(html).toContain("/readyz");
  });

  it("keeps the chat example and checks for an LLM release", () => {
    const html = render("sglang");
    expect(html).toContain("/v1/chat/completions");
    expect(html).toContain("Health check");
  });
});
