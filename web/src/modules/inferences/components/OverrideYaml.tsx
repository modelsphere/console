import { useEffect, useState } from "react";
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FieldInput, FloatingField } from "@modelsphere/ui";
import { Pencil, RefreshCw } from "lucide-react";
import { useT } from "../i18n";
import { overridePaths, parseValues, readYaml } from "../override-yaml";
import { configurationOverrides } from "../configuration-overrides";
import { ConfigurationOverrides } from "./ConfigurationOverrides";
import { ConfigurationPanes } from "./ConfigurationPanes";
import type { HelmValuesSource } from "../use-deployment-values";
export type { HelmValuesSource } from "../use-deployment-values";

export function OverrideYaml({ value, onChange, source, open, onOpenChange }: { value: string; onChange: (value: string) => void; source?: HelmValuesSource; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const visible = open ?? localOpen;
  useEffect(() => { source?.onOpenChange(visible); }, [visible, source?.onOpenChange]);
  const paths = overridePaths(value);
  const toggle = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  return (
    <>
      <FloatingField label={t("deploy.fields.edits")} error={paths ? undefined : t("deploy.overrides.invalid")} action={<Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.edit")} onClick={() => toggle(true)}><Pencil className="size-3.5" /></Button>}>
        <FieldInput readOnly value={paths?.join(", ") ?? ""} onClick={() => toggle(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(true); } }} className="cursor-pointer font-mono text-xs" />
      </FloatingField>
      {visible && <ConfigurationDialog value={value} onChange={onChange} source={source} onClose={() => toggle(false)} />}
    </>
  );
}

function ConfigurationDialog({ value, onChange, source, onClose }: { value: string; onChange: (value: string) => void; source?: HelmValuesSource; onClose: () => void }) {
  const t = useT();
  const read = readYaml(value);
  const error = read.error ?? source?.error?.message;
  const overrides = read.values && source?.data ? configurationOverrides(source.data.plan, read.values, parseValues(source.data.effective), source.data.policy) : [];
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[85vh] max-h-[calc(100vh-2rem)] w-[min(96vw,100rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]">
        <DialogHeader><DialogTitle>{t("deploy.fields.edits")}</DialogTitle><DialogDescription className="sr-only">{t("deploy.draft.description")}</DialogDescription></DialogHeader>
        <ConfigurationPanes value={value} onChange={onChange} source={source} />
        <ConfigurationOverrides items={overrides} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          {source && <Button variant="outline" onClick={() => source.load()} disabled={source.loading || !!readYaml(value).error}><RefreshCw className="size-3.5" />{t("deploy.draft.refresh")}</Button>}
          <Button onClick={onClose}>{t("common:actions.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
