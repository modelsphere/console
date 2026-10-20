import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  FieldInput,
  FloatingField,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@modelsphere/ui";
import { CircleCheck } from "lucide-react";
import { useT } from "@/modules/inferences/i18n";
import { CatalogWriteError, initCatalog } from "@/modules/inferences/catalog-write-api";
import { WriteErrorAlert } from "@/modules/inferences/components/VariantEditSheet";

// Setting an empty catalog up: catalog-server commits its catalog.yaml, saying
// where the catalog is served, and the rest of its template. url, where swissd
// reads the catalog, is where to start: the server there serves the history's
// commit and file pages too.
export function SetupSheet({ catalog, url, onClose, onDone }: { catalog: string; url?: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [site, setSite] = useState(url ?? "");
  const [repo, setRepo] = useState((url ?? "").replace(/\/+$/, ""));
  const write = useMutation({
    mutationFn: (dryRun: boolean) => initCatalog(catalog, { ...(site.trim() && { site: site.trim() }), ...(repo.trim() && { repo: repo.trim() }) }, { dryRun }),
    onSuccess: (_, dryRun) => {
      if (dryRun) return;
      onDone();
      onClose();
    },
    // Someone else set it up first: it is, all the same.
    onError: (err, dryRun) => {
      if (!dryRun && err instanceof CatalogWriteError && err.status === 409) {
        onDone();
        onClose();
      }
    },
  });
  const checked = write.variables === true ? write.data : undefined;
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    write.reset();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dismissible>
      <SheetContent size="md" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("catalogWrite.setupTitle", { catalog })}</SheetTitle>
          <SheetDescription>{t("catalogWrite.setupDescription")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4 px-5 py-4">
          {write.error && <WriteErrorAlert error={write.error} />}
          {checked && (
            <Alert>
              <CircleCheck />
              <AlertDescription>{t("catalogWrite.setupChecked", { files: checked.files.join(", ") })}</AlertDescription>
            </Alert>
          )}
          <FloatingField label={t("catalogWrite.site")} hint={t("catalogWrite.siteHint")}>
            <FieldInput type="url" value={site} onChange={(e) => edit(setSite)(e.target.value)} className="font-mono text-xs" />
          </FloatingField>
          <FloatingField label={t("catalogWrite.repo")} hint={t("catalogWrite.repoHint")}>
            <FieldInput type="url" value={repo} onChange={(e) => edit(setRepo)(e.target.value)} className="font-mono text-xs" />
          </FloatingField>
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={onClose} disabled={write.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="outline" onClick={() => write.mutate(true)} disabled={write.isPending}>
            {write.isPending && write.variables ? t("variantWrite.checking") : t("variantWrite.check")}
          </Button>
          <Button onClick={() => write.mutate(false)} disabled={write.isPending}>
            {write.isPending && !write.variables ? t("catalogWrite.settingUp") : t("catalogWrite.setupAction")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
