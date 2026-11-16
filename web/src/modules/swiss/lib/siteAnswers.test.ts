import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { withSiteAnswers } from "./siteAnswers";

const profile = `# the lab cluster
name: lab
model:
  pathTemplate: /models/{{name}} # one per repo
`;

describe("withSiteAnswers", () => {
  it("adds the answers under inputs, keeping the comments and every other line", () => {
    const out = withSiteAnswers(profile, [{ key: "storageKVOffload.mooncake.master", value: "mc:1" }, { key: "service.port", value: 8050 }]);
    expect(out).toContain("# the lab cluster");
    expect(out).toContain("# one per repo");
    expect(parse(out)).toEqual({
      name: "lab",
      model: { pathTemplate: "/models/{{name}}" },
      inputs: [
        { key: "storageKVOffload.mooncake.master", value: "mc:1" },
        { key: "service.port", value: 8050 },
      ],
    });
  });
  it("replaces an answer and keeps the others", () => {
    const out = withSiteAnswers(`${profile}inputs:\n  - key: a.b\n    value: old # site-wide\n  - key: c.d\n    value: kept\n`, [{ key: "a.b", value: "new" }]);
    expect(parse(out).inputs).toEqual([{ key: "a.b", value: "new" }, { key: "c.d", value: "kept" }]);
    expect(out).toContain("# site-wide");
  });
  it("fills an empty inputs section", () => {
    expect(parse(withSiteAnswers(`${profile}inputs:\n`, [{ key: "a.b", value: true }])).inputs).toEqual([{ key: "a.b", value: true }]);
  });
  it("adds a key with brackets as a plain string", () => {
    const key = "volumes.[name=draft-model].hostPath.path";
    expect(parse(withSiteAnswers(profile, [{ key, value: "/data/x" }])).inputs).toEqual([{ key, value: "/data/x" }]);
  });
  it("refuses a document that does not parse", () => {
    expect(() => withSiteAnswers("name: [", [{ key: "a.b", value: 1 }])).toThrow();
  });
});
