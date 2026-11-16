import { describe, expect, it } from "vitest";
import { canaryLocales } from "./locales";

describe("Chinese North Star terminology", () => {
  it("uses North Star and group terminology throughout the Canary UI", () => {
    const text = JSON.stringify(canaryLocales.zh);
    expect(canaryLocales.zh.create.title).toBe("新建北极星实验");
    expect(text).not.toContain("金丝雀");
    expect(text).not.toContain("臂");
  });
});
