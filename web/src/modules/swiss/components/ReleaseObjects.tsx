import { useQuery } from "@tanstack/react-query";
import { Gauge, Route, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  api,
  type Condition,
  type LLMScalerSpec,
  type LLMScalerStatus,
  type LLMSLORequirementSpec,
  type ModelRouteSpec,
  type ModelRouteStatus,
  type ObjectResult,
  type SLOMetric,
  type SLOObjective,
} from "@swiss/lib/api";
import { Badge } from "@swiss/components/ui/badge";
import { HoverHint } from "@swiss/components/ui/hint";
import { Button } from "@swiss/components/ui/button";
import { Card } from "@swiss/components/ui/card";
import { ErrorState } from "@swiss/components/States";
import { cn, timeAgo } from "@swiss/lib/utils";

// Unpolled, it loads once per visit and then moves only when the page's own
// loop or an SLO write refetches it. The staleTime keeps a second reader
// mounting moments later from fetching it again.
export function useReleaseObjects(namespace: string, release: string, poll = true) {
  return useQuery({
    queryKey: ["objects", namespace, release],
    queryFn: () => api.objects(namespace, release),
    retry: false,
    ...(poll
      ? { refetchInterval: 15_000 }
      : { staleTime: 10_000, refetchOnWindowFocus: false, refetchOnReconnect: false }),
  });
}

// One object by kind, with its spec and status typed. A release renders at most
// one of each.
export function pick<Spec, Status>(
  objects: ObjectResult[] | undefined,
  kind: string,
) {
  const result = objects?.find((o) => o.ref.kind === kind);
  return {
    result,
    spec: result?.live?.spec as Spec | undefined,
    status: result?.live?.status as Status | undefined,
  };
}

export function ReleaseObjects({
  namespace,
  release,
  onConfigureSLO,
}: {
  namespace: string;
  release: string;
  onConfigureSLO?: () => void;
}) {
  const q = useReleaseObjects(namespace, release, false);
  if (q.error)
    return <ErrorState what="the cluster resources" error={q.error} />;
  const objects = q.data?.objects;
  if (objects && objects.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">
        <HoverHint
          text={
            "Read live from the objects this release rendered" +
            (q.dataUpdatedAt > 0 ? ` · refreshed ${timeAgo(new Date(q.dataUpdatedAt).toISOString())}` : "")
          }
        >
          Cluster resources
        </HoverHint>
      </h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <RoutePanel objects={objects} loading={q.isPending} />
        <ScalerPanel objects={objects} loading={q.isPending} />
        <SLOPanel objects={objects} loading={q.isPending} onConfigure={onConfigureSLO} />
      </div>
    </section>
  );
}

