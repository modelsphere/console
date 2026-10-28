import { describe, expect, it } from "vitest";
import { rowPhase } from "./phase";

describe("rowPhase", () => {
  it("reads helm's and the operator's phases in swiss's words", () => {
    const cases: [string | undefined, ReturnType<typeof rowPhase>][] = [
      ["applied", "applied"],
      ["Applied", "applied"],
      ["failed", "failed"],
      ["Failed", "failed"],
      ["applying", "applying"],
      ["Applying", "applying"],
      ["Pending", "applying"],
      ["uninstalling", "uninstalling"],
      ["Deleting", "uninstalling"],
      ["Bogus", undefined],
      [undefined, undefined],
    ];
    for (const [raw, want] of cases) expect(rowPhase(raw), String(raw)).toBe(want);
  });
});
