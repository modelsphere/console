import type {
  Deployment,
  LLMScalerSpec,
  LLMScalerStatus,
  ModelRouteSpec,
  ModelRouteStatus,
  ObjectResult,
  Plan,
  PlanStatus,
  ReleaseStatus,
  Revision,
  Run,
} from "@swiss/lib/api";
import { isUninstalling } from "@swiss/lib/phase";

export type Tone = "success" | "info" | "warning" | "error" | "muted";

export interface State {
  key: string;
  tone: Tone;
  raw?: string;
}

// A list row has no pod counts: those cost a status read per row.
export function rowState(d: Pick<Deployment, "status" | "phase">): State {
  // Ahead of failed and applying: a helm row can already have no release status
  // while its pods are still terminating.
  if (isUninstalling(d)) return { key: "uninstalling", tone: "warning" };
  if (d.phase === "failed" || d.status === "failed") return { key: "failed", tone: "error" };
  if (d.phase === "applying" || d.status?.startsWith("pending")) return { key: "applying", tone: "info" };
  if (d.status === "deployed") return { key: "applied", tone: "success" };
  if (!d.status) return { key: "unknown", tone: "muted" };
  return { key: "other", tone: "muted", raw: d.status };
}

export function releaseState(s: ReleaseStatus): State {
  if (isUninstalling(s)) return { key: "uninstalling", tone: "warning" };
  const p = s.planStatus;
  if (!s.exists && !p) return { key: "notInstalled", tone: "muted" };
  if (p?.phase === "failed" || s.helmStatus === "failed") return { key: "failed", tone: "error" };
  if (p?.phase === "applying" || s.helmStatus?.startsWith("pending")) return { key: "applying", tone: "info" };
  if (!s.exists) return { key: "notInstalled", tone: "muted" };
  if (s.total === 0) return { key: "noPods", tone: "warning" };
  if (s.ready < s.total) return stalled(s) ? { key: "stalled", tone: "error" } : { key: "loading", tone: "warning" };
  return { key: "serving", tone: "success" };
}

// A cold load takes 20-40 minutes; a pod still not ready after an hour is stuck.
export const STALL_SECONDS = 3600;

export function stalled(s: Pick<ReleaseStatus, "pods">): boolean {
  return s.pods.some((p) => !p.ready && p.ageSeconds > STALL_SECONDS);
}

export const TABS = ["overview", "instances", "logs", "events", "resources", "check", "versions", "runs", "plan"] as const;
export type Tab = (typeof TABS)[number];

export function visibleTabs(opts: { plan: boolean }): Tab[] {
  return TABS.filter((t) => (t === "plan" ? opts.plan : true));
}

export function parseTab(raw: string | null, visible: readonly Tab[]): Tab {
  return visible.find((t) => t === raw) ?? "overview";
}

// Copied from swiss's DeploymentDetail, where it is not exported.
export function sloEnabled(plan?: Plan): boolean {
  const raw = plan?.layers?.form?.sloRequirement;
  if (!raw || typeof raw !== "object") return false;
  return (raw as { enabled?: boolean }).enabled === true;
}

// Why editing the SLO is greyed out, or undefined when it can be edited: swiss's
// own page shows the SLO card for an applied plan with SLO on.
export function sloBlocked(status: ReleaseStatus, plan?: Plan): "off" | "pending" | undefined {
  if (!sloEnabled(plan)) return "off";
  if (status.planStatus?.phase !== "applied") return "pending";
  return undefined;
}

export function detailPath(release: string, namespace: string, tab?: Tab): string {
  const q = new URLSearchParams({ namespace });
  if (tab && tab !== "overview") q.set("tab", tab);
  return `${encodeURIComponent(release)}/details?${q}`;
}

export function modelLine(m: { model?: string; version?: string; variant?: string }): string {
  if (!m.model) return "";
  return [m.model + (m.version ? ` v${m.version}` : ""), m.variant].filter(Boolean).join(" · ");
}

export interface RevisionRow extends Revision {
  run?: Run;
}

// An apply that changed nothing records the revision it found, so a revision can have several runs.
export function revisionRows(revisions: Revision[], runs: Run[]): RevisionRow[] {
  const byRevision = new Map<number, Run>();
  for (const r of runs) {
    if (r.revision === undefined || r.error) continue;
    const seen = byRevision.get(r.revision);
    if (!seen || r.endedAt > seen.endedAt) byRevision.set(r.revision, r);
  }
  return [...revisions]
    .sort((a, b) => b.revision - a.revision)
    .map((rev) => ({ ...rev, run: byRevision.get(rev.revision) }));
}

export type StepState = "ok" | "wait" | "bad" | "off";
export interface Step {
  key: "applied" | "pods" | "route" | "scaler";
  state: StepState;
  detail: string;
  params?: Record<string, string | number>;
}

type Picked<Spec, Status> = { result?: ObjectResult; spec?: Spec; status?: Status };

