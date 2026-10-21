import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, FieldTextarea, FloatingField, Tabs, TabsList, TabsTrigger } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { api, type ProfileResponse, type SiteProfile } from "@swiss/lib/api";
import { markSetUp } from "@swiss/components/Session";
import { useT } from "@/modules/inferences/i18n";
import { profileErrors } from "@/modules/inferences/profile-lib";
import { ProfileForm } from "@/modules/inferences/components/ProfileForm";
import { checkCatalogChanges, listSecrets, syncCatalogTokens } from "@/modules/inferences/catalog-write-api";
import { catalogChanges, catalogTokenKey, keepsToken } from "@/modules/inferences/catalog-write-lib";

export type Mode = "form" | "yaml";

export function useProfileEditor(profile: SiteProfile, yaml: string, onSaved: (r: ProfileResponse) => void) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("form");
  const [form, setForm] = useState<SiteProfile>(profile);
  const [text, setText] = useState(yaml);
  const [submitted, setSubmitted] = useState(false);
  // Writable catalogs' tokens, by catalog name: kept beside the profile, never in it.
  const [tokens, setTokens] = useState<Record<string, string>>({});
  // Why swissd did not keep a token, by catalog name, until it is typed again;
  // and whether the profile was saved all the same.
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [savedAnyway, setSavedAnyway] = useState(false);
  const stored = useQuery({ queryKey: ["secrets"], queryFn: listSecrets, retry: false }).data?.keys ?? [];
  const save = useMutation({
    mutationFn: async () => {
      // The form's catalogs only: the YAML text is not read for them.
      const changes = mode === "form" ? catalogChanges(form, tokens) : [];
      // Tried first, at the url the form gives each catalog, so a writable catalog is not saved
      // before its token is taken: one refused saves nothing.
      const unchecked = await checkCatalogChanges(changes);
      if (Object.keys(unchecked).length > 0) return { r: null, notKept: unchecked };
      const r = mode === "form" ? await api.saveProfile({ profile: form }) : await api.saveProfile({ yaml: text });
      return { r, notKept: await syncCatalogTokens(profile, r.profile, changes) };
    },
    onMutate: () => setRefused({}),
    onSuccess: ({ r, notKept }) => {
      setRefused(Object.fromEntries(Object.entries(notKept).map(([name, err]) => [name, err.message])));
      setSavedAnyway(r !== null);
      if (!r) return;
      for (const key of [["profile"], ["cluster"], ["catalog"], ["secrets"]]) qc.invalidateQueries({ queryKey: key });
      setTokens((s) => Object.fromEntries(Object.entries(s).filter(([name]) => name in notKept)));
      // A token refused after the profile saved keeps the editor open on it. markSetUp waits
      // too, as it is what moves the gate off the setup page.
      if (Object.keys(notKept).length > 0) return;
      markSetUp(qc);
      onSaved(r);
    },
  });
  // A catalog renamed in the form keeps the token typed for it.
  const changeForm = (next: SiteProfile) => {
    const before = form.catalogs ?? [];
    const after = next.catalogs ?? [];
    const renamed = before.length === after.length ? before.flatMap((c, i) => (c.name !== after[i].name ? [[c.name, after[i].name]] : [])) : [];
    if (renamed.length > 0)
      setTokens((s) => {
        const moved = { ...s };
        for (const [from, to] of renamed) {
          if (!(from in moved)) continue;
          moved[to] = moved[from];
          delete moved[from];
        }
        return moved;
      });
    setForm(next);
  };
  const submit = () => {
    setSubmitted(true);
    if (mode === "form" ? profileErrors(form).length === 0 : !!text.trim()) save.mutate();
  };
  // A stored token outlives the save only if the catalog is not edited but for default.
  const token = (name: string) => ({
    value: tokens[name] ?? "",
    stored: stored.includes(catalogTokenKey(name)) && keepsToken(form, profile, name),
    dropped: stored.includes(catalogTokenKey(name)) && !keepsToken(form, profile, name),
    refused: refused[name],
    onChange: (v: string) => {
      setTokens((s) => ({ ...s, [name]: v }));
      setRefused((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== name)));
    },
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(profile) || text !== yaml || Object.values(tokens).some(Boolean);
  return { mode, setMode, form, setForm: changeForm, text, setText, submitted, save, submit, token, refused: Object.keys(refused), savedAnyway, dirty };
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
      {editor.refused.length > 0 && (
        <Alert variant={editor.savedAnyway ? "warning" : "destructive"}>
          <TriangleAlert />
          <AlertDescription>{t(editor.savedAnyway ? "profile.token.notSaved" : "profile.token.checkFailed", { catalogs: editor.refused.join(", ") })}</AlertDescription>
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
