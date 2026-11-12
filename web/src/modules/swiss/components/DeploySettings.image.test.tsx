import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeploySettings, EMPTY } from "./DeploySettings";

const image = { catalog: "lmsysorg/sglang:v0.5.4", site: "ghcr.io/modelsphere/sglang:v0.5.4" };
const render = (img: string, pair = image) =>
  renderToStaticMarkup(<DeploySettings form={{ ...EMPTY, serviceId: "m", images: { image: img } }} onChange={() => {}} image={pair} />);
const selected = (html: string, label: string) => new RegExp(`<option[^>]*selected[^>]*>${label}</option>`).test(html);

describe("image override", () => {
  it("offers the site's mirror and the catalog's own image, marking the one in the field", () => {
    expect(selected(render(image.site), "site mirror")).toBe(true);
    expect(selected(render(image.catalog), "catalog original")).toBe(true);
    const typed = render("ghcr.io/me/sglang:rc1");
    expect(typed).toContain(">site mirror<");
    expect(typed).toContain(">catalog original<");
    expect(selected(typed, "site mirror") || selected(typed, "catalog original")).toBe(false);
    expect(selected(typed, "custom")).toBe(true);
  });

  it("offers nothing to pick between without a mirror", () => {
    expect(render(image.catalog, { catalog: image.catalog, site: image.catalog })).not.toContain(">site mirror<");
  });

  it("lists a discovered slot by its values path, with the effective value as the placeholder", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={{ ...EMPTY, serviceId: "m" }}
        onChange={() => {}}
        image={image}
        slots={[{ path: "image", kind: "map", value: image.site }, { path: "hangWatcher.image", kind: "map", value: "example.com/hang:1" }]}
      />,
    );
    expect(html).toContain("hangWatcher.image");
    expect(html).toContain('placeholder="example.com/hang:1"');
    expect(html).toContain(`placeholder="${image.site}"`);
    expect(html).not.toContain("set by");
  });
});
