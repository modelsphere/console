import { useState } from "react";
import { Link, useNavigate, useParams } from "@swiss/lib/host";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CircleCheck, CircleDashed, CircleX, Loader2, TriangleAlert } from "lucide-react";
import {
  api,
  deployApi,
  type LLMScalerSpec,
  type LLMScalerStatus,
  type ModelRouteSpec,
  type ModelRouteStatus,
  type ObjectResult,
  type Plan,
  type PlanStatus,
  type ReleaseStatus as Status,
} from "@swiss/lib/api";
import { Badge } from "@swiss/components/ui/badge";
import { Button } from "@swiss/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { Field, Input } from "@swiss/components/ui/input";
import { Provenance } from "@swiss/components/Provenance";
import { ReleaseObjects, pick, useReleaseObjects } from "@swiss/components/ReleaseObjects";
import { ReleaseStatus } from "@swiss/components/ReleaseStatus";
import { SLOCard } from "@swiss/components/SLOCard";
import { ErrorState, Loading } from "@swiss/components/States";
import { cn, timeAgo } from "@swiss/lib/utils";

export function DeploymentDetail() {
  const { namespace = "", release = "" } = useParams();
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });

  const status = useQuery({
    queryKey: ["status", namespace, release],
    queryFn: () => api.status(namespace, release),
    refetchInterval: 15_000,
  });
  // A release swiss did not deploy has no plan beside it. That is the untracked
  // row, and it is not an error here -- the page just shows less.
  const plan = useQuery({
    queryKey: ["releasePlan", namespace, release],
    queryFn: () => api.releasePlan(namespace, release),
    retry: false,
  });
  const objects = useReleaseObjects(namespace, release);

  if (status.isPending) return <Loading what={release} />;
  if (status.error) return <ErrorState what={release} error={status.error} />;

  const s = status.data;

  return (
    <div className="space-y-5">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> LLM deployments
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{release}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Badge variant="outline">{namespace}</Badge>{" "}
            {plan.data ? (
              <>
                {plan.data.source.model}
                {plan.data.source.version && ` v${plan.data.source.version}`} ·{" "}
                {plan.data.source.variant} · {plan.data.chart.name}-{plan.data.chart.version}
              </>
            ) : (
              <Badge variant="warning">untracked — no plan beside this release</Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Revisions are rows in the log now: an applied revision and the
              run that produced it are one event, and rolling back starts from
              the row that records it. */}
          <Link
            to={`/runs?namespace=${encodeURIComponent(namespace)}&release=${encodeURIComponent(release)}`}
          >
            <Button size="sm" variant="outline">
              History &amp; rollback
            </Button>
          </Link>
          {plan.data && (
            <Link
              to={`/upgrade/${encodeURIComponent(namespace)}/${encodeURIComponent(release)}`}
            >
              <Button size="sm" variant="outline">
                Upgrade
              </Button>
            </Link>
          )}
        </div>
      </div>

      <InstallStatus status={s} objects={objects.data?.objects} />

      <ReleaseObjects namespace={namespace} release={release} />

      {s.planStatus?.phase === "applied" && sloEnabled(plan.data) && (
        <SLOCard namespace={namespace} release={release} canEdit={!!cluster.data?.allowDeploy} />
      )}

      <ReleaseStatus namespace={namespace} release={release} />

      {plan.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
            <p className="text-sm text-muted-foreground">
              What this release was composed from, read from the ConfigMap beside it.
            </p>
          </CardHeader>
          <CardContent>
            <Provenance plan={plan.data} />
          </CardContent>
        </Card>
      )}

      {cluster.data?.allowDeploy && (
        <Uninstall namespace={namespace} release={release} exists={s.exists} />
      )}
    </div>
  );
}

