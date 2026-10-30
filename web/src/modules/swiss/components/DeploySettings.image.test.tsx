import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeploySettings, EMPTY } from "./DeploySettings";

const image = { catalog: "lmsysorg/sglang:v0.5.4", site: "ghcr.io/modelsphere/sglang:v0.5.4" };
const render = (img: string, pair = image) =>
  renderToStaticMarkup(<DeploySettings form={{ ...EMPTY, serviceId: "m", image: img }} onChange={() => {}} image={pair} />);
const pressed = (html: string, label: string) => new RegExp(`<button[^>]*aria-pressed="true"[^>]*>${label}<`).test(html);

describe("image override", () => {
  it("offers the site's mirror and the catalog's own image, marking the one in the field", () => {
    expect(pressed(render(image.site), "site mirror")).toBe(true);
    expect(pressed(render(image.catalog), "catalog")).toBe(true);
    const typed = render("ghcr.io/me/sglang:rc1");
    expect(typed).toContain(">site mirror<");
    expect(pressed(typed, "site mirror") || pressed(typed, "catalog")).toBe(false);
  });

  it("offers nothing to pick between without a mirror", () => {
    expect(render(image.catalog, { catalog: image.catalog, site: image.catalog })).not.toContain(">site mirror<");
  });
});
