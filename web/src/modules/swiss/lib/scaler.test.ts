import { describe, expect, it } from "vitest";
import type { Condition } from "@swiss/lib/api";
import { scalerHealth, type ScalerHealth } from "@swiss/lib/scaler";

const c = (type: string, status: Condition["status"], reason?: string): Condition => ({ type, status, reason });

describe("scalerHealth", () => {
  it.each<{ name: string; conditions?: Condition[]; want: ScalerHealth }>([
    {
      name: "Ready False is failing with its reason",
      conditions: [c("Ready", "False", "TargetWriteFailed")],
      want: { kind: "failing", reason: "TargetWriteFailed" },
    },
    {
      name: "Ready True and ScalingDeferred RolloutInProgress is deferred",
      conditions: [c("Ready", "True", "Synced"), c("ScalingDeferred", "True", "RolloutInProgress")],
      want: { kind: "deferred", reason: "RolloutInProgress" },
    },
    {
      name: "Ready True and ScalingDeferred NotDeferred is ok",
      conditions: [c("Ready", "True", "Synced"), c("ScalingDeferred", "False", "NotDeferred")],
      want: { kind: "ok" },
    },
    {
      name: "no Ready and ScalingDeferred NotDeferred is ok",
      conditions: [c("ScalingDeferred", "False", "NotDeferred")],
      want: { kind: "ok" },
    },
    {
      name: "no Ready and DecisionAvailable False is failing",
      conditions: [c("DecisionAvailable", "False", "DecisionUnavailable")],
      want: { kind: "failing", reason: "DecisionUnavailable" },
    },
    {
      name: "no Ready and ScalingDeferred ScaleDownSettling is deferred",
      conditions: [c("ScalingDeferred", "True", "ScaleDownSettling")],
      want: { kind: "deferred", reason: "ScaleDownSettling" },
    },
    {
      name: "Ready True wins over DecisionAvailable False",
      conditions: [c("Ready", "True", "Synced"), c("DecisionAvailable", "False", "DecisionUnavailable")],
      want: { kind: "ok" },
    },
    {
      name: "AbleToScale False is failing with its reason",
      conditions: [c("AbleToScale", "False", "TargetNotFound")],
      want: { kind: "failing", reason: "TargetNotFound" },
    },
    {
      name: "Ready False outranks AbleToScale",
      conditions: [c("Ready", "False", "DecisionUnavailable"), c("AbleToScale", "False", "TargetWriteFailed")],
      want: { kind: "failing", reason: "DecisionUnavailable" },
    },
    {
      name: "AbleToScale True with RolloutInProgress is deferred",
      conditions: [c("Ready", "True", "Synced"), c("AbleToScale", "True", "RolloutInProgress")],
      want: { kind: "deferred", reason: "RolloutInProgress" },
    },
    {
      name: "AbleToScale True with ScaleDownSettling is deferred",
      conditions: [c("Ready", "True", "Synced"), c("AbleToScale", "True", "ScaleDownSettling")],
      want: { kind: "deferred", reason: "ScaleDownSettling" },
    },
    {
      name: "AbleToScale True with Synced is ok",
      conditions: [c("Ready", "True", "Synced"), c("AbleToScale", "True", "Synced")],
      want: { kind: "ok" },
    },
    {
      name: "AbleToScale True with DeferralTimedOut is ok",
      conditions: [c("Ready", "True", "Synced"), c("AbleToScale", "True", "DeferralTimedOut")],
      want: { kind: "ok" },
    },
    {
      name: "AbleToScale wins over a leftover ScalingDeferred",
      conditions: [c("AbleToScale", "True", "Synced"), c("ScalingDeferred", "True", "RolloutInProgress")],
      want: { kind: "ok" },
    },
    {
      name: "no Ready and ScalingDeferred DeferralTimedOut is ok",
      conditions: [c("ScalingDeferred", "False", "DeferralTimedOut")],
      want: { kind: "ok" },
    },
    {
      name: "no conditions is ok",
      want: { kind: "ok" },
    },
  ])("$name", ({ conditions, want }) => {
    expect(scalerHealth(conditions ? { conditions } : {})).toEqual(want);
  });
});
