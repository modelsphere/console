import { describe, expect, it } from "vitest";
import { findAt, isFieldKey, readAt, splitKey, writeAt } from "./inputKey";

const count = (key: string, values: unknown) => findAt(values, splitKey(key)).length;

describe("splitKey", () => {
  it("keeps a bracket whole and splits the rest on dots", () => {
    expect(splitKey("volumes.[name=draft.model].hostPath.path")).toEqual(["volumes", "[name=draft.model]", "hostPath", "path"]);
    expect(splitKey("a.b.c")).toEqual(["a", "b", "c"]);
    expect(isFieldKey("a.b.c")).toBe(true);
    expect(isFieldKey("volumes.0")).toBe(false);
    expect(isFieldKey("extraArgs.[=--foo]")).toBe(false);
  });
});

describe("findAt", () => {
  const volumes = {
    volumes: [
      { name: "draft", hostPath: { path: "/data/draft" } },
      { name: "cache", hostPath: { path: "/data/cache" } },
    ],
  };
  const args = { extraArgs: ["--foo=1", "--bar=2"] };

  it("matches one, zero, or several of each selector", () => {
    const key = "volumes.[name=draft].hostPath.path";
    expect(readAt(volumes, key)).toBe("/data/draft");
    expect(count(key, { volumes: [{ name: "cache", hostPath: { path: "/x" } }] })).toBe(0);
    expect(count(key, { volumes: [{ name: "draft", hostPath: { path: "/a" } }, { name: "draft", hostPath: { path: "/b" } }] })).toBe(2);
    expect(readAt({ volumes: [{ name: "a=b", path: "/x" }] }, "volumes.[name=a=b].path")).toBe("/x");

    expect(readAt(args, "extraArgs.[=--foo=1]")).toBe("--foo=1");
    expect(count("extraArgs.[=--foo=1]", { extraArgs: ["--bar=2"] })).toBe(0);
    expect(count("extraArgs.[=--foo=1]", { extraArgs: ["--foo=1", "--foo=1"] })).toBe(2);
    expect(readAt({ flags: [true, false] }, "flags.[=true]")).toBe("true");
    expect(readAt({ nums: [1, 2] }, "nums.[=1]")).toBe("1");

    const prefixed = { extraArgs: ["--speculative-draft-model-path=/models/draft", "--other=1"] };
    expect(readAt(prefixed, "extraArgs.[^=--speculative-draft-model-path=]")).toBe("--speculative-draft-model-path=/models/draft");
    expect(count("extraArgs.[^=--speculative-draft-model-path=]", { extraArgs: ["--other=1", 1] })).toBe(0);
    expect(count("extraArgs.[^=--p]", { extraArgs: ["--p/a", "--p/b"] })).toBe(2);

    expect(readAt({ items: ["a", "b"] }, "items.0")).toBe("a");
    expect(count("items.2", { items: ["a"] })).toBe(0);
    expect(count("rows.[name=x].cells.0", { rows: [{ name: "x", cells: ["a", "b"] }, { name: "x", cells: ["c"] }] })).toBe(2);

    expect(readAt({ labels: { "0": "a", "1": "b" } }, "labels.0")).toBe("a");
    expect(count("labels.2", { labels: { "0": "a" } })).toBe(0);
    expect(count("rows.[name=x].0", { rows: [{ name: "x", "0": "a" }, { name: "x", "0": "b" }] })).toBe(2);

    expect(readAt({ a: { b: { c: 1 } } }, "a.b.c")).toBe("1");
    expect(count("a.b.c", { a: {} })).toBe(0);
    expect(count("rows.[name=x].host", { rows: [{ name: "x", host: "a" }, { name: "x", host: "b" }] })).toBe(2);
  });

  it("does not answer a key that lands on a map or a list", () => {
    expect(readAt(volumes, "volumes.[name=draft]")).toBeUndefined();
    expect(readAt(volumes, "volumes.[name=draft].hostPath")).toBeUndefined();
    expect(readAt({ groups: [[1], [2]] }, "groups.0")).toBeUndefined();
    expect(readAt({ a: { b: null } }, "a.b")).toBeUndefined();
  });
});

describe("patcher", () => {
  const patcher = "--flag={value}";
  it("strips a value that fits and refuses one that does not", () => {
    expect(readAt({ a: "--flag=/models/draft" }, "a", patcher)).toBe("/models/draft");
    expect(readAt({ a: "--flag=/models/draft" }, "a", "--flag={value}.gguf")).toBeUndefined();
    expect(readAt({ a: "nope" }, "a", patcher)).toBeUndefined();
    expect(readAt({ a: 1 }, "a", patcher)).toBeUndefined();
    expect(readAt({ a: "--flag=" }, "a", patcher)).toBe("");
  });
  it("writes the template once, with the answer in the middle", () => {
    const layer: Record<string, unknown> = {};
    expect(writeAt(layer, {}, "a.b", "/models/draft", patcher)).toBe(true);
    expect(layer).toEqual({ a: { b: "--flag=/models/draft" } });
  });
});

describe("writeAt", () => {
  it("creates a missing dotted leaf and leaves the rest of the map", () => {
    const layer: Record<string, unknown> = { storageKVOffload: { enabled: true } };
    expect(writeAt(layer, {}, "storageKVOffload.mooncake.master", "mc:1")).toBe(true);
    expect(layer).toEqual({ storageKVOffload: { enabled: true, mooncake: { master: "mc:1" } } });
  });

  it("copies the variant list, patches the matched item, and does not mutate the variant", () => {
    const values = {
      volumes: [
        { name: "draft", hostPath: { path: "/data/draft" } },
        { name: "cache", hostPath: { path: "/data/cache" } },
      ],
    };
    const before = structuredClone(values);
    const layer: Record<string, unknown> = {};
    expect(writeAt(layer, values, "volumes.[name=draft].hostPath.path", "/new")).toBe(true);
    expect(writeAt(layer, values, "volumes.[name=cache].hostPath.path", "/c2")).toBe(true);
    expect(layer).toEqual({
      volumes: [
        { name: "draft", hostPath: { path: "/new" } },
        { name: "cache", hostPath: { path: "/c2" } },
      ],
    });
    expect(values).toEqual(before);
  });

  it("writes an index on a list and a numeric key on a map", () => {
    const list = { items: ["a", "b"] };
    const layer: Record<string, unknown> = {};
    expect(writeAt(layer, list, "items.0", "z")).toBe(true);
    expect(layer).toEqual({ items: ["z", "b"] });
    expect(list.items).toEqual(["a", "b"]);

    const map = { labels: { "0": "a", "1": "b" } };
    const out: Record<string, unknown> = {};
    expect(writeAt(out, map, "labels.0", "z")).toBe(true);
    expect(out).toEqual({ labels: { "0": "z" } });
    expect(map.labels["0"]).toBe("a");
  });

  it("writes nothing when a non-field key does not match exactly one primitive", () => {
    const values = { extraArgs: ["--foo=1", "--foo=1"] };
    const layer: Record<string, unknown> = {};
    expect(writeAt(layer, values, "extraArgs.[=--foo=1]", "x")).toBe(false);
    expect(writeAt(layer, { extraArgs: ["--bar"] }, "extraArgs.[=--foo=1]", "x")).toBe(false);
    expect(writeAt(layer, { volumes: [{ name: "draft", hostPath: {} }] }, "volumes.[name=draft]", "x")).toBe(false);
    expect(layer).toEqual({});
    expect(values.extraArgs).toEqual(["--foo=1", "--foo=1"]);
  });
});
