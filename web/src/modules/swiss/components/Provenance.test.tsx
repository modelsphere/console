import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plan } from "@swiss/lib/api";
import { Provenance } from "./Provenance";

it("keeps owner-defined runtime layers visible after standard configuration layers", () => {
  const plan: Plan = { apiVersion: "v1", release: { name: "demo", namespace: "models" }, source: { model: "demo", variant: "default" }, chart: { name: "vllm", version: "1.0.0" }, engine: "vllm", profile: "test", hash: "h", layers: { "owner-policy": { scaler: { enabled: false } }, autoscale: { replicaCount: 2 }, form: { replicaCount: 1 } } };
  const html = renderToStaticMarkup(<Provenance plan={plan}/>);
  expect(html).toContain("owner-policy.yaml");
  expect(html).toContain("owner-defined runtime policy");
  expect(html).toContain("replicaCount from PD autoscaling; applied last");
  expect(html.indexOf("form.yaml")).toBeLessThan(html.indexOf("autoscale.yaml"));
  expect(html.indexOf("autoscale.yaml")).toBeLessThan(html.indexOf("owner-policy.yaml"));
});