function RoutePanel({
  objects,
  loading,
}: {
  objects?: ObjectResult[];
  loading: boolean;
}) {
  const { result, spec, status } = pick<ModelRouteSpec, ModelRouteStatus>(
    objects,
    "ModelRoute",
  );
  const ready = status?.ready === true;
  const peers = [...(spec?.nginx?.peers ?? [])].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const values = Object.entries(spec?.nginx?.values ?? {});

  return (
    <ObjectCard
      icon={<Route className="size-4" />}
      title="Routing"
      kind="ModelRoute"
      result={result}
      loading={loading}
      absent="No ModelRoute: the gateway does not route to this release through autoconfig."
      state={
        status &&
        (ready ? (
          <Badge variant="success">ready</Badge>
        ) : (
          <Badge variant="warning">not ready</Badge>
        ))
      }
    >
      {spec && (
        <>
          <Stats>
            <Stat
              label="Backends"
              value={status?.backends ?? 0}
              tone={ready ? undefined : "warn"}
            />
            {spec.cart && (
              <Stat label="CART peers" value={status?.cartPeers ?? 0} />
            )}
            <Stat
              label="Last sync"
              value={
                status?.lastSyncTime ? timeAgo(status.lastSyncTime) : "never"
              }
            />
          </Stats>

          <Facts>
            <Fact label="Route">
              <Mono>/{spec.nginx?.route ?? result?.ref.name}/</Mono>
              {spec.modelType === "video" && (
                <Badge variant="muted" className="ml-1.5">
                  video
                </Badge>
              )}
            </Fact>
            <Fact label="Discovery">
              <Mono>
                {spec.discovery?.service ?? `pods: ${spec.discovery?.selector}`}
              </Mono>
              {spec.discovery?.port !== undefined && (
                <span className="text-muted-foreground">
                  :{spec.discovery.port}
                </span>
              )}
            </Fact>
            {peers.length > 0 && (
              <Fact label="Peer tiers">
                <div className="flex flex-wrap gap-1">
                  {peers.map((p, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="gap-1 font-mono"
                    >
                      {p.use}
                      <span className="text-muted-foreground">
                        p{p.priority ?? 0}
                      </span>
                      {p.maxConcurrencyFromBackend ? (
                        <span className="text-muted-foreground">
                          × backends
                        </span>
                      ) : (
                        p.maxConcurrency !== undefined && (
                          <span className="text-muted-foreground">
                            ≤{p.maxConcurrency}
                          </span>
                        )
                      )}
                    </Badge>
                  ))}
                </div>
              </Fact>
            )}
            {spec.cart && (
              <Fact label="CART">
                <Mono>{spec.cart.service ?? spec.cart.selector}</Mono>
                {spec.cart.maxLoad !== undefined && (
                  <span className="text-muted-foreground">
                    {" "}
                    · max load {spec.cart.maxLoad}
                  </span>
                )}
              </Fact>
            )}
            <Fact label="Written to">
              <Mono>{spec.nginx?.outputConfigMap}</Mono>
            </Fact>
            {spec.slo?.name && (
              <Fact label="SLO from">
                <Mono>{spec.slo.name}</Mono>
              </Fact>
            )}
            {values.length > 0 && (
              <Fact label="Tuning">
                <div className="flex flex-wrap gap-1">
                  {values.map(([k, v]) => (
                    <Badge key={k} variant="muted" className="font-mono">
                      {k}={v}
                    </Badge>
                  ))}
                </div>
              </Fact>
            )}
          </Facts>

          {!!status?.orphanRouteKeys?.length && (
            <Callout>
              Stale openresty keys left by a rename, still loaded:{" "}
              {status.orphanRouteKeys.join(", ")}
            </Callout>
          )}
          <Stale
            generation={result?.live?.generation}
            observed={status?.observedGeneration}
          />
          <Conditions conditions={status?.conditions} />
        </>
      )}
    </ObjectCard>
  );
}

