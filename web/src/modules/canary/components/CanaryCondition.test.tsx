import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Condition, Phase } from "../types";
import { CanaryCondition } from "./CanaryCondition";

const render = (condition: Condition, phase: Phase = "Provisioning") =>
  renderToStaticMarkup(<CanaryCondition condition={condition} phase={phase} />);

describe("Canary condition presentation", () => {
  it("treats Degraded=False as healthy and Degraded=True as a failure", () => {
    const healthy = render({ type: "Degraded", status: "False", reason: "NoIssues", message: "no degradation detected" });
    expect(healthy).not.toContain('role="alert"');
    expect(healthy).toContain('data-variant="success"');
    const failed = render({ type: "Degraded", status: "True", reason: "ProvisionFailed", message: "chart could not be fetched" }, "Failed");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("chart could not be fetched");
  });

  it.each(["ArmsNotReady", "ProxyNotReady"])("presents %s as progress without an error", (reason) => {
    const html = render({ type: "Provisioned", status: "False", reason, message: "waiting" });
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('data-variant="secondary"');
  });

  it("retains failed condition diagnostics", () => {
    const html = render({ type: "TrafficProgrammed", status: "False", reason: "WriteFailed", message: "route permission denied" }, "Failed");
    expect(html).toContain('role="alert"');
    expect(html).toContain("route permission denied");
  });
});