// From swiss's DeploymentDetail, where these are private. objectsUnreadable: an
// older swissd has no /objects, and then the route and scaler are unknown, not absent.
export function installSteps(
  s: ReleaseStatus,
  route: Picked<ModelRouteSpec, ModelRouteStatus>,
  scaler: Picked<LLMScalerSpec, LLMScalerStatus>,
  objectsUnreadable = false,
): Step[] {
  if (objectsUnreadable) {
    return [
      appliedStep(s, s.planStatus),
      podsStep(s),
      { key: "route", state: "wait", detail: "unreadable" },
      { key: "scaler", state: "wait", detail: "unreadable" },
    ];
  }
  return [appliedStep(s, s.planStatus), podsStep(s), routeStep(route), scalerStep(scaler)];
}

function appliedStep(s: ReleaseStatus, p?: PlanStatus): Step {
  const key = "applied";
  if (isUninstalling(s)) return { key, state: "wait", detail: "uninstalling" };
  if (p?.phase === "failed" || s.helmStatus === "failed") return { key, state: "bad", detail: "failed" };
  if (p?.phase === "applying" || s.helmStatus?.startsWith("pending")) return { key, state: "wait", detail: "applying" };
  if (s.exists) return { key, state: "ok", detail: "revision", params: { n: s.revision } };
  return { key, state: "off", detail: "notInstalled" };
}

function podsStep(s: ReleaseStatus): Step {
  const key = "pods";
  if (s.total === 0) return { key, state: s.exists ? "wait" : "off", detail: "none" };
  return { key, state: s.ready < s.total ? "wait" : "ok", detail: "ready", params: { ready: s.ready, total: s.total } };
}

function routeStep({ result, spec, status }: Picked<ModelRouteSpec, ModelRouteStatus>): Step {
  const key = "route";
  if (!result) return { key, state: "off", detail: "none" };
  if (result.error) return { key, state: "wait", detail: "unreadable" };
  if (result.missing) return { key, state: "bad", detail: "deleted" };
  const params = { n: status?.backends ?? 0, route: spec?.nginx?.route ? `/${spec.nginx.route}/` : "" };
  return status?.ready ? { key, state: "ok", detail: "ready", params } : { key, state: "wait", detail: "notReady", params };
}

// AbleToScale=True reasons that hold a step. Synced and DeferralTimedOut are a normal scale.
const SCALE_HOLD_REASONS = new Set(["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"]);

function scalerStep({ result, status }: Picked<LLMScalerSpec, LLMScalerStatus>): Step {
  const key = "scaler";
  if (!result) return { key, state: "off", detail: "none" };
  if (result.error) return { key, state: "wait", detail: "unreadable" };
  if (result.missing) return { key, state: "bad", detail: "deleted" };
  // DecisionAvailable is a deprecated mirror of ScalingActive and the only condition operator 0.5.0 writes.
  const conditions = status?.conditions ?? [];
  const ofType = (type: string) => conditions.find((c) => c.type === type);
  const active = ofType("ScalingActive") ?? ofType("DecisionAvailable");
  const able = ofType("AbleToScale");

  const failing = able?.status === "False" ? able : active?.status === "False" ? active : undefined;
  if (failing) {
    const reason = failing.reason || failing.type;
    if (failing.message) return { key, state: "bad", detail: "failingMessage", params: { reason, message: failing.message } };
    return { key, state: "bad", detail: "failing", params: { reason } };
  }

  if (able?.status === "True" && able.reason && SCALE_HOLD_REASONS.has(able.reason)) {
    return { key, state: "wait", detail: "deferred", params: { reason: able.reason } };
  }

  const cur = status?.currentReplicas;
  const want = status?.desiredReplicas;
  if (cur === undefined) return { key, state: "wait", detail: "noDecision" };
  if (want !== undefined && want !== cur) return { key, state: "wait", detail: "scaling", params: { cur, want } };
  return { key, state: "ok", detail: "steady", params: { n: cur } };
}

export function age(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

// The server matches "<release>" and "<release>-*"; this narrows it to the names
// a release's chart gives (the cart deployment, ReplicaSet hashes, pod suffixes,
// LeaderWorkerSet indexes), so release "mimo" does not take "mimo-v2-5"'s events.
export function ofRelease(name: string, release: string, pods: readonly string[] = []): boolean {
  if (pods.includes(name)) return true;
  if (name !== release && !name.startsWith(`${release}-`)) return false;
  return /^(-cart)?(-[a-z0-9]{5,10}){0,2}(-\d+){0,2}$/.test(name.slice(release.length));
}

export function warnings(events: readonly { type: string }[]): number {
  return events.filter((e) => e.type === "Warning").length;
}

// The container worth reading first: an app container in trouble (restarted or
// not ready), else the first running one, else the first app container.
export function defaultContainer(cs: readonly { name: string; init?: boolean; state: string; ready?: boolean; restartCount?: number }[]): string {
  const app = cs.filter((c) => !c.init);
  return (app.find((c) => (c.restartCount ?? 0) > 0 && !c.ready) ?? app.find((c) => c.state === "running") ?? app[0] ?? cs[0])?.name ?? "";
}
