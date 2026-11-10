import { describe, expect, it } from "vitest";
import type { Input, SiteProfile } from "./api";
import { fillTemplate, inputError, inputProblem, inputRows, inputsAnswered, setInputOverrides } from "./inputs";

const master: Input = {
  key: "storageKVOffload.mooncake.master",
  title: "Mooncake master",
  pattern: "[^\\s:/]+:[0-9]+",
  example: "mooncake-master.example:50051",
};
const port: Input = { key: "service.port", title: "Port", type: "integer", example: 8000 };
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
    expect(inputRows([master], site({ [master.key]: "mc-{{model}}:50051" }), "zai-org/GLM-5.3", "glm-5.3")).toEqual([
      { input: master, answer: "mc-glm-5.3:50051", from: "site" },
    ]);
    expect(inputRows([port], site({ [port.key]: 8050 }), "a/b", "m")[0].answer).toBe("8050");
  });
  it("falls back to the input's default, and leaves an input with none for the deployer", () => {
    const tuned = { ...master, default: "tuned:1" };
    expect(inputRows([tuned], site({}), "a/b", "m")).toEqual([{ input: tuned, answer: "tuned:1", from: "variant" }]);
    expect(inputRows([tuned], site({ [master.key]: "site:1" }), "a/b", "m")[0].from).toBe("site");
    expect(inputRows([{ ...port, default: 8000 }], site({}), "a/b", "m")[0].answer).toBe("8000");
    const values = { storageKVOffload: { mooncake: { master: "tuned:1" } } };
    expect(inputRows([master], site({}), "a/b", "m", values)).toEqual([{ input: master, answer: "tuned:1", from: "variant" }]);
    expect(inputRows([tuned], site({}), "a/b", "m", { storageKVOffload: { mooncake: { master: "base:1" } } })[0].answer).toBe("tuned:1");
    expect(inputRows([master], undefined, "a/b", "m")).toEqual([{ input: master }]);
  });
  it("shows an upgrade the release's own answer over the site's", () => {
    const release = { storageKVOffload: { mooncake: { master: "mine:1" } } };
    expect(inputRows([master], site({ [master.key]: "site:1" }), "a/b", "m", undefined, release)[0]).toEqual({ input: master, answer: "mine:1", from: "release" });
  });
});

describe("inputProblem", () => {
  it("checks an answer the way swissd will", () => {
    expect(inputProblem(master, "")).toBe("must match [^\\s:/]+:[0-9]+");
    expect(inputProblem({ ...master, pattern: undefined }, "")).toBeUndefined();
    expect(inputProblem(master, "mc:50051")).toBeUndefined();
    expect(inputProblem(master, "no-port")).toBe("must match [^\\s:/]+:[0-9]+");
    expect(inputProblem(port, "80.5")).toBe("a whole number");
    expect(inputProblem({ ...port, type: "boolean" }, "yes")).toBe("true or false");
  });
});

describe("inputError", () => {
  it("is required with no answer, typed or the row's", () => {
    expect(inputError({ input: master })).toBe("required");
    expect(inputError({ input: master }, "  ")).toBe("required");
    expect(inputError({ input: master, answer: "" })).toBe("required");
    expect(inputError({ input: port, answer: "" })).toBe("required");
    expect(inputError({ input: { ...master, pattern: undefined }, answer: "" })).toBeUndefined();
  });
  it("takes the row's answer when nothing is typed, and the typed one over it", () => {
    expect(inputError({ input: master, answer: "site:1" })).toBeUndefined();
    expect(inputError({ input: master }, "mc:50051")).toBeUndefined();
    expect(inputError({ input: master, answer: "site:1" }, "no-port")).toBe("invalid");
    expect(inputError({ input: master, answer: "no-port" })).toBe("invalid");
  });
  it("answers every row before a compose", () => {
    const rows = [{ input: master, answer: "site:1" }, { input: port }];
    expect(inputsAnswered(rows, {})).toBe(false);
    expect(inputsAnswered(rows, { [port.key]: "8000" })).toBe(true);
    expect(inputsAnswered([], {})).toBe(true);
  });
});

describe("setInputOverrides", () => {
  it("sends only typed answers, typed, beside the other overrides in a section", () => {
    const overrides: Record<string, unknown> = { storageKVOffload: { enabled: true }, service: "dropped" };
    setInputOverrides(overrides, [master, port, { ...master, key: "unset.here" }], {
      [master.key]: " mc:50051 ",
      [port.key]: "8050",
      "unset.here": "  ",
    });
    expect(overrides).toEqual({
      storageKVOffload: { enabled: true, mooncake: { master: "mc:50051" } },
      service: { port: 8050 },
    });
  });
});
