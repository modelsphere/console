import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DataSelect, FieldHint, Switch, cn } from "@modelsphere/ui";
import { Download, RefreshCw } from "lucide-react";
import { CopyButton } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { defaultContainer, ofRelease } from "@/modules/inferences/lib";
import { workloadApi } from "@/modules/inferences/workload-api";

const LINES = [100, 500, 1000, 5000];
const SINCE = [
  { value: 0, key: "sinceAll" },
  { value: 300, key: "since5m" },
  { value: 3600, key: "since1h" },
  { value: 21600, key: "since6h" },
  { value: 86400, key: "since24h" },
];

export function Logs({ namespace, release, statusPods, initialPod }: { namespace: string; release: string; statusPods: readonly string[]; initialPod?: string }) {
  const t = useT();
  const [picked, setPod] = useState(initialPod ?? "");
  const [pickedContainer, setContainer] = useState("");
  const [lines, setLines] = useState(500);
  const [since, setSince] = useState(0);
  const [previous, setPrevious] = useState(false);
  const [follow, setFollow] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const atBottom = useRef(true);

  const list = useQuery({
    queryKey: ["k8s-pods", namespace, release],
    queryFn: () => workloadApi.pods(namespace, release),
    refetchInterval: 15_000,
    retry: false,
  });
  const listed = (list.data?.items ?? []).filter((p) => ofRelease(p.name, release, statusPods));
  const pods = listed.map((p) => p.name);
  const pod = pods.includes(picked) ? picked : (pods.find((p) => statusPods.includes(p)) ?? pods[0] ?? "");
  const containers = listed.find((p) => p.name === pod)?.containers ?? [];
  const container = containers.some((c) => c.name === pickedContainer) ? pickedContainer : defaultContainer(containers);

  const log = useQuery({
    queryKey: ["k8s-log", namespace, pod, container, lines, since, previous],
    queryFn: () => workloadApi.log(namespace, pod, { container, tailLines: lines, sinceSeconds: since, previous }),
    enabled: !!pod && !!container,
    refetchInterval: follow ? 5_000 : false,
    retry: false,
  });

  useEffect(() => {
    const el = pre.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [log.data]);

  if (list.isPending) return <p className="text-sm text-muted-foreground">{t("common:status.loading")}</p>;
  if (!pods.length && !list.error) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t("logs.noPods")}</p>;

  const text = log.data ?? "";
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${pod}-${container}.log` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <DataSelect
          className="w-80"
          value={pod}
          onValueChange={(v) => (setPod(v), setContainer(""))}
          aria-label={t("logs.pod")}
          options={listed.map((p) => {
            const restarts = p.containers.reduce((n, c) => n + c.restartCount, 0);
            return { value: p.name, label: p.name, description: [p.phase, restarts ? t("logs.restarts", { n: restarts }) : ""].filter(Boolean).join(" · ") };
          })}
        />
        <DataSelect
          className="w-56"
          value={container}
          onValueChange={setContainer}
          aria-label={t("logs.container")}
          options={containers.map((c) => ({
            value: c.name,
            label: c.init ? `${c.name} (${t("logs.init")})` : c.name,
            description: [c.reason ?? c.state, c.restartCount ? t("logs.restarts", { n: c.restartCount }) : ""].filter(Boolean).join(" · "),
          }))}
        />
        <DataSelect className="w-36" value={String(lines)} onValueChange={(v) => setLines(Number(v))} aria-label={t("logs.lines")} options={LINES.map((n) => ({ value: String(n), label: t("logs.linesN", { n }) }))} />
        <DataSelect className="w-36" value={String(since)} onValueChange={(v) => setSince(Number(v))} aria-label={t("logs.since")} options={SINCE.map((s) => ({ value: String(s.value), label: t(`logs.${s.key}`) }))} />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={previous} onCheckedChange={setPrevious} />
          {t("logs.previous")}
          <FieldHint>{t("logs.previousHint")}</FieldHint>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={follow} onCheckedChange={setFollow} />
          {t("logs.follow")}
        </label>
        <div className="ms-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => void log.refetch()} disabled={log.isFetching || !container}>
            <RefreshCw className={cn("size-3.5", log.isFetching && "animate-spin")} /> {t("logs.refresh")}
          </Button>
          <CopyButton text={text} label={t("logs.copy")} />
          <Button variant="outline" size="sm" onClick={download} disabled={!text}>
            <Download className="size-3.5" /> {t("logs.download")}
          </Button>
        </div>
      </div>
      {list.error || log.error ? (
        <p className="text-sm text-destructive">{(list.error ?? log.error)!.message}</p>
      ) : (
        <pre
          ref={pre}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-[60vh] overflow-auto rounded-md p-3 font-code text-xs leading-relaxed whitespace-pre-wrap break-all"
          style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}
        >
          {log.isPending && container ? t("logs.loading") : text || t("logs.empty")}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">{t("logs.truncated", { n: lines })}</p>
    </div>
  );
}

