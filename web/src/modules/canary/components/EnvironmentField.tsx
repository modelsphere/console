import { FieldInput, FloatingField } from "@modelsphere/ui";

export function EnvironmentField({
  label,
  value,
  hint,
  emptyText,
}: {
  label: string;
  value?: string;
  hint?: string;
  emptyText?: string;
}) {
  return (
    <FloatingField label={label} hint={hint}>
      <FieldInput
        readOnly
        value={value || emptyText || ""}
        className="bg-muted/30 text-muted-foreground"
      />
    </FloatingField>
  );
}
