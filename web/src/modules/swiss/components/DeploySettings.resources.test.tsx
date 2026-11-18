import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploySettings, EMPTY } from "@swiss/components/DeploySettings";

describe("DeploySettings top-level resources", () => {
  it("renders chart/site resource defaults and custom overrides alongside the requested GPU resource", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={{
          ...EMPTY,
          serviceId: "m",
          resources: { requests: { cpu: "8" }, limits: {} },
          customResources: [{ key: "hugepages-2Mi", request: "", limit: "1Gi" }],
        }}
        onChange={() => {}}
        gpuResources={["nvidia.com/gpu"]}
        resources={{
          requests: { cpu: "4", memory: "16Gi" },
          limits: { memory: "32Gi" },
          gpu: { resource: "nvidia.com/gpu", gpus: "2" },
        }}
      />,
    );
    expect(html).toContain("Resources");
    expect(html).toContain("nvidia.com/gpu");
    expect(html).toContain(">2<");
    expect(html).toContain('aria-label="cpu request"');
    expect(html).toContain('placeholder="4"');
    expect(html).toContain('value="8"');
    expect(html).toContain('aria-label="memory request"');
    expect(html).toContain('placeholder="16Gi"');
    expect(html).toContain('aria-label="memory limit"');
    expect(html).toContain('placeholder="32Gi"');
    expect(html).toContain('value="hugepages-2Mi"');
    expect(html).toContain('value="1Gi"');
  });
});
