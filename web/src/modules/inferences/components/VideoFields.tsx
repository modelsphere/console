import { FieldInput, FloatingField, Switch } from "@modelsphere/ui";
import { videoGpus, videoProblem, type PoolForm, type VideoFields } from "@swiss/lib/video";
import { DEFAULTS, KEYS, POOLS, type Pool } from "@swiss/lib/videoChart";
import { useT } from "@/modules/inferences/i18n";

interface Props {
  value: VideoFields;
  onChange: (next: VideoFields) => void;
  upgrade?: boolean;
  submitted?: boolean;
}

// The video chart's own fields, which DeployForm puts in its sections for a
// video variant: everything else in the form is the LLM form's.

// VideoStorage is the shared asset volume and the job database, in Basic.
// The storage class is asked only when the variant does not declare it as an
// input, which the input field then asks instead.
export function VideoStorage({ value, onChange, upgrade, classInput }: Props & { classInput?: boolean }) {
  const t = useT();
  const f = (k: string) => t(`deploy.video.${k}`);
  const shown = (v: string, fallback: string) => v || fallback;
  const set = (patch: Partial<VideoFields>) => onChange({ ...value, ...patch });
  // On an upgrade an empty field keeps what the release has: say what that is.
  const now = value.current;
  const sizeNow = upgrade ? t("deploy.video.storageSizeCurrent", { size: now?.storageSize || DEFAULTS.storageSize }) : DEFAULTS.storageSize;
  const classNow = upgrade && now?.storageClass ? now.storageClass : f("storageClassDefault");
  return (
    <>
      {!classInput && (
        <FloatingField value={shown(value.storageClass, classNow)} label={f("storageClass")} hint={upgrade ? f("storageClassLocked") : f("storageClassHint")} disabled={upgrade}>
          <FieldInput value={value.storageClass} onChange={(e) => set({ storageClass: e.target.value })} placeholder={classNow} disabled={upgrade} />
        </FloatingField>
      )}
      <FloatingField value={shown(value.storageSize, sizeNow)} label={f("storageSize")} hint={upgrade ? f("storageSizeGrowOnly") : f("storageSizeHint")}>
        <FieldInput value={value.storageSize} onChange={(e) => set({ storageSize: e.target.value })} placeholder={sizeNow} />
      </FloatingField>
      <FloatingField value={shown(value.databaseUrl, value.databaseKept ? f("databaseKept") : f("databaseDefault"))} label={f("database")} hint={value.databaseKept ? f("databaseKeptHint") : f("databaseHint")}>
        <FieldInput type="password" autoComplete="off" value={value.databaseUrl} onChange={(e) => set({ databaseUrl: e.target.value })} placeholder={value.databaseKept ? f("databaseKept") : f("databaseDefault")} />
      </FloatingField>
    </>
  );
}

// VideoPools is the two pools, their parallelism and Turbo, in Resources.
export function VideoPools({ value, onChange, submitted }: Props) {
  const t = useT();
  const f = (k: string, o?: Record<string, unknown>) => t(`deploy.video.${k}`, o);
  const gpus = videoGpus(value);
  const problem = submitted ? videoProblem(value) : undefined;
  const shown = (v: string, fallback: string) => v || fallback;
  const setPool = (p: Pool, patch: Partial<PoolForm>) => onChange({ ...value, pools: { ...value.pools, [p]: { ...value.pools[p], ...patch } } });
  const digits = (p: Pool, k: keyof Omit<PoolForm, "enabled">) => ({
    value: value.pools[p][k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPool(p, { [k]: e.target.value.replace(/\D/g, "") }),
    inputMode: "numeric" as const,
  });
  return (
    <div className="flex flex-col gap-3" data-testid="video-pools">
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="video-total-gpus">
        <span className="font-medium">{f("totalGpus", { n: gpus.total })}</span>
      </div>
      {problem && <p className="text-sm text-destructive">{f(`problems.${problem.code}`)}</p>}
      {POOLS.map((p) => {
        const pf = value.pools[p];
        return (
          <div key={p} className="flex flex-col gap-3 rounded-lg border bg-background p-3">
            <FloatingField layout="inline" label={f(`pools.${p}.title`)} hint={f(`pools.${p}.hint`)} description={pf.enabled ? f("perPod", { n: gpus.perPod[p] }) : f("poolOff")}>
              <Switch aria-label={f(`pools.${p}.title`)} checked={pf.enabled} onCheckedChange={(enabled) => setPool(p, { enabled })} />
            </FloatingField>
            {pf.enabled && (
              <div className="grid grid-cols-3 gap-3">
                <FloatingField value={shown(pf.replicaCount, String(DEFAULTS.replicaCount))} label={f("replicas")}>
                  <FieldInput {...digits(p, "replicaCount")} placeholder={String(DEFAULTS.replicaCount)} />
                </FloatingField>
                <FloatingField value={shown(pf.tpSize, String(DEFAULTS.tpSize))} label={f("tpSize")} hint={f("parallelHint")}>
                  <FieldInput {...digits(p, "tpSize")} placeholder={String(DEFAULTS.tpSize)} />
                </FloatingField>
                <FloatingField value={shown(pf.ulyssesDegree, String(DEFAULTS.ulyssesDegree))} label={f("ulyssesDegree")} hint={f("parallelHint")}>
                  <FieldInput {...digits(p, "ulyssesDegree")} placeholder={String(DEFAULTS.ulyssesDegree)} />
                </FloatingField>
              </div>
            )}
            {p === "ref2va" && pf.enabled && (
              <FloatingField layout="inline" label={f("turbo")} hint={f("turboHint")}>
                <Switch aria-label={f("turbo")} checked={value.turbo} onCheckedChange={(turbo) => onChange({ ...value, turbo })} />
              </FloatingField>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The variant asks the shared volume's class as an input.
export const declaresStorageClass = (inputs: { input: { key: string } }[] | undefined) => !!inputs?.some((r) => r.input.key === KEYS.storageClass);
