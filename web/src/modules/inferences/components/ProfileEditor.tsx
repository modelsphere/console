import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, FieldTextarea, FloatingField, Tabs, TabsList, TabsTrigger } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { api, type ProfileResponse, type SiteProfile } from "@swiss/lib/api";
import { markSetUp } from "@swiss/components/Session";
import { useT } from "@/modules/inferences/i18n";
import { profileErrors } from "@/modules/inferences/profile-lib";
import { ProfileForm } from "@/modules/inferences/components/ProfileForm";

export type Mode = "form" | "yaml";

export function useProfileEditor(profile: SiteProfile, yaml: string, onSaved: (r: ProfileResponse) => void) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("form");
  const [form, setForm] = useState<SiteProfile>(profile);
  const [text, setText] = useState(yaml);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => (mode === "form" ? api.saveProfile({ profile: form }) : api.saveProfile({ yaml: text })),
    onSuccess: (r) => {
      markSetUp(qc);
      for (const key of [["profile"], ["cluster"], ["catalog"]]) qc.invalidateQueries({ queryKey: key });
      onSaved(r);
    },
  });
  const submit = () => {
    setSubmitted(true);
    if (mode === "form" ? profileErrors(form).length === 0 : !!text.trim()) save.mutate();
  };
  return { mode, setMode, form, setForm, text, setText, submitted, save, submit, dirty: JSON.stringify(form) !== JSON.stringify(profile) || text !== yaml };
}

export function ProfileEditorBody({ editor, collapsible }: { editor: ReturnType<typeof useProfileEditor>; collapsible?: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={editor.mode} onValueChange={(v) => editor.setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="form">{t("profile.modes.form")}</TabsTrigger>
          <TabsTrigger value="yaml">{t("profile.modes.yaml")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {editor.save.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{editor.save.error.message}</AlertDescription>
        </Alert>
      )}
      {editor.mode === "form" ? (
        <ProfileForm value={editor.form} onChange={editor.setForm} submitted={editor.submitted} collapsible={collapsible} />
      ) : (
        <FloatingField label="profile.yaml" multiline>
          <FieldTextarea value={editor.text} onChange={(e) => editor.setText(e.target.value)} rows={28} spellCheck={false} className="font-mono text-xs" />
        </FloatingField>
      )}
    </div>
  );
}

export function SaveButton({ editor, label }: { editor: ReturnType<typeof useProfileEditor>; label: string }) {
  const t = useT();
  return (
    <Button onClick={editor.submit} disabled={editor.save.isPending}>
      {editor.save.isPending ? t("profile.saving") : label}
    </Button>
  );
}
