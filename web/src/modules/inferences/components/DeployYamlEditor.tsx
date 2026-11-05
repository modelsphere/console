import { useState } from "react";
import { Alert, AlertDescription, Button, FieldTextarea, FloatingField, SectionCard } from "@modelsphere/ui";
import type { Plan } from "@swiss/lib/api";
import { deploymentYaml, parseDeploymentYaml } from "../deploy-yaml";
import { useT } from "../i18n";

export function DeployYamlEditor({ plan, busy, error, onSave, onCancel, onDirtyChange }: {
  plan: Plan;
  busy: boolean;
  error?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useT();
  const [baseline] = useState(() => deploymentYaml(plan));
  const [text, setText] = useState(baseline);
  const [validationError, setValidationError] = useState<string>();
  const validate = (value: string) => {
    try {
      parseDeploymentYaml(value);
      setValidationError(undefined);
      return true;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  return (
    <SectionCard title={t("deploy.review.editYaml")}>
      <FloatingField label="YAML" hint={t("deploy.review.yamlHint")} multiline>
        <FieldTextarea aria-label={t("deploy.review.editYaml")} aria-invalid={!!validationError} value={text} onChange={(event) => { setText(event.target.value); onDirtyChange(event.target.value !== baseline); validate(event.target.value); }} rows={24} spellCheck={false} disabled={busy} className="font-mono text-xs" />
      </FloatingField>
      {(validationError || error) && <Alert variant="destructive"><AlertDescription>{validationError || error}</AlertDescription></Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>{t(text === baseline ? "deploy.review.returnToReview" : "deploy.review.discardYaml")}</Button>
        <Button onClick={() => { if (validate(text)) onSave(text); }} disabled={busy}>{t(busy ? "deploy.review.composing" : "deploy.review.saveYaml")}</Button>
      </div>
    </SectionCard>
  );
}
