import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvironmentField } from "./EnvironmentField";

describe("EnvironmentField", () => {
  it("displays the configured value as read-only, while still allowing selection and copying", () => {
    const html = renderToStaticMarkup(
      createElement(EnvironmentField, { label: "Gateway", value: "openresty" }),
    );
    expect(html).toContain('value="openresty"');
    expect(html).toContain('readOnly=""');
    expect(html).not.toContain('disabled=""');
  });

  it("displays explanatory text for an unset optional value without binding it to form state", () => {
    const html = renderToStaticMarkup(
      createElement(EnvironmentField, {
        label: "Hostname",
        emptyText: "Not configured",
      }),
    );
    expect(html).toContain('value="Not configured"');
    expect(html).toContain('readOnly=""');
    expect(html).not.toMatch(/\sname=/);
  });
});
