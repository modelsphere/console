import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SiteProfile as SiteProfileType } from "@swiss/lib/api";
import { ModuleProvider } from "@/shell/module";
import { SiteProfile } from "./SiteProfile";

const module = { id: "swiss", title: "s", basePath: "/swiss", pages: [] };

function renderProfile(profile: SiteProfileType) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  c.setQueryData(["profile"], { source: "models/site-profile", profile, yaml: "" });
  return renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <ModuleProvider module={module}>
        <MemoryRouter initialEntries={["/site-profile"]}>
          <SiteProfile />
        </MemoryRouter>
      </ModuleProvider>
    </QueryClientProvider>,
  );
}

describe("SiteProfile inputs", () => {
  it("renders the inputs array entries including empty string values", () => {
    const html = renderProfile({
      name: "prod",
      model: { pathTemplate: "/m/{{name}}" },
      inputs: [
        { key: "volumes.[name=draft-model].hostPath.path", value: "/data/models/{{name}}" },
        { key: "service.port", value: 8000 },
        { key: "a.tag", value: "8000" },
        { key: "empty.arg", value: "" },
      ],
    });
    expect(html).toContain("volumes.[name=draft-model].hostPath.path");
    expect(html).toContain("/data/models/{{name}}");
    expect(html).toContain("service.port");
    expect(html).toContain("8000");
    expect(html).toContain("&quot;8000&quot;");
    expect(html).toContain("empty.arg");
    expect(html).not.toContain("[object Object]");
  });
});
