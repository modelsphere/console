import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { extensions } from "./registry";
import { resourceDataQueryKey, useResourceActions } from "./queries";

const extension = { plugin: "example", id: "policy", resourceType: "service", load: () => ({ canEdit: true }) };
const original = { assignedTo: "first" };

function Policy({ resource = original }: { resource?: unknown }) {
  const evaluate = useResourceActions("service", [{ resourceKey: "ns/name", resource }]);
  return <span>{evaluate("ns/name", resource, "slo") || "editable"}</span>;
}

function renderPolicy(client: QueryClient, resource: unknown = original) {
  return renderToStaticMarkup(<QueryClientProvider client={client}><Policy resource={resource} /></QueryClientProvider>);
}

afterEach(() => {
  extensions.data.length = 0;
  extensions.actions.length = 0;
});

describe("resource action queries", () => {
  it("does not reuse policy data after the resource's assignment changes", () => {
    extensions.data.push(extension);
    extensions.actions.push({ plugin: "example", id: "slo", resourceType: "service", action: "slo", evaluate: ({ data }) => (data.policy as { canEdit?: boolean })?.canEdit ? false : "unavailable" });
    const client = new QueryClient();
    client.setQueryData(resourceDataQueryKey(extension, "service", "ns/name", original), { canEdit: true });
    expect(renderPolicy(client)).toContain("editable");
    expect(renderPolicy(client, { assignedTo: "second" })).toContain("unavailable");
    client.clear();
  });

  it("withholds stale successful data when the refresh has failed", () => {
    extensions.data.push(extension);
    extensions.actions.push({ plugin: "example", id: "slo", resourceType: "service", action: "slo", evaluate: ({ data }) => data.policy ? false : "unavailable" });
    const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
    const queryKey = resourceDataQueryKey(extension, "service", "ns/name", original);
    client.setQueryData(queryKey, { canEdit: true });
    client.getQueryCache().find({ queryKey })!.setState({ status: "error", error: new Error("offline") });
    expect(renderPolicy(client)).toContain("unavailable");
    client.clear();
  });
});
