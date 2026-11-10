import { useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FieldInput, FieldTextarea, FloatingField } from "@modelsphere/ui";
import { Pencil, Plus, X } from "lucide-react";
import type { SiteProfile } from "@swiss/lib/api";
import { hasPresetErrors, presetErrors, presetRow, putPreset, type PresetRow } from "@swiss/lib/profile";
import { useT } from "@/modules/inferences/i18n";

// The profile's presets, each edited in a dialog: a preset goes into the
// profile only once its name and values are valid.
export function PresetTable({ presets, onChange }: { presets: SiteProfile["presets"]; onChange: (next: SiteProfile["presets"]) => void }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  // null adds a preset; a name opens that one.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const list = Object.entries(presets ?? {});
  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 && <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{f("presetsNone")}</p>}
      {list.map(([name, p]) => (
        <div key={name} className="flex items-center gap-2 rounded-md border px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-mono font-medium">{name}</span>
              {p.description && <span className="ms-2 text-muted-foreground">{p.description}</span>}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{Object.keys(p.values ?? {}).join(", ") || f("presetNoValues")}</div>
          </div>
          <Button variant="ghost" size="icon" className="size-8" aria-label={f("presetEdit")} onClick={() => setOpen(name)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={() => onChange(putPreset(presets, name))}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen(null)}>
        <Plus className="size-3.5" /> {f("presetAdd")}
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
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const [row, setRow] = useState(value);
  const [submitted, setSubmitted] = useState(false);
  const errs = presetErrors(row, others);
  const edit = (patch: Partial<PresetRow>) => setRow((r) => ({ ...r, ...patch }));
  const save = () => {
    setSubmitted(true);
    if (!hasPresetErrors(errs)) onSave(row);
  };
  const valuesError = errs.values === "yaml" ? t("profile.errors.preset.yaml", { error: errs.yaml }) : errs.values === "map" ? t("profile.errors.preset.map") : undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{from === undefined ? f("presetAdd") : f("presetEdit")}</DialogTitle>
          <DialogDescription>{t("profile.hints.presets")}</DialogDescription>
        </DialogHeader>
        <div className={`flex flex-col ${submitted && hasPresetErrors(errs) ? "gap-5" : "gap-3"}`}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <FloatingField label={f("presetName")} required error={submitted && errs.name ? t(`profile.errors.preset.${errs.name}`) : undefined}>
              <FieldInput value={row.name} onChange={(e) => edit({ name: e.target.value })} className="font-mono text-xs" />
            </FloatingField>
            <FloatingField label={f("presetDescription")} hint={f("presetDescriptionHint")}>
              <FieldInput value={row.description} onChange={(e) => edit({ description: e.target.value })} />
            </FloatingField>
          </div>
          <FloatingField label={f("presetValues")} hint={f("presetValuesHint")} error={submitted ? valuesError : undefined} multiline>
            <FieldTextarea value={row.values} onChange={(e) => edit({ values: e.target.value })} rows={16} spellCheck={false} className="font-mono text-xs" />
          </FloatingField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={save}>{t("common:actions.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
