import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Boxes } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationLauncher } from "./ApplicationLauncher";
import { getLocale, setLocale } from "./i18n";
import type { ApplicationItem } from "./applications";

const locale = getLocale();
afterEach(() => setLocale(locale));

function render(items: ApplicationItem[], pathname = "/") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[pathname]}><ApplicationLauncher items={items} /></MemoryRouter>);
}

describe("application launcher", () => {
  it("does not show an empty control", () => {
    expect(render([])).toBe("");
  });

  it.each(["zh-CN", "en-US"] as const)("renders a localized accessible dialog trigger in %s", language => {
    setLocale(language);
    const html = render([{ id: "example/platform", ns: "example", scope: "platform", label: "Example", icon: Boxes, to: "/example", paths: ["/example"] }]);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(`aria-label="${language === "zh-CN" ? "应用" : "Applications"}"`);
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the current application while preserving the switcher's accessible name", () => {
    setLocale("en-US");
    const items: ApplicationItem[] = [
      { id: "console", ns: "shell", scope: "console", label: "Console", icon: Boxes, to: "/", paths: ["/"] },
      { id: "example/cluster", ns: "example", scope: "cluster", label: "Cluster Tools", icon: Boxes, to: "/example", paths: ["/example"] },
    ];
    expect(render(items, "/example/pods/42")).toContain('title="Applications: Cluster Tools"');
    expect(render(items, "/inferences")).toContain('title="Applications: Console"');
    expect(render(items, "/example")).toContain('aria-label="Applications: Cluster Tools"');
    expect(render(items, "/inferences")).toContain('aria-label="Applications: Console"');
  });
});