// InstallStatus reads the status key swiss writes beside the release, which is
// the only thing that can report an apply that started and never finished --
// helm's own status describes the last apply that returned. The track under it
// adds what the controllers say: a release can be applied with ready pods and
// still serve nobody, because nothing routed to it.
function InstallStatus({ status, objects }: { status: Status; objects?: ObjectResult[] }) {
  const p: PlanStatus | undefined = status.planStatus;

  if (!status.exists && !p) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No helm release here. Nothing has been installed under this name.
        </CardContent>
      </Card>
    );
  }

  const steps = [
    appliedStep(status, p),
    podsStep(status),
    routeStep(pick<ModelRouteSpec, ModelRouteStatus>(objects, "ModelRoute")),
    scalerStep(pick<LLMScalerSpec, LLMScalerStatus>(objects, "LLMScaler")),
  ];
  const updated = p?.updatedAt ?? p?.startedAt;
  const summary = [
    p?.action,
    status.exists ? `revision ${status.revision}` : "not installed",
    updated && `updated ${timeAgo(updated)}`,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <CardTitle className="text-base">Install status</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{summary.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p && <PhaseBadge phase={p.phase} />}
          {status.helmStatus && <Badge variant="outline">helm {status.helmStatus}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <StepTile key={step.label} step={step} />
          ))}
        </ol>

        {p?.error && <Callout tone="bad">{p.error}</Callout>}
        {p?.phase === "applying" && (
          <Callout tone="warn">
            An apply was started and never recorded a result. It may still be running, or
            swissd may have been restarted mid-apply.
          </Callout>
        )}

        {/* Why, in the words of whoever did it. Written here as well as to the
            log, so it survives losing the database. */}
        {p?.note && (
          <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">{p.note}</blockquote>
        )}

        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Meta label="Started" at={p?.startedAt} />
          <Meta label="Updated" at={p?.updatedAt} />
          <Meta label="Recorded revision" value={p?.revision ? String(p.revision) : undefined} />
          <Meta label="Route" value={status.route} href={status.url} />
        </dl>

        {!p && status.exists && (
          <p className="text-sm text-muted-foreground">
            No status recorded beside this release — swiss did not deploy it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type StepState = "ok" | "wait" | "bad" | "off";
interface Step {
  label: string;
  state: StepState;
  detail: string;
}

function appliedStep(s: Status, p?: PlanStatus): Step {
  const label = "Applied";
  if (p?.phase === "failed" || s.helmStatus === "failed") return { label, state: "bad", detail: "the last apply failed" };
  if (p?.phase === "applying" || s.helmStatus?.startsWith("pending"))
    return { label, state: "wait", detail: s.helmStatus ?? "applying" };
  if (s.exists) return { label, state: "ok", detail: `revision ${s.revision}` };
  return { label, state: "off", detail: "not installed" };
}

function podsStep(s: Status): Step {
  const label = "Pods ready";
  if (s.total === 0) return { label, state: s.exists ? "wait" : "off", detail: "no pods yet" };
  return { label, state: s.ready < s.total ? "wait" : "ok", detail: `${s.ready} of ${s.total} ready` };
}

function routeStep({ result, spec, status }: ReturnType<typeof pick<ModelRouteSpec, ModelRouteStatus>>): Step {
  const label = "Routed";
  if (!result) return { label, state: "off", detail: "no ModelRoute" };
  if (result.error) return { label, state: "wait", detail: "unreadable" };
  if (result.missing) return { label, state: "bad", detail: "ModelRoute deleted" };
  const n = status?.backends ?? 0;
  const backends = `${n} backend${n === 1 ? "" : "s"}`;
  const route = spec?.nginx?.route ? ` on /${spec.nginx.route}/` : "";
  return status?.ready ? { label, state: "ok", detail: backends + route } : { label, state: "wait", detail: `not ready · ${backends}` };
}

function scalerStep({ result, status }: ReturnType<typeof pick<LLMScalerSpec, LLMScalerStatus>>): Step {
  const label = "Scaling";
  if (!result) return { label, state: "off", detail: "fixed replicas" };
  if (result.error) return { label, state: "wait", detail: "unreadable" };
  if (result.missing) return { label, state: "bad", detail: "LLMScaler deleted" };
  const failing = status?.conditions?.find((c) => c.status === "False");
  if (failing) return { label, state: "bad", detail: failing.reason || failing.type };
  const cur = status?.currentReplicas;
  const want = status?.desiredReplicas;
  if (cur === undefined) return { label, state: "wait", detail: "no decision yet" };
  if (want !== undefined && want !== cur) return { label, state: "wait", detail: `${cur} → ${want} replicas` };
  return { label, state: "ok", detail: `${cur} replica${cur === 1 ? "" : "s"}, steady` };
}

const STEP_STYLE: Record<StepState, { icon: React.ReactNode; tile: string }> = {
  ok: { icon: <CircleCheck className="size-5 text-success" />, tile: "border-success/30 bg-success/5" },
  wait: { icon: <Loader2 className="size-5 animate-spin text-warning" />, tile: "border-warning/30 bg-warning/5" },
  bad: { icon: <CircleX className="size-5 text-destructive" />, tile: "border-destructive/30 bg-destructive/5" },
  off: { icon: <CircleDashed className="size-5 text-muted-foreground" />, tile: "border-dashed" },
};

function StepTile({ step }: { step: Step }) {
  const style = STEP_STYLE[step.state];
  return (
    <li className={cn("flex items-start gap-2.5 rounded-lg border p-3", style.tile)}>
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0">
        <div className={cn("text-sm font-medium", step.state === "off" && "text-muted-foreground")}>{step.label}</div>
        <div className="truncate text-xs text-muted-foreground" title={step.detail}>
          {step.detail}
        </div>
      </div>
    </li>
  );
}

function Callout({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
        tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

// An unset field is left out rather than rendered as a dash: the list is read at
// a glance, and empty rows bury the ones that were actually set.
function Meta({ label, value, at, href }: { label: string; value?: string; at?: string; href?: string }) {
  if (!value?.trim() && !at) return null;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">
        {at ? (
          <span title={new Date(at).toLocaleString()}>
            {timeAgo(at)}
            <span className="ml-1.5 text-xs text-muted-foreground">{new Date(at).toLocaleString()}</span>
          </span>
        ) : href ? (
          <a href={href} target="_blank" rel="noreferrer" className="font-mono text-xs underline-offset-2 hover:underline">
            {value}
          </a>
        ) : (
          <span className="font-mono text-xs">{value}</span>
        )}
      </dd>
    </div>
  );
}

// Uninstall is typed to confirm rather than guarded by a dialog. It removes a
// release that takes 20-40 minutes to load back, so the release name is the one
// thing the operator must have read before this goes ahead.
function Uninstall({
  namespace,
  release,
  exists,
}: {
  namespace: string;
  release: string;
  exists: boolean;
}) {
  const [typed, setTyped] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const run = useMutation({
    mutationFn: () => deployApi.uninstall(namespace, release),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["deployments"] });
      if (!r.planError) navigate("/");
    },
  });

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">Uninstall</CardTitle>
        <p className="text-sm text-muted-foreground">
          Runs <code>helm uninstall</code> and removes the plan recorded beside the release.
          The audit log keeps the record. Reloading the weights afterwards takes 20–40
          minutes.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!exists ? (
          <p className="text-sm text-muted-foreground">There is no live release to remove.</p>
        ) : (
          <>
            <Field label="Type the release name to confirm" hint={release}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={release} />
            </Field>
            <Button
              variant="destructive"
              onClick={() => run.mutate()}
              disabled={typed !== release || run.isPending}
            >
              {run.isPending ? "Uninstalling…" : `Uninstall ${release}`}
            </Button>
          </>
        )}

        {run.error && <ErrorState what="the uninstall" error={run.error} />}
        {run.data?.planError && (
          <p className="text-sm text-warning">
            The release is gone, but its plan ConfigMap was not removed: {run.data.planError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// The form layer is what the operator set. Compose writes sloRequirement.enabled
// there explicitly, so a missing key is off rather than the chart's default.
function sloEnabled(plan?: Plan): boolean {
  const raw = plan?.layers?.form?.sloRequirement;
  if (!raw || typeof raw !== "object") return false;
  return (raw as { enabled?: boolean }).enabled === true;
}

function PhaseBadge({ phase }: { phase: string }) {
  if (phase === "applied") return <Badge variant="success">applied</Badge>;
  if (phase === "failed") return <Badge variant="destructive">failed</Badge>;
  if (phase === "applying") return <Badge variant="warning">applying</Badge>;
  return <Badge variant="outline">{phase}</Badge>;
}
