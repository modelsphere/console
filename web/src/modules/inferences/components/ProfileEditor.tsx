import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, FieldTextarea, FloatingField, Tabs, TabsList, TabsTrigger } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { api, type ProfileResponse, type SiteProfile } from "@swiss/lib/api";
import { markSetUp } from "@swiss/components/Session";
import { useT } from "@/modules/inferences/i18n";
import { profileErrors } from "@/modules/inferences/profile-lib";
import { ProfileForm } from "@/modules/inferences/components/ProfileForm";
import { listSecrets, syncCatalogTokens } from "@/modules/inferences/catalog-write-api";

export type Mode = "form" | "yaml";

export function useProfileEditor(profile: SiteProfile, yaml: string, onSaved: (r: ProfileResponse) => void) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("form");
  const [form, setForm] = useState<SiteProfile>(profile);
  const [text, setText] = useState(yaml);
  const [submitted, setSubmitted] = useState(false);
  // Writable catalogs' tokens, by catalog name: kept beside the profile, never in it.
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const stored = useQuery({ queryKey: ["secrets"], queryFn: listSecrets, retry: false }).data?.keys ?? [];
  const save = useMutation({
    mutationFn: async () => {
      const r = mode === "form" ? await api.saveProfile({ profile: form }) : await api.saveProfile({ yaml: text });
      await syncCatalogTokens(r.profile, mode === "form" ? tokens : {});
      return r;
    },
    onSuccess: (r) => {
      markSetUp(qc);
      for (const key of [["profile"], ["cluster"], ["catalog"], ["secrets"]]) qc.invalidateQueries({ queryKey: key });
      onSaved(r);
    },
  });
  const submit = () => {
    setSubmitted(true);
    if (mode === "form" ? profileErrors(form).length === 0 : !!text.trim()) save.mutate();
  };
  const token = (name: string) => ({ value: tokens[name] ?? "", stored: stored.includes(`catalog.${name}.token`), onChange: (v: string) => setTokens((s) => ({ ...s, [name]: v })) });
  const dirty = JSON.stringify(form) !== JSON.stringify(profile) || text !== yaml || Object.values(tokens).some(Boolean);
  return { mode, setMode, form, setForm, text, setText, submitted, save, submit, token, dirty };
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
        <ProfileForm value={editor.form} onChange={editor.setForm} submitted={editor.submitted} collapsible={collapsible} token={editor.token} />
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
