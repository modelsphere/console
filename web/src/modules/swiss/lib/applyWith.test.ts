import { describe, expect, it } from "vitest";
import type { LLMServiceInfo } from "@swiss/lib/api";
import { installMethod, llmsvcBlock } from "./applyWith";

const ready: LLMServiceInfo = { served: true, available: true, applyWith: "helm", newInstalls: "helm" };

describe("llmsvcBlock", () => {
  it("says why llmsvc cannot take an install", () => {
    expect(llmsvcBlock(undefined, "v2")).toBe("unserved");
    expect(llmsvcBlock({ ...ready, served: false, available: false }, "v2")).toBe("unserved");
    expect(llmsvcBlock({ ...ready, available: false }, "v2")).toBe("unavailable");
    expect(llmsvcBlock({ served: true, applyWith: "helm", newInstalls: "helm" }, "v2")).toBe("unavailable");
    expect(llmsvcBlock(ready, "v1")).toBe("schema");
    expect(llmsvcBlock(ready, undefined)).toBe("schema");
    expect(llmsvcBlock(ready, "v2")).toBeUndefined();
  });
});

describe("installMethod", () => {
  it("defaults to the plan ConfigMap", () => {
    expect(installMethod(undefined, ready, "v2")).toBe("helm");
  });
  it("follows a site profile set to llmsvc", () => {
    expect(installMethod(undefined, { ...ready, applyWith: "llmsvc", newInstalls: "llmsvc" }, "v2")).toBe("llmsvc");
  });
  it("takes the pick over the profile", () => {
    expect(installMethod("llmsvc", ready, "v2")).toBe("llmsvc");
    expect(installMethod("helm", { ...ready, applyWith: "llmsvc", newInstalls: "llmsvc" }, "v2")).toBe("helm");
  });
  it("falls back to helm when llmsvc is blocked", () => {
    expect(installMethod("llmsvc", ready, "v1")).toBe("helm");
    expect(installMethod("llmsvc", { ...ready, available: false }, "v2")).toBe("helm");
  });
});
