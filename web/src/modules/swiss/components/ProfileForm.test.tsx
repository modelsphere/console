import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileForm } from "./ProfileForm";

describe("variant inputs", () => {
  const render = (inputs: Parameters<typeof ProfileForm>[0]["value"]["inputs"]) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileForm value={{ name: "prod", model: { pathTemplate: "/m/{{name}}" }, inputs }} onChange={() => {}} />
      </QueryClientProvider>,
    );

  it("lists the profile's answers as rows, a string that reads as a number quoted", () => {
    const html = render([{ key: "a.master", value: "mc:1" }, { key: "a.port", value: 8000 }, { key: "a.tag", value: "8000" }]);
    expect(html).toContain("Variant inputs");
    for (const v of ["a.master", "mc:1", "a.port", "8000", "a.tag", "&quot;8000&quot;"]) expect(html).toContain(`value="${v}"`);
  });

  it("preserves list order including numeric keys and flags missing or duplicate keys", () => {
    const html = render([{ key: "a.master", value: "mc:1" }, { key: "0", value: "zero" }, { key: "", value: "1" }, { key: "a.master", value: "mc:2" }]);
    expect(html.indexOf('value="a.master"')).toBeLessThan(html.indexOf('value="0"'));
    expect(html).toContain("Every input needs a unique key; swissd will refuse the profile otherwise.");
  });
});
