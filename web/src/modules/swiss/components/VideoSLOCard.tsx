import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { deployApi, type SLOConfig, type SLOEdit } from "@swiss/lib/api";
import { jobSLOs, type JobSLO } from "@swiss/lib/video";
import { POOL_LABELS } from "@swiss/lib/videoChart";
import { useReleaseObjects } from "@swiss/components/ReleaseObjects";
import { Row, Select } from "@swiss/components/SLOCard";
import { Badge } from "@swiss/components/ui/badge";
import { Button } from "@swiss/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { Dialog } from "@swiss/components/ui/dialog";
import { Input } from "@swiss/components/ui/input";
import { Switch } from "@swiss/components/ui/switch";
import { messageOf, useToast } from "@swiss/components/ui/toast";
import { ErrorState, Loading } from "@swiss/components/States";
import { cn } from "@swiss/lib/utils";

// A video release's SLOs: one JobSLORequirement per pool, scaled on its queue
// rather than on latency. Each is read and written through swissd's /slo with
// the pool's service id, which comes from the release's objects.
export function VideoSLOCard({ namespace, release, canEdit, bare = false }: { namespace: string; release: string; canEdit: boolean; bare?: boolean }) {
  const objects = useReleaseObjects(namespace, release, false);
  const slos = jobSLOs(objects.data?.objects);
  if (objects.isPending) return <Loading what="SLO" />;
  if (objects.error) return <ErrorState what="the release's SLOs" error={objects.error} />;
  if (slos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No JobSLORequirement on this release. Upgrade it with Autoscale / SLO on: the chart then creates one per pool.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="video-slo">
      {slos.map((s) => (
        <PoolSLO key={s.serviceId} namespace={namespace} release={release} slo={s} canEdit={canEdit} bare={bare} />
      ))}
    </div>
  );
}

export function VideoSLODialog({ target, canEdit, onClose }: { target: { namespace: string; release: string } | null; canEdit: boolean; onClose: () => void }) {
  if (!target) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Configure SLO"
      subtitle={
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{target.release}</span>
          <Badge variant="outline">{target.namespace}</Badge>
        </div>
      }
      footer={
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <VideoSLOCard namespace={target.namespace} release={target.release} canEdit={canEdit} bare />
    </Dialog>
  );
}

interface Draft {
  highPriority: boolean;
  minType: string;
  minValue: string;
  maxValue: string;
  maxDepth: string;
}

export function draftOf(data: SLOConfig): Draft {
  return {
    highPriority: data.highPriority ?? (data.priority ?? 0) >= 10,
    minType: data.minimumDeployment?.type || "replica",
    minValue: data.minimumDeployment ? String(data.minimumDeployment.value) : "1",
    maxValue: data.maximumDeployment ? String(data.maximumDeployment.value) : "",
    maxDepth: data.queue?.maxDepth !== undefined ? String(data.queue.maxDepth) : "",
  };
}

const int = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

// editOf is what a save sends. A save merges, so an empty field is left out:
// it keeps the stored value, and only Reset clears one.
export function editOf(d: Draft): SLOEdit {
  const body: SLOEdit = { highPriority: d.highPriority };
  const min = int(d.minValue);
  if (min != null) body.minimumDeployment = { type: d.minType, value: min };
  const max = int(d.maxValue);
  if (max != null) body.maximumDeployment = { type: "replica", value: max };
  const depth = int(d.maxDepth);
  if (depth != null) body.queue = { maxDepth: depth };
  return body;
}

export function draftProblem(d: Draft): string | undefined {
  for (const [label, v] of [["minimum", d.minValue], ["maximum", d.maxValue], ["max queue depth", d.maxDepth]] as const) {
    if (v.trim() !== "" && int(v) == null) return `The ${label} must be a whole number of at least 1.`;
  }
  const min = int(d.minValue);
  const max = int(d.maxValue);
  if (d.minType === "replica" && min != null && max != null && max < min) return "The maximum is below the minimum.";
  return undefined;
}

