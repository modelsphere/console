import type { ApplyWith } from "@swiss/lib/api";
import type { LLMSVCBlock } from "@swiss/lib/applyWith";
import { Badge } from "@swiss/components/ui/badge";
import { cn } from "@swiss/lib/utils";

export const METHODS: Record<ApplyWith, { label: string; hint: string }> = {
  helm: { label: "Plan ConfigMap", hint: "swissd runs helm and keeps the plan in a ConfigMap beside the release." },
  llmsvc: { label: "LLMService", hint: "swissd writes an LLMService and llm-operator runs helm from it." },
};

const BLOCKED: Record<LLMSVCBlock, string> = {
  unserved: "the LLMService CRD is not served on this cluster",
  unavailable: "swissd cannot use LLMServices here; see the cluster warnings",
  schema: "LLMService installs need a catalog schema v2 model",
};

export function InstallMethodChoice({
  value,
  onChange,
  blocked,
  fallback,
}: {
  value: ApplyWith;
  onChange: (m: ApplyWith) => void;
  blocked?: LLMSVCBlock;
  // What an install naming none gets: the site profile's applyWith.
  fallback: ApplyWith;
}) {
  return (
    <div role="radiogroup" aria-label="install method" className="grid gap-2 sm:grid-cols-2">
      {(["helm", "llmsvc"] as const).map((m) => {
        const disabled = m === "llmsvc" && !!blocked;
        return (
          <label
            key={m}
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-sm",
              value === m && "border-primary",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name="applyWith"
              className="mt-1"
              checked={value === m}
              disabled={disabled}
              onChange={() => onChange(m)}
            />
            <span className="space-y-0.5">
              <span className="flex items-center gap-2 font-medium">
                {METHODS[m].label}
                {m === fallback && <Badge variant="muted">default</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {disabled ? `Unavailable: ${BLOCKED[blocked!]}.` : METHODS[m].hint}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
