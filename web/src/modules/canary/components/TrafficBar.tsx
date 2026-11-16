import { trafficShare } from "../lib/values";

export function TrafficBar({
  production,
  canary,
}: {
  production: number;
  canary: number;
}) {
  const share = trafficShare(production, canary);
  const prodPct = Math.round(share.production * 1000) / 10;
  const canPct = Math.round(share.canary * 1000) / 10;
  return (
    <div className="grid gap-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-muted-foreground/40"
          style={{ width: `${share.production * 100}%` }}
        />
        <div
          className="bg-primary"
          style={{ width: `${share.canary * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          prod {production} ({prodPct}%)
        </span>
        <span>
          canary {canary} ({canPct}%)
        </span>
      </div>
    </div>
  );
}
