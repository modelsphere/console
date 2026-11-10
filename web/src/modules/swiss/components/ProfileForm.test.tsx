import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileForm } from "./ProfileForm";

describe("variant inputs", () => {
  it("lists the profile's answers as rows, a string that reads as a number quoted", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileForm value={{ name: "prod", model: { pathTemplate: "/m/{{name}}" }, inputs: { "a.master": "mc:1", "a.port": 8000, "a.tag": "8000" } }} onChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Variant inputs");
    for (const v of ["a.master", "mc:1", "a.port", "8000", "a.tag", "&quot;8000&quot;"]) expect(html).toContain(`value="${v}"`);
  });
});
