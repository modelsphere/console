import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceOwnership } from "./ServiceOwnership";
import { extensions } from "@/extensions/registry";
import type { ServiceOwnerProps } from "@/extensions/types";

const original = [...extensions.serviceOwners];
afterEach(() => { extensions.serviceOwners = [...original]; });
const owner = { apiVersion: "example.test/v1", kind: "ServiceGroup", namespace: "models", name: "demo", uid: "u1", verified: true };

describe("optional service owner decorations", () => {
  it("shows safe ownership information without an extension or backend lookup", () => {
    extensions.serviceOwners = [];
    const html = renderToStaticMarkup(<ServiceOwnership owner={owner}/>);
    expect(html).toContain("ServiceGroup models/demo");
    expect(html).not.toContain("href=");
    expect(renderToStaticMarkup(<ServiceOwnership owner={{ ...owner, verified: false }}/>)).toContain("归属信息不一致");
  });
  it("uses only the registered GVK and passes the exact identity and display flags", () => {
    const component = ({ owner: o, compact, assigned }: ServiceOwnerProps) => <span>{o.uid}/{String(compact)}/{String(assigned)}</span>;
    extensions.serviceOwners = [{ apiVersion: owner.apiVersion, kind: owner.kind, component }];
    expect(renderToStaticMarkup(<ServiceOwnership owner={owner} compact assigned/>)).toContain("u1/true/true");
    expect(renderToStaticMarkup(<ServiceOwnership owner={{ ...owner, apiVersion: "example.test/v2" }}/>)).toContain("ServiceGroup models/demo");
  });
});