function PoolSLO({ namespace, release, slo, canEdit, bare }: { namespace: string; release: string; slo: JobSLO; canEdit: boolean; bare: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["slo", namespace, release, slo.serviceId];
  const q = useQuery({ queryKey: key, queryFn: () => deployApi.slo(namespace, release, slo.serviceId), retry: false });
  // Seeded from a settled read only: a draft from a stale cache would save over what changed since.
  const [form, setForm] = useState<Draft | null>(() => (q.data && !q.isFetching ? draftOf(q.data) : null));
  useEffect(() => {
    if (!q.data || q.isFetching || form) return;
    setForm(draftOf(q.data));
  }, [q.data, q.isFetching, form]);
  const stored = useMemo(() => (q.data ? draftOf(q.data) : null), [q.data]);
  const written = (next: SLOConfig) => {
    qc.setQueryData(key, next);
    setForm(draftOf(next));
    // The write answers with the fields it took, not the queue query the chart
    // set: read the whole SLO back.
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["objects", namespace, release] });
  };
  const save = useMutation({
    mutationFn: () => deployApi.saveSLO(namespace, release, editOf(form!), slo.serviceId),
    onSuccess: (next) => {
      written(next);
      toast.success(`SLO saved for ${slo.serviceId}.`);
    },
    onError: (e) => toast.error(`SLO not saved: ${messageOf(e)}`),
  });
  const reset = useMutation({
    mutationFn: () => deployApi.resetSLO(namespace, release, slo.serviceId),
    onSuccess: (next) => {
      written(next);
      toast.success(`SLO for ${slo.serviceId} reset to the CRD defaults.`);
    },
    onError: (e) => toast.error(`SLO not reset: ${messageOf(e)}`),
  });

  const title = slo.pool ? `${POOL_LABELS[slo.pool].title} pool` : slo.serviceId;
  const found = !!q.data?.found;
  const editable = canEdit && found;
  const busy = save.isPending || reset.isPending;
  const problem = form ? draftProblem(form) : undefined;
  const changed = JSON.stringify(form) !== JSON.stringify(stored);
  const scaled = !!q.data?.maximumDeployment;

  const body = !form ? (
    q.error ? <ErrorState what={`the SLO of ${slo.serviceId}`} error={q.error} /> : <Loading what="SLO" />
  ) : (
    <div className="divide-y">
      {!found && <p className="pb-3 text-sm text-muted-foreground">The chart creates this requirement at install — the SLO API only edits one that exists.</p>}
      <Row label="Priority" hint="High is CRD priority 10, normal 0. The SLO API stores no tier in between.">
        <div className="flex h-9 items-center gap-2.5">
          <Switch checked={form.highPriority} disabled={!editable} onChange={(highPriority) => setForm({ ...form, highPriority })} label="high priority" />
          <span className={cn("text-sm", !form.highPriority && "text-muted-foreground")}>{form.highPriority ? "high" : "normal"}</span>
        </div>
      </Row>
      <Row
        label="Bounds"
        hint="The floor counts replicas or concurrency; the ceiling is always replicas. An empty ceiling is autoscaling off: the pool keeps its replica count. A save merges, so emptying a stored ceiling does not clear it — Reset does."
      >
        <div className="flex items-center gap-2">
          <Select value={form.minType} disabled={!editable} options={["replica", "concurrency"]} className="w-32" onChange={(minType) => setForm({ ...form, minType })} />
          <Input value={form.minValue} disabled={!editable} inputMode="numeric" placeholder="min" aria-label="minimum value" className="min-w-0 flex-1" onChange={(e) => setForm({ ...form, minValue: e.target.value })} />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <Input value={form.maxValue} disabled={!editable} inputMode="numeric" placeholder="empty = autoscaling off" aria-label="maximum replicas" className="min-w-0 flex-1" onChange={(e) => setForm({ ...form, maxValue: e.target.value })} />
        </div>
      </Row>
      <Row label="Max queue depth" hint="Queued and running tasks per replica the pool may carry before the decision server adds one.">
        <Input value={form.maxDepth} disabled={!editable} inputMode="numeric" aria-label="max queue depth" placeholder={stored?.maxDepth || "chart default"} onChange={(e) => setForm({ ...form, maxDepth: e.target.value })} />
      </Row>
      {problem && <p className="py-2 text-sm text-destructive">{problem}</p>}
    </div>
  );

  const actions = canEdit && form && (
    <div className="flex shrink-0 gap-2">
      <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={busy || !found} title="Back to the CRD defaults: no maximum (not scaled) and normal priority; the minimum and the queue are kept">
        {reset.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Reset
      </Button>
      <Button size="sm" onClick={() => save.mutate()} disabled={busy || !editable || !changed || !!problem}>
        {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
      </Button>
    </div>
  );

  const head = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <CardTitle className="text-base">{title}</CardTitle>
      {q.data && !found && <Badge variant="warning">not registered</Badge>}
      {q.data && found && (scaled ? <Badge variant="success">autoscaled</Badge> : <Badge variant="muted">not scaled: no maximum</Badge>)}
      {slo.pool && <span className="font-mono text-xs text-muted-foreground">{slo.serviceId}</span>}
    </div>
  );

  if (bare) {
    return (
      <section className="rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {head}
          {actions}
        </div>
        {body}
      </section>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {head}
        {actions}
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  );
}
