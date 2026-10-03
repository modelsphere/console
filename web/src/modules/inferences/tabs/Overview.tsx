import { useQuery } from "@tanstack/react-query";
import { Badge, Button, cn } from "@modelsphere/ui";
import { CircleCheck, CircleDashed, CircleX, Loader2, TriangleAlert } from "lucide-react";
import { formatDateTime } from "@/shell";
import {
  api,
  type LLMScalerSpec,
  type LLMScalerStatus,
  type ModelRouteSpec,
  type ModelRouteStatus,
  type ObjectResult,
  type Plan,
  type ReleaseStatus,
  type Run,
} from "@swiss/lib/api";
import { pick } from "@swiss/components/ReleaseObjects";
import { AccessPoint } from "@swiss/components/Endpoint";
import { useT } from "@/modules/inferences/i18n";
import { installSteps, modelLine, releaseState, type Step, type StepState } from "@/modules/inferences/lib";
import { Field, Section } from "@/modules/inferences/components/Section";
import { StatusDot } from "@/modules/inferences/components/StatusDot";
import { InSwiss } from "@/modules/inferences/components/SwissScope";

const RECENT = 5;

// The overview: what the release is (basic information), how far its install
// got, where to call it, and on the right the last few things done to it --
// swissd has no events, and its run log is the honest record of what happened.
export function Overview({
  namespace,
  release,
  status: s,
  plan,
  objects,
  objectsUnreadable,
  onAllRuns,
}: {
  namespace: string;
  release: string;
  status: ReleaseStatus;
  plan?: Plan;
  objects?: ObjectResult[];
  objectsUnreadable: boolean;
  onAllRuns: () => void;
}) {
  const t = useT();
  const p = s.planStatus;
  const source = plan?.source;
  const runs = useQuery({
    queryKey: ["runs", namespace, release],
    queryFn: () => api.runs({ namespace, release, limit: 200 }),
  });

  if (!s.exists && !p) {
    return <p className="rounded-lg border border-dashed p-6 text-muted-foreground">{t("detail.notFound")}</p>;
  }

  const steps = installSteps(
    s,
    pick<ModelRouteSpec, ModelRouteStatus>(objects, "ModelRoute"),
    pick<LLMScalerSpec, LLMScalerStatus>(objects, "LLMScaler"),
    objectsUnreadable,
  );
  const catalog = source && [source.catalogName ?? source.catalog, source.ref].filter(Boolean).join(" @ ");

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <Section title={t("overview.basic")}>
          <dl className="text-sm">
            <Field label={t("detail.fields.state")}>
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusDot state={releaseState(s)} />
                {s.helmStatus && <Badge variant="outline">helm {s.helmStatus}</Badge>}
              </span>
            </Field>
            <Field label={t("detail.fields.model")}>{modelLine(source ?? {}) || s.model}</Field>
            <Field label={t("detail.fields.catalog")}>{catalog}</Field>
            <Field label={t("detail.fields.chart")}>{plan && `${plan.chart.name}-${plan.chart.version}`}</Field>
            <Field label={t("detail.fields.revision")}>{s.exists ? String(s.revision) : undefined}</Field>
            <Field label={t("detail.fields.route")}>{s.route && <code className="font-mono text-xs">/{s.route}/</code>}</Field>
            <Field label={t("detail.fields.namespace")}>{namespace}</Field>
            <Field label={t("detail.fields.updated")}>{(p?.updatedAt ?? p?.startedAt) && formatDateTime(p?.updatedAt ?? p?.startedAt ?? "")}</Field>
            <Field label={t("detail.fields.note")}>{p?.note && <span className="italic text-muted-foreground">{p.note}</span>}</Field>
          </dl>
        </Section>

        <Section title={t("overview.install")}>
          <div className="space-y-3">
            <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {steps.map((step) => (
                <StepTile key={step.key} step={step} />
              ))}
            </ol>
            {p?.error && <Callout tone="bad">{p.error}</Callout>}
            {p?.phase === "applying" && <Callout tone="warn">{t("overview.applyingHint")}</Callout>}
            {s.total > 0 && s.ready < s.total && <p className="text-sm text-muted-foreground">{t("overview.coldLoad")}</p>}
            {s.warning && <Callout tone="warn">{s.warning}</Callout>}
          </div>
        </Section>

        <Section title={t("overview.access")} hint={s.route && <code className="font-mono">/{s.route}/</code>}>
          <InSwiss>
            <AccessPoint status={s} />
          </InSwiss>
        </Section>
      </div>

      <Section
        title={t("overview.recent")}
        hint={t("overview.recentHint", { n: RECENT })}
        action={
          <Button variant="outline" size="sm" onClick={onAllRuns}>
            {t("actions.viewAll")}
          </Button>
        }
      >
        <RecentRuns runs={runs.data?.runs.slice(0, RECENT)} hasStore={runs.data?.hasStore ?? true} loading={runs.isPending} />
      </Section>
    </div>
  );
}

function RecentRuns({ runs, hasStore, loading }: { runs?: Run[]; hasStore: boolean; loading: boolean }) {
  const t = useT();
  if (loading) return <p className="text-sm text-muted-foreground">{t("common:status.loading")}</p>;
  if (!hasStore) return <p className="text-sm text-muted-foreground">{t("overview.noStore")}</p>;
  if (!runs?.length) return <p className="text-sm text-muted-foreground">{t("overview.noRuns")}</p>;
  return (
    <ol className="space-y-3">
      {runs.map((r) => (
        <li key={r.id} className="flex gap-2.5">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.error ? "bg-destructive" : r.changed ? "bg-success" : "bg-muted-foreground/60")} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">
                {r.action}
                {r.revision !== undefined && <span className="ml-1.5 font-normal text-muted-foreground">r{r.revision}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(r.startedAt)}</span>
            </div>
            {r.actor && <div className="text-xs text-muted-foreground">{r.actor}</div>}
            {(r.error || r.note) && (
              <div className={cn("mt-0.5 line-clamp-2 text-xs", r.error ? "text-destructive" : "text-muted-foreground")} title={r.error ?? r.note}>
                {r.error ?? r.note}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const STEP_STYLE: Record<StepState, { icon: React.ReactNode; tile: string }> = {
  ok: { icon: <CircleCheck className="size-5 text-success" />, tile: "border-success/30 bg-success/5" },
  wait: { icon: <Loader2 className="size-5 animate-spin text-warning" />, tile: "border-warning/30 bg-warning/5" },
  bad: { icon: <CircleX className="size-5 text-destructive" />, tile: "border-destructive/30 bg-destructive/5" },
  off: { icon: <CircleDashed className="size-5 text-muted-foreground" />, tile: "border-dashed" },
};

function StepTile({ step }: { step: Step }) {
  const t = useT();
  const style = STEP_STYLE[step.state];
  const detail = t(`steps.${step.key}.${step.detail}`, step.params);
  return (
    <li className={cn("flex items-start gap-2.5 rounded-lg border p-3", style.tile)}>
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0">
        <div className={cn("text-sm font-medium", step.state === "off" && "text-muted-foreground")}>{t(`steps.${step.key}.label`)}</div>
        <div className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </div>
      </div>
    </li>
  );
}

function Callout({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