function ScalerPanel({
  objects,
  loading,
}: {
  objects?: ObjectResult[];
  loading: boolean;
}) {
  const { result, spec, status } = pick<LLMScalerSpec, LLMScalerStatus>(
    objects,
    "LLMScaler",
  );
  const current = status?.currentReplicas;
  const desired = status?.desiredReplicas;
  const failing = status?.conditions?.find((c) => c.status === "False");
  const custom = spec?.metricProvider === "Custom";

  let state: React.ReactNode = null;
  if (failing)
    state = <Badge variant="warning">{failing.reason || failing.type}</Badge>;
  else if (current !== undefined && desired !== undefined) {
    if (desired > current) state = <Badge variant="warning">scaling up</Badge>;
    else if (desired < current)
      state = <Badge variant="warning">scaling down</Badge>;
    else state = <Badge variant="success">steady</Badge>;
  }

  return (
    <ObjectCard
      icon={<Gauge className="size-4" />}
      title="Scaling"
      kind="LLMScaler"
      result={result}
      loading={loading}
      absent="No LLMScaler: the replica count is whatever the chart set."
      state={state}
    >
      {spec && (
        <>
          <ReplicaGauge
            min={spec.minReplicas ?? 0}
            max={spec.maxReplicas}
            current={current}
            desired={desired}
          />

          <Facts>
            {spec.targetRef && (
              <Fact label="Target">
                <span className="text-muted-foreground">
                  {spec.targetRef.kind}
                </span>{" "}
                <Mono>{spec.targetRef.name}</Mono>
              </Fact>
            )}
            <Fact label="Signal">
              <Badge variant="outline">
                {custom ? "decision server" : "Prometheus"}
              </Badge>
            </Fact>
            <Fact label={custom ? "Server" : "Query API"}>
              <Mono>{spec.serverAddress}</Mono>
            </Fact>
            {custom && spec.customProvider && (
              <Fact label="Service id">
                <Mono>{spec.customProvider.serviceId}</Mono>
                {spec.customProvider.namespace && (
                  <span className="text-muted-foreground">
                    {" "}
                    in {spec.customProvider.namespace}
                  </span>
                )}
              </Fact>
            )}
            {spec.scaleDown && (
              <Fact label="Scale-down">
                {[
                  spec.scaleDown.behavior ?? "CacheAware",
                  spec.scaleDown.maxStepReplicas
                    ? `≤${spec.scaleDown.maxStepReplicas} per step`
                    : undefined,
                  spec.scaleDown.stabilizationWindowSeconds
                    ? `${spec.scaleDown.stabilizationWindowSeconds}s window`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Fact>
            )}
            {spec.syncPeriodSeconds !== undefined && (
              <Fact label="Sync every">{spec.syncPeriodSeconds}s</Fact>
            )}
          </Facts>

          {!custom && !!spec.metrics?.length && (
            <div className="space-y-2">
              {spec.metrics.map((m, i) => (
                <div key={i} className="rounded-md border bg-muted/40 p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">
                      {m.name ?? `metric ${i + 1}`}
                    </span>
                    <span className="text-muted-foreground">
                      target{" "}
                      <span className="font-mono text-foreground">
                        {m.target}
                      </span>
                    </span>
                  </div>
                  <code className="block font-mono text-[11px] leading-snug break-all text-muted-foreground">
                    {m.query}
                  </code>
                </div>
              ))}
            </div>
          )}

          <Conditions conditions={status?.conditions} />
        </>
      )}
    </ObjectCard>
  );
}

function SLOPanel({
  objects,
  loading,
  onConfigure,
}: {
  objects?: ObjectResult[];
  loading: boolean;
  onConfigure?: () => void;
}) {
  const { result, spec } = pick<LLMSLORequirementSpec, unknown>(
    objects,
    "LLMSLORequirement",
  );
  const min = spec?.minimumDeployment?.value ?? 1;
  const max = spec?.maximumDeployment?.value;
  const suspended = min === 0 && max === 0;
  const priority = spec?.priority ?? 0;

  return (
    <ObjectCard
      icon={<ShieldCheck className="size-4" />}
      title="SLO"
      kind="LLMSLORequirement"
      result={result}
      loading={loading}
      absent="No LLMSLORequirement: the decision service has no targets for this model."
      action={
        onConfigure && (
          <Button
            size="sm"
            variant="outline"
            className="size-8 px-0 text-primary"
            aria-label="Configure SLO"
            title="Configure SLO"
            onClick={onConfigure}
          >
            <Settings2 className="size-4" />
          </Button>
        )
      }
    >
      {spec && (
        <>
          <Stats>
            <Stat
              label="Replicas"
              value={suspended ? "off" : `${min}–${max ?? "∞"}`}
            />
            <Stat label="Priority" value={`${priority} / 10`} />
          </Stats>

          <Facts>
            <Fact label="Class">
              {suspended ? (
                <Badge variant="warning">suspended</Badge>
              ) : priority > 0 ? (
                <Badge variant="success">priority {priority}</Badge>
              ) : (
                <Badge variant="muted">best effort</Badge>
              )}
            </Fact>
            <Fact label="Service id">
              <Mono>{spec.serviceId}</Mono>
            </Fact>
          </Facts>

          <Objective
            label="TTFT"
            hint="ceiling"
            unit="s"
            op="≤"
            objective={spec.ttft}
          />
          <Objective
            label="OTPS"
            hint="floor"
            unit="tok/s"
            op="≥"
            objective={spec.otps}
          />
        </>
      )}
    </ObjectCard>
  );
}

// A TTFT target is a ceiling and an OTPS target a floor, so the operator is
// part of the value.
function Objective({
  label,
  hint,
  unit,
  op,
  objective,
}: {
  label: string;
  hint: string;
  unit: string;
  op: string;
  objective?: SLOObjective;
}) {
  const base = objective?.default?.metrics ?? [];
  const ranges = objective?.ranges ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </div>
      {base.length === 0 && ranges.length === 0 ? (
        <p className="text-xs text-muted-foreground">No targets.</p>
      ) : (
        <>
          {base.length > 0 && <Thresholds metrics={base} unit={unit} op={op} />}
          {ranges.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground tabular-nums">
                ctx {r.contextLengthRangeLow}–{r.contextLengthRangeHigh ?? "∞"}
              </span>
              <Thresholds metrics={r.metrics} unit={unit} op={op} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Thresholds({
  metrics,
  unit,
  op,
}: {
  metrics: SLOMetric[];
  unit: string;
  op: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {metrics.map((m, i) => (
        <Badge key={i} variant="outline" className="gap-1 tabular-nums">
          <span className="text-muted-foreground">{m.type}</span>
          {op} {m.threshold}
          <span className="text-muted-foreground">{unit}</span>
        </Badge>
      ))}
    </div>
  );
}

// One dot per replica when the range is small enough to count: filled is
// running, ringed is what the scaler wants added, faded is outside min..max.
function ReplicaGauge({
  min,
  max,
  current,
  desired,
}: {
  min: number;
  max?: number;
  current?: number;
  desired?: number;
}) {
  const top = Math.max(max ?? 0, current ?? 0, desired ?? 0, 1);
  const legend = (
    <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
      <span>
        <span className="text-lg font-semibold text-foreground">
          {current ?? "—"}
        </span>
        {desired !== undefined && desired !== current && <> → {desired}</>}{" "}
        replicas
      </span>
      <span>
        range {min}–{max ?? "∞"}
      </span>
    </div>
  );

  if (top > 24) {
    const pct = (v: number) => `${(v / top) * 100}%`;
    return (
      <div className="space-y-2">
        {legend}
        <div className="relative h-2 rounded-full bg-muted">
          <div
            className="absolute inset-y-0 rounded-full bg-primary/20"
            style={{ left: pct(min), width: pct((max ?? top) - min) }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: pct(current ?? 0) }}
          />
          {desired !== undefined && (
            <div
              className="absolute -top-1 h-4 w-0.5 rounded bg-foreground"
              style={{ left: pct(desired) }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {legend}
      <div className="flex flex-wrap gap-1.5" aria-hidden>
        {Array.from({ length: top }, (_, i) => {
          const running = current !== undefined && i < current;
          const wanted = !running && desired !== undefined && i < desired;
          const allowed = i < (max ?? top) && (i >= min || running);
          return (
            <span
              key={i}
              className={cn(
                "size-3 rounded-full border",
                running && "border-primary bg-primary",
                wanted && "border-primary border-dashed",
                !running && !wanted && "border-border",
                !allowed && "opacity-40",
                i < min && !running && "bg-muted",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

function ObjectCard({
  icon,
  title,
  kind,
  result,
  loading,
  absent,
  state,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  kind: string;
  result?: ObjectResult;
  loading: boolean;
  absent: string;
  state?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            <div
              className="font-mono text-xs break-words text-muted-foreground"
              title={result?.ref.apiVersion}
            >
              {kind}
              {result && (
                <>
                  {" · "}
                  <span className="inline-block max-w-full break-words">{result.ref.name}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state}
          {action}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">{absent}</p>
        ) : result.error ? (
          <Callout>{result.error}</Callout>
        ) : result.missing ? (
          <Callout>
            helm applied this {kind}, but it is no longer in the cluster.
          </Callout>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

// observedGeneration behind generation: the spec changed and the controller has
// not acted on it yet, so the status describes the previous one.
function Stale({
  generation,
  observed,
}: {
  generation?: number;
  observed?: number;
}) {
  if (
    generation === undefined ||
    observed === undefined ||
    observed >= generation
  )
    return null;
  return (
    <Callout>
      The controller has not caught up with the latest spec (generation{" "}
      {generation}, observed {observed}).
    </Callout>
  );
}

export function Conditions({ conditions }: { conditions?: Condition[] }) {
  if (!conditions?.length) return null;
  return (
    <ul className="mt-auto space-y-1.5 border-t pt-3">
      {conditions.map((c) => (
        <li key={c.type} className="text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                c.status === "True"
                  ? "bg-success"
                  : c.status === "False"
                    ? "bg-warning"
                    : "bg-muted-foreground",
              )}
            />
            <span className="font-medium">{c.type}</span>
            {c.reason && (
              <span className="text-muted-foreground">{c.reason}</span>
            )}
            {c.lastTransitionTime && (
              <span className="ml-auto shrink-0 text-muted-foreground">
                {timeAgo(c.lastTransitionTime)}
              </span>
            )}
          </div>
          {c.message && (
            <p className="mt-0.5 pl-3 break-words text-muted-foreground">
              {c.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Stats({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warn";
}) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-2">
      <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {children}
    </dl>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
