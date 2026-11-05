import { describe, expect, it } from "vitest";
import { serviceRelationship } from "./service-relationship";
import type { ServiceAssignment, ServiceOwner } from "@swiss/lib/api";

const owner: ServiceOwner = { apiVersion: "canary.modelsphere.dev/v1alpha1", kind: "LLMCanary", namespace: "models", name: "experiment", uid: "parent", verified: true };
const assignment: ServiceAssignment = { ...owner, role: "arm", arm: "candidate" };

describe("service relationship actions", () => {
 it("keeps independent services writable and owned services under their owner", () => {
  expect(serviceRelationship({ canaryState: "standalone" })).toMatchObject({ owned: false, assignmentLocked: false, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "owned", assignedTo: assignment })).toMatchObject({ owned: true, referenced: false, adaptiveOnly: false });
 });
 it("permits only adaptive upgrades of verified referenced arms", () => {
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: assignment })).toMatchObject({ assignmentLocked: true, adaptiveOnly: true });
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, role: "production", arm: undefined } })).toMatchObject({ assignmentLocked: false, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "referenced", assignedTo: { ...assignment, verified: false } })).toMatchObject({ assignmentLocked: true, adaptiveOnly: false });
  expect(serviceRelationship({ canaryState: "referenced" })).toMatchObject({ assignmentLocked: true, adaptiveOnly: false });
 });
 it("keeps compatibility with servers that expose only parent identities", () => {
  expect(serviceRelationship({}).state).toBe("standalone");
  expect(serviceRelationship({ managedBy: owner }).state).toBe("owned");
  expect(serviceRelationship({ assignedTo: assignment }).state).toBe("referenced");
 });
});
