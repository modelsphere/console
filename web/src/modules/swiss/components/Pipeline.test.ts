import { describe, expect, it } from "vitest";
import { dialogFlags } from "./Pipeline";

describe("dialogFlags", () => {
  it("sends the page's flags alone when the dialog adds nothing", () => {
    expect(dialogFlags(undefined, false, false)).toEqual({ dryRun: undefined, apply: undefined });
    expect(dialogFlags({ createNamespace: true }, false, false)).toEqual({ dryRun: { createNamespace: true }, apply: { createNamespace: true } });
  });

  it("puts skip on the dry run and the apply, and force on the apply only", () => {
    expect(dialogFlags({ createNamespace: true }, true, true)).toEqual({
      dryRun: { createNamespace: true, skipSchemaValidation: true },
      apply: { createNamespace: true, skipSchemaValidation: true, forceConflicts: true },
    });
    expect(dialogFlags(undefined, false, true)).toEqual({ dryRun: undefined, apply: { forceConflicts: true } });
  });
});
