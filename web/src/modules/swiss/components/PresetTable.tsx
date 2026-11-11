import { useState } from "react";
import { Pencil, Plus, TriangleAlert, X } from "lucide-react";
import type { SiteProfile } from "@swiss/lib/api";
import { hasPresetErrors, presetErrors, presetRow, putPreset, type PresetRow } from "@swiss/lib/profile";
import { Button } from "@swiss/components/ui/button";
import { Dialog } from "@swiss/components/ui/dialog";
import { Input } from "@swiss/components/ui/input";
import { cn } from "@swiss/lib/utils";

const BAD = "border-destructive";

// The profile's presets, each edited in a dialog: a preset goes into the
// profile only once its name and values are valid.
export function PresetTable({ presets, onChange }: { presets: SiteProfile["presets"]; onChange: (next: SiteProfile["presets"]) => void }) {
  // null adds a preset; a name opens that one.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const list = Object.entries(presets ?? {});
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">None: a deploy has no preset to pick.</p>}
      {list.map(([name, p]) => (
        <div key={name} className="flex items-center gap-2 rounded-md border px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-mono font-medium">{name}</span>
              {p.description && <span className="ml-2 text-muted-foreground">{p.description}</span>}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{Object.keys(p.values ?? {}).join(", ") || "no values"}</div>
          </div>
          <IconButton label={`edit ${name}`} onClick={() => setOpen(name)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`remove ${name}`} danger onClick={() => onChange(putPreset(presets, name))}>
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)} className="text-primary hover:text-primary">
        <Plus className="size-4" /> Add preset
      </Button>
      {open !== undefined && (
        <PresetDialog
          from={open ?? undefined}
          value={presetRow(open ?? "", open === null ? undefined : presets?.[open])}
          others={list.map(([n]) => n).filter((n) => n !== open)}
          onClose={() => setOpen(undefined)}
          onSave={(row) => {
            onChange(putPreset(presets, open ?? undefined, row));
            setOpen(undefined);
          }}
        />
      )}
    </div>
  );
}

function PresetDialog({ from, value, others, onClose, onSave }: { from?: string; value: PresetRow; others: string[]; onClose: () => void; onSave: (row: PresetRow) => void }) {
  const [row, setRow] = useState(value);
  const [submitted, setSubmitted] = useState(false);
  const errs = presetErrors(row, others);
  const bad = (e?: unknown) => submitted && !!e;
  const edit = (patch: Partial<PresetRow>) => setRow((r) => ({ ...r, ...patch }));
  const save = () => {
    setSubmitted(true);
    if (!hasPresetErrors(errs)) onSave(row);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={from === undefined ? "Add preset" : "Edit preset"}
      subtitle="Chart values a deploy may pick, merged into its form values. They are not checked against the chart here."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Input
            className={cn("font-mono text-xs", bad(errs.name) && BAD)}
            aria-invalid={bad(errs.name)}
            value={row.name}
            onChange={(e) => edit({ name: e.target.value })}
            placeholder="name"
            aria-label="preset name"
          />
          <Input value={row.description} onChange={(e) => edit({ description: e.target.value })} placeholder="description, shown in the deploy picker" aria-label="preset description" />
        </div>
        <textarea
          value={row.values}
          onChange={(e) => edit({ values: e.target.value })}
          spellCheck={false}
          rows={16}
          aria-label="preset values YAML"
          aria-invalid={bad(errs.values)}
          placeholder={"tolerations:\n  - key: example\n    operator: Exists"}
          className={cn("w-full rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed", bad(errs.values) && BAD)}
        />
        {submitted && hasPresetErrors(errs) && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {errs.name === "required" && "Needs a name. "}
            {errs.name === "duplicate" && "Another preset has this name. "}
            {errs.values === "map" && "Values must be a map of chart keys."}
            {errs.values === "yaml" && `Not valid YAML: ${errs.yaml}`}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function IconButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("rounded-md p-1.5 text-muted-foreground transition-colors", danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground")}
    >
      {children}
    </button>
  );
}
