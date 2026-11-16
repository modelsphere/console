import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, DataSelect, SectionCard, cn } from "@modelsphere/ui";
import { RefreshCw } from "lucide-react";
import { formatDateTime } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { ofRelease, warnings } from "@/modules/inferences/lib";
import { workloadApi, type K8sEvent } from "@/modules/inferences/workload-api";

const ALL = "__all";

export function useReleaseEvents(namespace: string, release: string, pods: readonly string[]) {
  const q = useQuery({
    queryKey: ["k8s-events", namespace, release],
    queryFn: () => workloadApi.events(namespace, release),
    refetchInterval: 15_000,
    retry: false,
  });
  return { ...q, events: (q.data?.items ?? []).filter((e) => ofRelease(e.name, release, pods)) };
}

export function Events({ namespace, release, pods }: { namespace: string; release: string; pods: readonly string[] }) {
  const t = useT();
  const q = useReleaseEvents(namespace, release, pods);
  const [object, setObject] = useState(ALL);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const objects = [...new Set(q.events.map((e) => `${e.kind}/${e.name}`))].sort();
  const shown = q.events.filter((e) => (object === ALL || `${e.kind}/${e.name}` === object) && (!onlyWarnings || e.type === "Warning"));

  return (
    <SectionCard
      title={t("events.title")}
      summary={t("events.summary", { n: q.events.length, w: warnings(q.events) })}
      hint={t("events.retention")}
      actions={
        <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} /> {t("logs.refresh")}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DataSelect
            className="w-72"
            value={object}
            onValueChange={setObject}
            options={[{ value: ALL, label: t("events.allObjects", { n: q.events.length }) }, ...objects.map((o) => ({ value: o, label: o }))]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyWarnings} onCheckedChange={(v) => setOnlyWarnings(!!v)} />
            {t("events.warningsOnly")} <span className="text-muted-foreground">({warnings(q.events)})</span>
          </label>
        </div>
        {q.error ? (
          <p className="text-sm text-destructive">{t("events.noAccess", { error: q.error.message })}</p>
        ) : q.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common:status.loading")}</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t(onlyWarnings ? "events.emptyWarnings" : "events.empty")}</p>
        ) : (
          <ol className="divide-y">
            {shown.map((e, i) => (
              <EventRow key={`${e.kind}/${e.name}/${e.reason}/${i}`} e={e} />
            ))}
          </ol>
        )}
      </div>
    </SectionCard>
  );
}

export function EventRow({ e, compact }: { e: K8sEvent; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = e.message.length > (compact ? 90 : 200);
  return (
    <li className="flex gap-2.5 py-2.5">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.type === "Warning" ? "bg-warning" : "bg-muted-foreground/50")} />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium">{e.reason}</span>
          {!compact && (
            <span className="font-mono text-xs text-muted-foreground">
              {e.kind}/{e.name}
            </span>
          )}
          {e.count > 1 && <span className="rounded bg-muted px-1 text-xs text-muted-foreground tabular-nums">{t("events.times", { n: e.count })}</span>}
          <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">{e.lastTimestamp ? formatDateTime(e.lastTimestamp) : ""}</span>
        </div>
        {compact && <div className="truncate font-mono text-xs text-muted-foreground">{e.name}</div>}
        <p className={cn("mt-0.5 text-xs break-words text-muted-foreground", !open && long && "line-clamp-2")}>{e.message}</p>
        {long && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen(!open)}>
            {t(open ? "events.collapse" : "events.expand")}
          </button>
        )}
      </div>
    </li>
  );
}
