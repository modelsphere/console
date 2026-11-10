import { describe, expect, it } from "vitest";
import type { Input, SiteProfile } from "./api";
import { fillTemplate, inputProblem, inputRows, setInputOverrides } from "./inputs";

const master: Input = {
  path: "storageKVOffload.mooncake.master",
  title: "Mooncake master",
  pattern: "[^\\s:/]+:[0-9]+",
  example: "mooncake-master.example:50051",
};
const port: Input = { path: "service.port", title: "Port", type: "integer", example: 8000 };
const site = (inputs: Record<string, string | number | boolean>): SiteProfile => ({
  name: "prod",
  model: { pathTemplate: "/models/{{name}}" },
  inputs,
});

describe("fillTemplate", () => {
  it("fills the placeholders swissd fills", () => {
    expect(fillTemplate("/data/{{org}}/{{name}}/{{model}}:{{hf}}", "zai-org/GLM-5.3", "glm-5.3")).toBe("/data/zai-org/GLM-5.3/glm-5.3:zai-org/GLM-5.3");
  });
  it("gives up where swissd refuses", () => {
    expect(fillTemplate("/x/{{release}}", "a/b", "m")).toBeUndefined();
    expect(fillTemplate("/x/{{name}}", "", "m")).toBeUndefined();
    expect(fillTemplate("/x/{{model}}", "", "m")).toBe("/x/m");
  });
});

describe("inputRows", () => {
  it("prefills the site's answer, its template filled for this model", () => {
    expect(inputRows([master], site({ [master.path]: "mc-{{model}}:50051" }), "zai-org/GLM-5.3", "glm-5.3")).toEqual([
      { input: master, answer: "mc-glm-5.3:50051", from: "site" },
    ]);
    expect(inputRows([port], site({ [port.path]: 8050 }), "a/b", "m")[0].answer).toBe("8050");
  });
  it("falls back to the input's default, and leaves an input with none for the deployer", () => {
    const tuned = { ...master, default: "tuned:1" };
    expect(inputRows([tuned], site({}), "a/b", "m")).toEqual([{ input: tuned, answer: "tuned:1", from: "variant" }]);
    expect(inputRows([tuned], site({ [master.path]: "site:1" }), "a/b", "m")[0].from).toBe("site");
    expect(inputRows([{ ...port, default: 8000 }], site({}), "a/b", "m")[0].answer).toBe("8000");
    expect(inputRows([master], undefined, "a/b", "m")).toEqual([{ input: master }]);
  });
  it("shows an upgrade the release's own answer over the site's", () => {
    const release = { storageKVOffload: { mooncake: { master: "mine:1" } } };
    expect(inputRows([master], site({ [master.path]: "site:1" }), "a/b", "m", release)[0]).toEqual({ input: master, answer: "mine:1", from: "release" });
  });
});

describe("inputProblem", () => {
  it("checks a typed answer the way swissd will", () => {
    expect(inputProblem(master, "")).toBeUndefined();
    expect(inputProblem(master, "mc:50051")).toBeUndefined();
    expect(inputProblem(master, "no-port")).toBe("must match [^\\s:/]+:[0-9]+");
    expect(inputProblem(port, "80.5")).toBe("a whole number");
    expect(inputProblem({ ...port, type: "boolean" }, "yes")).toBe("true or false");
  });
});

describe("setInputOverrides", () => {
  it("sends only typed answers, typed, beside the other overrides in a section", () => {
    const overrides: Record<string, unknown> = { storageKVOffload: { enabled: true }, service: "dropped" };
    setInputOverrides(overrides, [master, port, { ...master, path: "unset.here" }], {
      [master.path]: " mc:50051 ",
      [port.path]: "8050",
      "unset.here": "  ",
    });
    expect(overrides).toEqual({
      storageKVOffload: { enabled: true, mooncake: { master: "mc:50051" } },
      service: { port: 8050 },
    });
  });
});
