import { FieldInput, FloatingField, Switch } from "@modelsphere/ui";
import { useT } from "../i18n";
import type { RecoverySettings } from "../recovery";

export function RecoveryFields({ settings, onChange }: { settings: RecoverySettings; onChange: (patch: Partial<RecoverySettings>) => void }) {
  const t = useT();
  return (
    <FloatingField
      layout="inline"
      label={t("deploy.recovery.title")}
      hint={t("deploy.recovery.hint")}
      expanded={settings.enabled}
      expandedContent={
        <div className="space-y-3 pb-3">
          <p className="text-xs text-muted-foreground">{t("deploy.recovery.requirements")}</p>
          <FloatingField label={t("deploy.recovery.model")} required hint={t("deploy.recovery.modelHint")}>
            <FieldInput value={settings.model} onChange={(event) => onChange({ model: event.target.value })} />
          </FloatingField>
          <FloatingField label={t("deploy.recovery.timeout")} hint={t("deploy.recovery.timeoutHint")}>
            <FieldInput value={settings.idleTimeout} inputMode="decimal" onChange={(event) => onChange({ idleTimeout: event.target.value })} />
          </FloatingField>
          <FloatingField layout="inline" label={t("deploy.recovery.resume")} hint={t("deploy.recovery.resumeHint")}>
            <Switch aria-label={t("deploy.recovery.resume")} checked={settings.resumeEnabled} onCheckedChange={(value) => onChange({ resumeEnabled: value })} />
          </FloatingField>
          <FloatingField layout="inline" label={t("deploy.recovery.buffer")} hint={t("deploy.recovery.bufferHint")}>
            <Switch aria-label={t("deploy.recovery.buffer")} checked={settings.bufferToolCalls} onCheckedChange={(value) => onChange({ bufferToolCalls: value })} />
          </FloatingField>
          <p className="text-xs text-muted-foreground">{t("deploy.recovery.compatibility")}</p>
        </div>
      }
    >
      <Switch aria-label={t("deploy.recovery.title")} checked={settings.enabled} onCheckedChange={(value) => onChange({ enabled: value })} />
    </FloatingField>
  );
}
