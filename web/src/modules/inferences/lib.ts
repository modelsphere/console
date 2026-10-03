// What the inferences pages decide, kept out of the components so it can be
// tested without rendering: which state a release is in, which tabs a release
// has, how revisions line up with the runs that made them, and the install
// track. Strings are i18n keys plus params; the components translate them.
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

export type Tone = "success" | "info" | "warning" | "error" | "muted";

export interface State {
  // "state.<key>" in the module's strings.
  key: string;
  tone: Tone;
  // Shown as-is when the key is "other": a helm status swiss has no word for.
  raw?: string;
}

// A list row knows helm's status and swiss's plan phase, not the pods: those
// cost a status read per row, which is what paging exists to avoid.
export function rowState(d: Pick<Deployment, "status" | "phase">): State {
  if (d.phase === "failed" || d.status === "failed") return { key: "failed", tone: "error" };
  if (d.phase === "applying" || d.status?.startsWith("pending")) return { key: "applying", tone: "info" };
  if (d.status === "uninstalling") return { key: "uninstalling", tone: "warning" };
  if (d.status === "deployed") return { key: "deployed", tone: "success" };
  if (!d.status) return { key: "unknown", tone: "muted" };
  return { key: "other", tone: "muted", raw: d.status };
}

// The detail page has the pods, so "deployed" splits into serving and loading:
// a cold load takes 20-40 minutes and is not a failure.
export function releaseState(s: ReleaseStatus): State {
  const p = s.planStatus;
  if (!s.exists && !p) return { key: "notInstalled", tone: "muted" };
  if (p?.phase === "failed" || s.helmStatus === "failed") return { key: "failed", tone: "error" };
  if (p?.phase === "applying" || s.helmStatus?.startsWith("pending")) return { key: "applying", tone: "info" };
  if (!s.exists) return { key: "notInstalled", tone: "muted" };
  if (s.total === 0) return { key: "noPods", tone: "warning" };
  if (s.ready < s.total) return { key: "loading", tone: "warning" };
  return { key: "serving", tone: "success" };
}

export const TABS = ["overview", "instances", "resources", "check", "slo", "versions", "runs", "plan"] as const;
export type Tab = (typeof TABS)[number];

// The SLO tab is there when swiss's own page shows the SLO card: the plan is
// applied and the operator turned SLO on. The plan tab needs a plan, which an
// untracked release does not have.
export function visibleTabs(opts: { slo: boolean; plan: boolean }): Tab[] {
  return TABS.filter((t) => (t === "slo" ? opts.slo : t === "plan" ? opts.plan : true));
}

// A tab in the URL that this release does not have (an old link, SLO turned
// off since) falls back to the overview rather than an empty page.
export function parseTab(raw: string | null, visible: readonly Tab[]): Tab {
  return visible.find((t) => t === raw) ?? "overview";
}

// Copied from swiss's DeploymentDetail, where it is not exported: the form layer
// is what the operator set, and compose writes sloRequirement.enabled there
// explicitly, so a missing key is off rather than the chart's default.
export function sloEnabled(plan?: Plan): boolean {
  const raw = plan?.layers?.form?.sloRequirement;
  if (!raw || typeof raw !== "object") return false;
  return (raw as { enabled?: boolean }).enabled === true;
}

export function showSLO(status: ReleaseStatus, plan?: Plan): boolean {
  return status.planStatus?.phase === "applied" && sloEnabled(plan);
}

// Module-relative, for useModulePath: "<release>/details?namespace=<ns>[&tab=…]".
export function detailPath(release: string, namespace: string, tab?: Tab): string {
  const q = new URLSearchParams({ namespace });
  if (tab && tab !== "overview") q.set("tab", tab);
  return `${encodeURIComponent(release)}/details?${q}`;
}

const enc = encodeURIComponent;

// The write paths stay swiss's wizards for now; these are the absolute paths to
// them under swiss's mount point.
export const swissLinks = (base: string) => ({
  catalog: `${base}/catalog`,
  upgrade: (ns: string, release: string) => `${base}/upgrade/${enc(ns)}/${enc(release)}`,
  rollback: (ns: string, release: string, revision: number) =>
    `${base}/upgrade/${enc(ns)}/${enc(release)}?rollback=${revision}`,
  runs: (ns: string, release: string) => `${base}/runs?namespace=${enc(ns)}&release=${enc(release)}`,
});

// "qwen3 v1.2 · h100x1": the model line under a release name.
export function modelLine(m: { model?: string; version?: string; variant?: string }): string {
  if (!m.model) return "";
  return [m.model + (m.version ? ` v${m.version}` : ""), m.variant].filter(Boolean).join(" · ");
}

export interface RevisionRow extends Revision {
  // The run that left the release at this revision, when the log has one: it
  // carries what helm's revision list does not -- when, who and why.
  run?: Run;
}

// Newest revision first. A revision several runs report (an apply that changed
// nothing records the revision it found) takes the latest of them.
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
  // "steps.<key>.label" in the module's strings.
  key: "applied" | "pods" | "route" | "scaler";
  state: StepState;
  // "steps.<key>.<detail>" and its params.
  detail: string;
  params?: Record<string, string | number>;
}

type Picked<Spec, Status> = { result?: ObjectResult; spec?: Spec; status?: Status };

// The install track from swiss's DeploymentDetail (where these are private),
// with the words moved to the module's strings. Applied says what helm did;
// the other three say what the controllers made of it -- a release can be
// applied with ready pods and still serve nobody, because nothing routed to it.
export function installSteps(
  s: ReleaseStatus,
  route: Picked<ModelRouteSpec, ModelRouteStatus>,
  scaler: Picked<LLMScalerSpec, LLMScalerStatus>,
): Step[] {
  return [appliedStep(s, s.planStatus), podsStep(s), routeStep(route), scalerStep(scaler)];
}

function appliedStep(s: ReleaseStatus, p?: PlanStatus): Step {
  const key = "applied";
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

function scalerStep({ result, status }: Picked<LLMScalerSpec, LLMScalerStatus>): Step {
  const key = "scaler";
  if (!result) return { key, state: "off", detail: "none" };
  if (result.error) return { key, state: "wait", detail: "unreadable" };
  if (result.missing) return { key, state: "bad", detail: "deleted" };
  const failing = status?.conditions?.find((c) => c.status === "False");
  if (failing) return { key, state: "bad", detail: "failing", params: { reason: failing.reason || failing.type } };
  const cur = status?.currentReplicas;
  const want = status?.desiredReplicas;
  if (cur === undefined) return { key, state: "wait", detail: "noDecision" };
  if (want !== undefined && want !== cur) return { key, state: "wait", detail: "scaling", params: { cur, want } };
  return { key, state: "ok", detail: "steady", params: { n: cur } };
}

// "45s", "12m", "3h7m": a pod's age, read at a glance.
export function age(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}
