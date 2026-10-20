import { describe, expect, it } from "vitest";
import { bumpVersion, freeId, idProblem, markedWritable, newModelFiles, nextVersion, setTopLevel, topLevel, variantFrom } from "./catalog-write-lib";

const FILE = `apiVersion: catalog.swiss/v2
kind: Variant
model: kimi
id: sglang-tp8 # the file's name
version: "1.0.2"
engine: sglang
values:
  version: nested
`;

describe("topLevel", () => {
  it("reads a top-level scalar, unquoted and without its comment", () => {
    expect(topLevel(FILE, "id")).toBe("sglang-tp8");
    expect(topLevel(FILE, "version")).toBe("1.0.2");
  });

  it("ignores nested keys and missing ones", () => {
    expect(topLevel("values:\n  id: x\n", "id")).toBeUndefined();
    expect(topLevel(FILE, "servedName")).toBeUndefined();
  });
});

describe("setTopLevel", () => {
  it("keeps the quoting, the comment and every other byte", () => {
    const out = setTopLevel(FILE, "id", "sglang-tp4");
    expect(out).toBe(FILE.replace("id: sglang-tp8 #", "id: sglang-tp4 #"));
    expect(setTopLevel(FILE, "version", "1.0.3")).toBe(FILE.replace('"1.0.2"', '"1.0.3"'));
  });

  it("fills a key left empty", () => {
    expect(setTopLevel("id:\nkind: Variant\n", "id", "a")).toBe("id: a\nkind: Variant\n");
  });

  it("appends a key the file does not have", () => {
    expect(setTopLevel("kind: Variant", "id", "a")).toBe('kind: Variant\nid: "a"\n');
  });
});

describe("versions", () => {
  it("suggests what catalog-server would", () => {
    expect(nextVersion("1.0.2")).toBe("1.0.3");
    expect(nextVersion("2.1.0-rc.1")).toBe("2.1.0");
    expect(nextVersion("latest")).toBeUndefined();
  });

  it("bumps the file's own version, not a nested one", () => {
    const out = bumpVersion(FILE);
    expect(topLevel(out, "version")).toBe("1.0.3");
    expect(out).toContain("  version: nested");
  });
});

describe("a new model", () => {
  it("names its variant as its default, and the variant its model", () => {
    const { metadata, variant } = newModelFiles("m", "v");
    expect(topLevel(metadata, "name")).toBe("m");
    expect(topLevel(metadata, "defaultVariant")).toBe("v");
    expect([topLevel(variant, "model"), topLevel(variant, "id"), topLevel(variant, "version")]).toEqual(["m", "v", "1.0.0"]);
  });

  it("copies an existing variant's settings under the new names", () => {
    const { variant } = newModelFiles("m", "v", FILE);
    expect([topLevel(variant, "model"), topLevel(variant, "id"), topLevel(variant, "version"), topLevel(variant, "engine")]).toEqual(["m", "v", "1.0.0", "sglang"]);
  });
});

describe("a new variant", () => {
  it("is a copy under a new id at 1.0.0", () => {
    const out = variantFrom(FILE, "sglang-tp4");
    expect(topLevel(out, "id")).toBe("sglang-tp4");
    expect(topLevel(out, "version")).toBe("1.0.0");
    expect(topLevel(out, "engine")).toBe("sglang");
  });

  it("gets an id no variant has", () => {
    expect(freeId("a", ["a"])).toBe("a-copy");
    expect(freeId("a", ["a", "a-copy", "a-copy-2"])).toBe("a-copy-3");
  });

  it("needs a file name catalog-server takes, and one not in use", () => {
    expect(idProblem("sglang-tp4", ["a"])).toBeUndefined();
    expect(idProblem("metadata", [])).toBe("invalid");
    expect(idProblem("-a", [])).toBe("invalid");
    expect(idProblem("", [])).toBe("invalid");
    expect(idProblem("a", ["a"])).toBe("taken");
  });
});

it("reads the profile's writable mark for one catalog", () => {
  const profile = { catalogs: [{ name: "internal", url: "u", writable: true }, { name: "public", url: "u" }] };
  expect(markedWritable(profile, "internal")).toBe(true);
  expect(markedWritable(profile, "public")).toBe(false);
  expect(markedWritable(profile, "absent")).toBe(false);
  expect(markedWritable(undefined, "internal")).toBe(false);
});
