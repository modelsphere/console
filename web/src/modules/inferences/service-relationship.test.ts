import { describe, expect, it } from "vitest";
import { serviceRelationship } from "./service-relationship";
import type { ServiceAssignment, ServiceOwner } from "@swiss/lib/api";

const owner: ServiceOwner = { apiVersion: "canary.modelsphere.dev/v1alpha1", kind: "LLMCanary", namespace: "models", name: "experiment", uid: "parent", verified: true };
const assignment: ServiceAssignment = { ...owner, role: "arm", arm: "baseline" };

describe("serviceRelationship", () => {
 it("locks owned services and adaptive-only referenced arms while keeping verified production editable", () => {
  expect(serviceRelationship({ canaryState: "standalone" })).toMatchObject({ owned: false, assignmentLocked: false, uninstallLocked: false, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "owned", assignedTo: assignment })).toMatchObject({ owned: true, referenced: false, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "owned", managedBy: { ...owner, verified: false } })).toMatchObject({ owned: true });
  expect(serviceRelationship({ canaryState: "standalone", managedBy: owner })).toMatchObject({ owned: false, assignmentLocked: false });
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: assignment })).toMatchObject({ assignmentLocked: true, adaptiveOnly: true });
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, role: "production", arm: undefined } })).toMatchObject({ assignmentLocked: false, uninstallLocked: true, adaptiveOnly: false, productionReferenced: true });
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, verified: false } })).toMatchObject({ assignmentLocked: true, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "referenced" })).toMatchObject({ assignmentLocked: true, adaptiveOnly: false });
 });
});

it("allows full referenced arm edits only with the mutable policy from the extension", () => {
 expect(serviceRelationship({ canaryState: "referenced", assignedTo: assignment }, { mutable: true })).toMatchObject({ assignmentLocked: false, adaptiveOnly: false, uninstallLocked: true });
 expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, verified: false } }, { mutable: true })).toMatchObject({ assignmentLocked: true });
 expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, role: "production", arm: undefined } }, { mutable: true })).toMatchObject({ productionReferenced: true, adaptiveOnly: false });
});
