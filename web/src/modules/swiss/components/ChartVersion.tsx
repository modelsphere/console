import { ArrowRight } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ChartVersions, Plan } from "@swiss/lib/api";
import { cn } from "@swiss/lib/utils";
import { HoverHint } from "@swiss/components/ui/hint";
import { Input } from "@swiss/components/ui/input";

// One row of a target card: what is deployed, and what this will move it to.
// Without from (an install) the row is just label and control.
export function TargetRow({
  label,
  hint,
  from,
  changing,
  caption,
  tone = "muted",
  children,
}: {
  label: string;
  hint?: string;
  from?: string;
  changing?: boolean;
  caption?: React.ReactNode;
  tone?: "muted" | "warning" | "destructive";
  children: React.ReactNode;
}) {
  const upgrade = from !== undefined;
  return (
    <div
      className={cn(
        "grid gap-x-3 gap-y-1 py-2.5 sm:items-center",
        upgrade ? "sm:grid-cols-[11rem_minmax(0,10rem)_1rem_minmax(0,1fr)]" : "sm:grid-cols-[11rem_minmax(0,1fr)]",
      )}
    >
      <HoverHint text={hint}>
        <span className="text-sm font-medium">{label}</span>
      </HoverHint>
      {upgrade && (
        <>
          <span className="truncate font-mono text-sm text-muted-foreground" title={from}>
            {from || "—"}
          </span>
          <ArrowRight
            className={cn("hidden size-4 sm:block", changing ? "text-success" : "text-muted-foreground/40")}
            aria-hidden
          />
        </>
      )}
      <div className="min-w-0">
        <div className={cn("rounded-md", changing && "ring-1 ring-success/50")}>{children}</div>
        {caption && (
          <p
            className={cn(
              "mt-1 text-xs leading-snug",
              tone === "muted" && "text-muted-foreground",
              tone === "warning" && "text-warning",
              tone === "destructive" && "text-destructive",
            )}
          >
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

// The chart version control and what it resolves to. Empty means swissd's
// default: on an upgrade the running chart while the catalog's range allows it,
// else (and on an install) the newest in range.
export function chartVersionChoice({
  running,
  list,
  value,
  onChange,
}: {
  running?: Plan["chart"];
  list: UseQueryResult<ChartVersions>;
  value: string;
  onChange: (v: string) => void;
}): { control: React.ReactNode; caption?: string; tone: "muted" | "destructive"; resolved?: string } {
  if (list.error) {
    return {
      control: (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={running ? `keep ${running.version} if in range` : "type a version, e.g. 0.8.6"}
        />
      ),
      caption: `Could not list versions: ${list.error.message}`,
      tone: "destructive",
      resolved: value || running?.version,
    };
  }
  const d = list.data;
  if (!d) {
    return {
      control: <Select value="" onChange={onChange} options={[]} emptyLabel="listing versions…" disabled />,
      tone: "muted",
    };
  }
  const pinned = d.versions.length === 1 && d.versions[0] === d.range;
  const keep = !!running && running.name === d.chart && d.versions.includes(running.version);
  const fallback = keep ? running!.version : d.versions[0];
  const emptyLabel = !fallback
    ? "none in range"
    : keep
      ? `keep ${fallback}`
      : pinned
        ? `${fallback} (pinned)`
        : `newest: ${fallback}`;
  return {
    control: (
      <Select
        value={value}
        onChange={onChange}
        options={pinned ? [] : d.versions}
        emptyLabel={emptyLabel}
        disabled={pinned}
      />
    ),
    caption: pinned ? "Pinned by the catalog" : `Catalog allows ${d.range}`,
    tone: "muted",
    resolved: value || fallback,
  };
}

type Option = string | { value: string; label: string; disabled?: boolean };

export function Select({
  value,
  onChange,
  options,
  emptyLabel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  emptyLabel: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="h-9 w-full rounded-md border bg-background px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}
