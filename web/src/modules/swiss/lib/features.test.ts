import { describe, expect, it } from "vitest";
import { featureUnsupported } from "./features";

describe("featureUnsupported", () => {
  it("is nothing from the first release with it, where a range or an unknown version is the newest", () => {
    for (const v of ["0.9.1", "0.9.26", "1.0.0", ">=0.7.1", undefined]) expect(featureUnsupported("cache", "sglang", v)).toBeUndefined();
  });

  it("names the first release for an older chart", () => {
    expect(featureUnsupported("cache", "sglang", "0.9.0")).toEqual({ chart: "sglang", since: "0.9.1" });
    expect(featureUnsupported("cache", "sglang", "0.8.30")).toEqual({ chart: "sglang", since: "0.9.1" });
  });

  it("is a chart without it for an empty entry, an unlisted chart or an unknown feature", () => {
    expect(featureUnsupported("cache", "vllm", "0.8.22")).toEqual({ chart: "vllm" });
    expect(featureUnsupported("cache", "tgi", "1.0.0")).toEqual({ chart: "tgi" });
    expect(featureUnsupported("lora", "sglang", "0.9.26")).toEqual({ chart: "sglang" });
  });
});
