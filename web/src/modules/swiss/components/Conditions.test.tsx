import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { Condition } from "@swiss/lib/api";
import { Conditions } from "@swiss/components/ReleaseObjects";

const able = (status: Condition["status"]): Condition => ({ type: "AbleToScale", status, reason: "ScaleDownStabilized" });
const active: Condition = { type: "ScalingActive", status: "True", reason: "MetricsAvailable" };

// The dot is the rounded-full span immediately before the condition type.
function dotClass(html: string, type: string): string {
  const at = html.indexOf(`>${type}<`);
  const marks = [...html.slice(0, at).matchAll(/class="([^"]*rounded-full[^"]*)"/g)];
  return marks.at(-1)?.[1] ?? "";
}

describe("Conditions", () => {
  it("colors a warned condition bg-warning and leaves the others alone", () => {
    const conditions = [able("True"), active];
    const warned = renderToString(<Conditions conditions={conditions} warn={["AbleToScale"]} />);
    expect(dotClass(warned, "AbleToScale")).toContain("bg-warning");
    expect(dotClass(warned, "ScalingActive")).not.toContain("bg-warning");

    const plain = renderToString(<Conditions conditions={conditions} />);
    expect(dotClass(plain, "AbleToScale")).toContain("bg-success");
    expect(dotClass(plain, "AbleToScale")).not.toContain("bg-warning");

    // warn is checked before neutral, so a listed type stays yellow even when neutral would mute it.
    const both = renderToString(<Conditions conditions={conditions} warn={["AbleToScale"]} neutral={["AbleToScale"]} />);
    expect(dotClass(both, "AbleToScale")).toContain("bg-warning");
    expect(dotClass(both, "AbleToScale")).not.toContain("bg-muted-foreground");
  });
});
