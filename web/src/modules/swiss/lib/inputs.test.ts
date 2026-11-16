import { describe, expect, it } from "vitest";
import type { Input, SiteProfile } from "./api";
import { fillTemplate, inputAnnotations, inputError, inputProblem, inputRows, inputsAnswered, INPUTS_ANNOTATION, parseAnswer, parseInputRecords, releaseInputState, rememberable, setInputOverrides, siteSaves, answerText } from "./inputs";

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
      { input: master, answer: "mc-glm-5.3:50051", from: "site", site: { answer: "mc-glm-5.3:50051", written: "mc-{{model}}:50051" } },
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
  it("carries an upgrade's release answer for prefill, falling back only to the site's", () => {
    const release = { storageKVOffload: { mooncake: { master: "mine:1" } } };
    expect(inputRows([master], site({ [master.key]: "site:1" }), "a/b", "m", undefined, release)[0]).toMatchObject({ input: master, release: "mine:1", answer: "site:1", from: "site" });
  });
  it("does not offer the prefilled release answer to the site profile", () => {
    const row = inputRows([master], site({}), "a/b", "m", undefined, { storageKVOffload: { mooncake: { master: "mine:1" } } })[0];
    expect(rememberable(row, "mine:1")).toBe(false);
    expect(rememberable(row, "other:1")).toBe(true);
  });
  it("lists the answers to pick between when there is more than one", () => {
    const tuned = { ...master, default: "tuned:1" };
    expect(inputRows([tuned], site({ [master.key]: "site:1" }), "a/b", "m")[0].choices).toEqual([
      { answer: "site:1", from: "site" },
      { answer: "tuned:1", from: "variant" },
    ]);
    const release = { storageKVOffload: { mooncake: { master: "mine:1" } } };
    expect(inputRows([tuned], site({ [master.key]: "site:1" }), "a/b", "m", undefined, release)[0].choices?.map((c) => c.from)).toEqual(["site", "variant"]);
    expect(inputRows([tuned], site({ [master.key]: "tuned:1" }), "a/b", "m")[0]).toEqual({ input: tuned, answer: "tuned:1", from: "site", site: { answer: "tuned:1", written: "tuned:1" } });
    expect(inputRows([master], site({ [master.key]: "site:1" }), "a/b", "m", { storageKVOffload: { mooncake: { master: "" } } })[0].choices).toBeUndefined();
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

describe("saving an answer to the site profile", () => {
  const row = { input: master, answer: "mc-m:1", from: "site" as const, site: { answer: "mc-m:1", written: "mc-{{model}}:1" } };
  it("takes a typed answer the input takes, and not the site's own", () => {
    expect(rememberable(row, "mine:1")).toBe(true);
    expect(rememberable(row, " mc-m:1 ")).toBe(false);
    expect(rememberable(row, "no-port")).toBe(false);
    expect(rememberable(row, "")).toBe(false);
    expect(rememberable({ input: master }, "mine:1")).toBe(true);
  });
  it("saves the ticked answers, typed as the input, naming what each replaces", () => {
    const rows = [row, { input: port }, { input: { ...master, key: "other.master" } }];
    const answers = { [master.key]: " mine:1 ", [port.key]: "8050", "other.master": "x:1" };
    expect(siteSaves(rows, answers, { [master.key]: true, [port.key]: true })).toEqual([
      { key: master.key, text: "mine:1", value: "mine:1", replaces: "mc-{{model}}:1" },
      { key: port.key, text: "8050", value: 8050, replaces: undefined },
    ]);
    expect(siteSaves(rows, { [master.key]: "mc-m:1" }, { [master.key]: true })).toEqual([]);
  });
});

describe("setInputOverrides", () => {
  it("sends only typed answers, typed, beside the other overrides in a section", () => {
    const overrides: Record<string, unknown> = { storageKVOffload: { enabled: true }, service: "dropped" };
    const written = setInputOverrides(overrides, [master, port, { ...master, key: "unset.here" }], {
      [master.key]: " mc:50051 ",
      [port.key]: "8050",
      "unset.here": "  ",
    });
    expect(overrides).toEqual({
      storageKVOffload: { enabled: true, mooncake: { master: "mc:50051" } },
      service: { port: 8050 },
    });
    expect(written).toEqual([
      { key: master.key, value: "mc:50051" },
      { key: port.key, value: 8050 },
    ]);
  });
  it("writes a field key's site answer and default, and records only typed", () => {
    const typedWins: Record<string, unknown> = {};
    expect(setInputOverrides(typedWins, [master], { [master.key]: " typed:1 " }, { site: { [master.key]: "site:1" } })).toEqual([
      { key: master.key, value: "typed:1" },
    ]);
    expect(typedWins).toEqual({ storageKVOffload: { mooncake: { master: "typed:1" } } });
    const fromSite: Record<string, unknown> = {};
    expect(setInputOverrides(fromSite, [master], {}, { site: { [master.key]: "site:1" } })).toEqual([]);
    expect(fromSite).toEqual({ storageKVOffload: { mooncake: { master: "site:1" } } });
    const fromDefault: Record<string, unknown> = {};
    expect(setInputOverrides(fromDefault, [{ ...master, default: "tuned:1" }], {})).toEqual([]);
    expect(fromDefault).toEqual({ storageKVOffload: { mooncake: { master: "tuned:1" } } });
  });
  it("writes a list key's effective answer into a copy of the variant list", () => {
    const arg: Input = { key: "extraArgs.[=--foo=1]", title: "t", example: "e", patcher: "pre-{value}" };
    const values = { extraArgs: ["--foo=1", "--bar"] };
    const before = structuredClone(values);
    const siteOnly: Record<string, unknown> = {};
    const wrote = setInputOverrides(siteOnly, [arg], {}, { values, site: { [arg.key]: "site" } });
    expect(siteOnly).toEqual({ extraArgs: ["pre-site", "--bar"] });
    expect(wrote).toEqual([]);
    expect(values).toEqual(before);
    const def: Record<string, unknown> = {};
    expect(setInputOverrides(def, [{ ...arg, patcher: undefined, default: "--foo=def" }], {}, { values })).toEqual([]);
    expect(def).toEqual({ extraArgs: ["--foo=def", "--bar"] });
    const typedList: Record<string, unknown> = {};
    expect(setInputOverrides(typedList, [arg], { [arg.key]: " mine " }, { values })).toEqual([{ key: arg.key, value: "mine" }]);
    expect(typedList).toEqual({ extraArgs: ["pre-mine", "--bar"] });
    const none: Record<string, unknown> = {};
    expect(setInputOverrides(none, [{ ...arg, patcher: undefined }], {}, { values })).toEqual([]);
    expect(none).toEqual({});
    const missed: Record<string, unknown> = {};
    expect(setInputOverrides(missed, [arg], { [arg.key]: "x" }, { values: { extraArgs: ["--bar"] } })).toEqual([]);
    expect(missed).toEqual({});
  });
});

describe("input annotations", () => {
  it("records written answers in variant order, typed, before the patcher", () => {
    const got = inputAnnotations([
      { key: "b", value: true },
      { key: "a", value: "mc" },
      { key: port.key, value: 8050 },
    ]);
    expect(got).toEqual({
      [INPUTS_ANNOTATION]: JSON.stringify([
        { key: "b", value: true },
        { key: "a", value: "mc" },
        { key: port.key, value: 8050 },
      ]),
    });
    expect(inputAnnotations([])).toBeUndefined();
    expect(inputAnnotations([], { replace: true })).toEqual({ [INPUTS_ANNOTATION]: "[]" });
  });
  it("parses defensively", () => {
    expect(parseInputRecords(undefined)).toEqual({ present: false, records: [] });
    expect(parseInputRecords("not json")).toEqual({ present: true, records: [] });
    expect(parseInputRecords('{"key":"a"}')).toEqual({ present: true, records: [] });
    expect(parseInputRecords('[{"key":"a","value":1},{"nope":true},{"key":"b","value":"s"},{"key":"d","value":null}]')).toEqual({
      present: true,
      records: [
        { key: "a", value: 1 },
        { key: "b", value: "s" },
      ],
    });
  });
});

describe("upgrade recheck", () => {
  const arg: Input = { key: "extraArgs.[=--foo=1]", title: "t", example: "e" };
  const broken: Input = { key: "volumes.[name=nope].path", title: "t", example: "e" };
  const inputs = [master, arg, broken];
  const values = { extraArgs: ["--foo=1", "--bar"], volumes: [{ name: "other", path: "/x" }] };
  const annotation = JSON.stringify([
    { key: master.key, value: "mine:1" },
    { key: "old.flag", value: "gone" },
    { key: arg.key, value: "yes" },
    { key: broken.key, value: "/old" },
  ]);

  it("marks a missing key deprecated and a list key that does not resolve broken", () => {
    const state = releaseInputState(inputs, values, undefined, annotation);
    expect(state.dropped).toEqual([
      { key: "old.flag", value: "gone", reason: "deprecated" },
      { key: broken.key, value: "/old", reason: "broken" },
    ]);
    expect(state.answers).toEqual({ [master.key]: "mine:1", [arg.key]: "yes" });
    expect(releaseInputState([{ ...master, key: "a.b" }], {}, undefined, JSON.stringify([{ key: "a.b", value: "mine" }])).dropped).toEqual([]);
    expect(releaseInputState([master], undefined, { storageKVOffload: { mooncake: { master: "form:1" } } }, undefined).answers).toEqual({ [master.key]: "form:1" });
    expect(releaseInputState([arg], values, { extraArgs: ["--foo=1"] }, undefined).answers).toEqual({});
  });


  it("shows a recorded answer over the form layer, and not a broken one", () => {
    const rows = inputRows(inputs, site({}), "a/b", "m", values, { storageKVOffload: { mooncake: { master: "form:1" } }, extraArgs: ["yes"] }, annotation);
    expect(rows[0].release).toBe("mine:1");
    expect(rows[1].release).toBe("yes");
    expect(rows[2].release).toBeUndefined();
  });

  it("a cleared prefilled answer falls back to the site's and leaves the annotation", () => {
    const layer: Record<string, unknown> = {};
    expect(setInputOverrides(layer, [master], { [master.key]: "  " }, { site: { [master.key]: "site:1" } })).toEqual([]);
    expect(layer).toEqual({ storageKVOffload: { mooncake: { master: "site:1" } } });
  });

  it("neither writes nor records an answer the variant no longer declares", () => {
    const layer: Record<string, unknown> = {};
    expect(setInputOverrides(layer, [master], { [master.key]: "mine:1", "gone.key": "old" })).toEqual([{ key: master.key, value: "mine:1" }]);
    expect(layer).toEqual({ storageKVOffload: { mooncake: { master: "mine:1" } } });
  });

  it("reads a patcher back to the answer", () => {
    const input: Input = { key: "extraArgs.[^=--flag=]", title: "t", example: "/m", patcher: "--flag={value}" };
    expect(inputRows([input], site({}), "a/b", "m", { extraArgs: ["--flag=/models/draft", "--x"] })[0]).toMatchObject({ answer: "/models/draft", from: "variant" });
    expect(inputRows([{ ...input, patcher: "nope-{value}-tail" }], site({}), "a/b", "m", { extraArgs: ["--flag=/models/draft"] })[0].answer).toBeUndefined();
  });
});

describe("input answers", () => {
  it("reads a typed answer as the YAML tab does", () => {
    expect(parseAnswer("mc.svc:50051")).toBe("mc.svc:50051");
    expect(parseAnswer("8000")).toBe(8000);
    expect(parseAnswer("-1")).toBe(-1);
    expect(parseAnswer("true")).toBe(true);
    expect(parseAnswer("false")).toBe(false);
    expect(parseAnswer('"8000"')).toBe("8000");
    expect(parseAnswer('"true"')).toBe("true");
    expect(parseAnswer('"quoted"')).toBe('"quoted"');
    expect(parseAnswer("")).toBe("");
  });
  it("shows an answer so it reads back the same", () => {
    for (const v of ["mc-{{model}}.svc:50051", 8000, true, "8000", "false", '"quoted"', ""]) expect(parseAnswer(answerText(v))).toBe(v);
    expect(answerText("8000")).toBe('"8000"');
  });
});
