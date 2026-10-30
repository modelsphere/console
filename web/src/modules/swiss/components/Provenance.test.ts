import { describe, expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
import { layersOf } from "./Provenance";

const plan = (layers: Record<string, Record<string, unknown>>) => ({ layers }) as unknown as Plan;

describe("layersOf", () => {
  it("lists every layer the plan carries, in merge order, autoscale last of the known ones", () => {
    expect(layersOf(plan({ autoscale: { replicaCount: 5 }, form: {}, catalog: {} }))).toEqual(["catalog", "form", "autoscale"]);
  });

  it("keeps a layer it does not know, after the known ones", () => {
    expect(layersOf(plan({ zeta: {}, site: {}, alpha: {} }))).toEqual(["site", "alpha", "zeta"]);
    expect(layersOf({} as Plan)).toEqual([]);
  });
});
