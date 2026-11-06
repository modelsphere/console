import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverrideYaml } from "./OverrideYaml";
import en from "@/modules/inferences/locales/en-US.json";
import zh from "@/modules/inferences/locales/zh-CN.json";

const render = (value: string) => renderToStaticMarkup(<OverrideYaml value={value} onChange={() => {}} />);

describe("Override YAML in the form", () => {
  it("shows the overridden paths in a read-only box beside its edit button", () => {
    const html = render("replicaCount: 3\nimage:\n  tag: v2\n");
    expect(html).not.toContain("<textarea");
    expect(html).toMatch(/<input[^>]*readOnly[^>]*value="replicaCount, image.tag"|<input[^>]*value="replicaCount, image.tag"[^>]*readOnly/);
    expect(html).toMatch(/aria-label="(Edit|编辑)"/);
  });

  it("says when the overrides are not valid YAML", () => {
    const html = render("a: [");
    expect(html.includes(en.deploy.overrides.invalid) || html.includes(zh.deploy.overrides.invalid)).toBe(true);
  });
});

describe("YAML textarea", () => {
  it("draws the text highlighted under a transparent textarea holding it", async () => {
    const { YamlTextarea } = await import("./YamlTextarea");
    const html = renderToStaticMarkup(<YamlTextarea aria-label="final" value={"# chart\nreplicaCount: 2\n"} onChange={() => {}} />);
    expect(html).toMatch(/<textarea[^>]*>[\s\S]*replicaCount: 2[\s\S]*<\/textarea>/);
    expect(html).toContain('style="color:var(--code-comment)"># chart</span>');
    expect(html).toContain('style="color:var(--code-key)">replicaCount</span>');
  });
});

describe("key search", () => {
  it("is a search box, its matches listed only once typed into", async () => {
    const { KeySearch } = await import("./KeySearch");
    const html = renderToStaticMarkup(<KeySearch keys={[{ path: "image.tag", line: 2 }]} onJump={() => {}} />);
    expect(html).toMatch(/placeholder="(Search keys|搜索 key)"/);
    expect(html).not.toContain('role="listbox"');
  });
});
