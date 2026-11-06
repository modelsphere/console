import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AutoscaleState, ObjectResult } from "@swiss/lib/api";
import { ReleaseObjects } from "@swiss/components/ReleaseObjects";

const slo: ObjectResult = {
  ref: { apiVersion: "inference.modelsphere.dev/v1alpha1", kind: "LLMSLORequirement", namespace: "models", name: "glm" },
  live: { generation: 1, spec: { serviceId: "glm", minimumDeployment: { value: 1 }, maximumDeployment: { value: 6 } } },
};

function render(autoscale: AutoscaleState, objects = [slo]) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c.setQueryData(["objects", "models", "glm"], { objects });
  c.setQueryData(["autoscaling", "models", "glm"], autoscale);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <ReleaseObjects namespace="models" release="glm" />
    </QueryClientProvider>,
  );
  c.clear();
  return html;
}

describe("SLO card PD autoscaling", () => {
  it("shows the pass as the card's state and the step in its body", () => {
    const html = render({
      namespace: "models",
      release: "glm",
      enabled: true,
      current: 2,
      want: 3,
      decision: 3,
      outcome: "scaled-up",
      lastEvaluated: new Date().toISOString(),
      lastScaled: new Date().toISOString(),
    });
    expect(html).toContain('title="PD autoscaling">scaled up<');
    expect(html).toContain("PD autoscaling</div>");
    expect(html).toMatch(/2\s*→\s*3/);
    expect(html).toContain("Last scaled");
  });

  it("shows a pdengine pass's engines per slice and decision", () => {
    const pd = { current: { prefill: 2, decode: 1 }, want: { prefill: 3, decode: 1 }, decision: { prefill: 3, decode: 1 } };
    const html = render({ namespace: "models", release: "glm", enabled: true, current: 1, want: 1, decision: 1, outcome: "scaled-up", pd });
    expect(html).toContain("Engines");
    expect(html).toMatch(/2P1D\s*→\s*3P1D/);
    expect(html).toMatch(/·\s*3P1D/);

    const steady = render({ namespace: "models", release: "glm", enabled: true, current: 1, want: 1, decision: 1, outcome: "unchanged", pd: { ...pd, want: pd.current, decision: pd.current } });
    expect(steady).toContain(">2P1D<");
    expect(steady).not.toContain("→");

    const plain = render({ namespace: "models", release: "glm", enabled: true, current: 2, want: 2, decision: 2, outcome: "unchanged" });
    expect(plain).not.toContain("Engines");
  });

  it("names a hold", () => {
    const held = render({ namespace: "models", release: "glm", enabled: true, current: 2, decision: 4, outcome: "held", hold: "role not ready" });
    expect(held).toContain(">held<");
    expect(held).toContain("role not ready");
  });

  it("keeps the pass when the LLMSLORequirement cannot be read", () => {
    const unreadable = { ...slo, live: undefined, error: "forbidden" };
    const html = render({ namespace: "models", release: "glm", enabled: true, current: 2, outcome: "held", hold: "release failed" }, [unreadable]);
    expect(html).toContain("forbidden");
    expect(html).toContain("release failed");
  });

  it("adds nothing for a release that is not autoscaling", () => {
    const html = render({ namespace: "models", release: "glm", enabled: false, current: 1 });
    expect(html).not.toContain("PD autoscaling");
  });
});
