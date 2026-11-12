import { videoGpus, videoProblem, type PoolForm, type VideoFields } from "@swiss/lib/video";
import { DEFAULTS, KEYS, POOL_LABELS, POOLS, type Pool } from "@swiss/lib/videoChart";
import { Row } from "@swiss/components/DeploySettings";
import { Card, CardContent, CardHeader, CardTitle } from "@swiss/components/ui/card";
import { Input } from "@swiss/components/ui/input";
import { Switch } from "@swiss/components/ui/switch";

// The video chart's own settings, which DeploySettings shows for a video
// variant beside the rest of the form it shares with an LLM deploy: the pools,
// Turbo, the shared asset volume and the job database.
export function VideoSettings({
  value,
  onChange,
  lockIdentity = false,
  // The variant asks the storage class as an input, and the input row asks it.
  classInput = false,
}: {
  value: VideoFields;
  onChange: (next: VideoFields) => void;
  lockIdentity?: boolean;
  classInput?: boolean;
}) {
  const gpus = videoGpus(value);
  const problem = videoProblem(value);
  const set = (patch: Partial<VideoFields>) => onChange({ ...value, ...patch });
  const setPool = (p: Pool, patch: Partial<PoolForm>) => set({ pools: { ...value.pools, [p]: { ...value.pools[p], ...patch } } });
  const digits = (p: Pool, k: keyof Omit<PoolForm, "enabled">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPool(p, { [k]: e.target.value.replace(/\D/g, "") });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
            Pools
            <span className="text-sm font-normal text-muted-foreground" data-testid="video-total-gpus">
              {gpus.total} GPU{gpus.total === 1 ? "" : "s"} in total
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Each pod is one server and one SGLang on tp × ulysses GPUs, running one generation at a time: more
            concurrency is more replicas.
          </p>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {problem && <p className="py-2 text-sm text-destructive">{problem.code === "zero" ? "Replicas, TP and Ulysses must each be at least 1." : "Enable at least one pool."}</p>}
          {POOLS.map((p) => {
            const pf = value.pools[p];
            return (
              <div key={p} className="py-1">
                <Row
                  label={POOL_LABELS[p].title}
                  note={`${POOL_LABELS[p].note} (${KEYS.pool(p).enabled})`}
                  caption={pf.enabled ? `${gpus.perPod[p]} GPUs per pod` : "off"}
                  toggle={<Switch checked={pf.enabled} onChange={(v) => setPool(p, { enabled: v })} label={`enable ${p}`} />}
                >
                  {pf.enabled && (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                      <Labeled label="replicas">
                        <Input value={pf.replicaCount} onChange={digits(p, "replicaCount")} inputMode="numeric" aria-label={`${p} replicas`} placeholder={String(DEFAULTS.replicaCount)} />
                      </Labeled>
                      <Labeled label="tp">
                        <Input value={pf.tpSize} onChange={digits(p, "tpSize")} inputMode="numeric" aria-label={`${p} tp size`} placeholder={String(DEFAULTS.tpSize)} />
                      </Labeled>
                      <Labeled label="ulysses">
                        <Input value={pf.ulyssesDegree} onChange={digits(p, "ulyssesDegree")} inputMode="numeric" aria-label={`${p} ulysses degree`} placeholder={String(DEFAULTS.ulyssesDegree)} />
                      </Labeled>
                    </div>
                  )}
                </Row>
                {p === "ref2va" && pf.enabled && (
                  <Row
                    label="Turbo"
                    note="the 8-step Turbo LoRA and its sampling; off serves the base model"
                    toggle={<Switch checked={value.turbo} onChange={(v) => set({ turbo: v })} label="turbo" />}
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage and database</CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {!classInput && (
            <Row
              label="Storage class"
              note={
                lockIdentity
                  ? "fixed: the shared volume already exists, and a PVC's storage class cannot change"
                  : "the shared asset volume; must support ReadWriteMany (CephFS, NFS). Empty uses the cluster default"
              }
            >
              <Input value={value.storageClass} onChange={(e) => set({ storageClass: e.target.value })} disabled={lockIdentity} aria-label="storage class" placeholder={lockIdentity ? "kept" : "cluster default"} />
            </Row>
          )}
          <Row
            label="Storage size"
            note={
              lockIdentity
                ? "can only grow: the volume is kept across upgrades and uninstalls, and a PVC never shrinks. Empty keeps it"
                : "a quota, not a reservation; a CephFS volume grows in place but never shrinks"
            }
          >
            <Input value={value.storageSize} onChange={(e) => set({ storageSize: e.target.value })} aria-label="storage size" placeholder={lockIdentity ? "kept" : DEFAULTS.storageSize} />
          </Row>
          <Row
            label="Database URL"
            note={value.databaseKept ? "the release sets one already: empty keeps it" : "empty uses the chart's default, the platform's PostgreSQL"}
          >
            <Input
              type="password"
              autoComplete="off"
              value={value.databaseUrl}
              onChange={(e) => set({ databaseUrl: e.target.value })}
              aria-label="database URL"
              placeholder={value.databaseKept ? "kept" : "postgresql://user:password@host:5432/minimaxh3"}
            />
          </Row>
        </CardContent>
      </Card>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 basis-24 items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
