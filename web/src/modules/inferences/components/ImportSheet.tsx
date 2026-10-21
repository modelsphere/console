import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, FieldInput, FieldSelect, FloatingField, PropertyList, SectionCard, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, useDirty } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { ApiError } from "@/shell/api";
import { api, type CatalogInfo } from "@swiss/lib/api";
import { Provenance } from "@swiss/components/Provenance";
import { useT } from "../i18n";
import { confirmImport, previewImport, type ImportSelection } from "../import-api";

export function ImportSheet({ namespaces, catalogs, onClose, onImported }: { namespaces: string[]; catalogs: CatalogInfo[]; onClose: () => void; onImported: (namespace: string, release: string) => void }) {
  const t = useT();
  const initial: ImportSelection = { namespace: namespaces.length === 1 ? namespaces[0] : "", release: "", catalog: (catalogs.find((catalog) => catalog.default) ?? (catalogs.length === 1 ? catalogs[0] : undefined))?.name ?? "", model: "", variant: "" };
  const [selection, setSelection] = useState(initial);
  const dirty = useDirty(selection, initial);
  const index = useQuery({ queryKey: ["catalog", selection.catalog], queryFn: () => api.catalog(selection.catalog), enabled: !!selection.catalog, retry: false });
  const models = index.data?.models ?? [];
  const model = models.find((candidate) => candidate.name === selection.model);
  const selectedVariant = model?.variants.find((variant) => variant.id === selection.variant);
  const history = useQuery({ queryKey: ["history", selection.catalog, selection.model, selection.variant], queryFn: () => api.history(selection.model, { catalog: selection.catalog, variant: selection.variant }), enabled: !!selectedVariant, retry: false });
  const versions = history.data?.revisions.map((revision) => revision.version) ?? (selectedVariant?.version ? [selectedVariant.version] : []);
  const preview = useMutation({ mutationFn: previewImport });
  const commit = useMutation({
    mutationFn: () => confirmImport(preview.variables!, preview.data!),
    onSuccess: (result) => onImported(result.namespace, result.release),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) preview.reset();
    },
  });
  const change = (patch: Partial<ImportSelection>) => {
    setSelection((previous) => ({ ...previous, ...patch }));
    preview.reset();
    commit.reset();
  };
  const busy = preview.isPending || commit.isPending;
  const ready = !!selection.namespace && !!selection.release.trim() && !!selection.catalog && !!model?.variants.some((variant) => variant.id === selection.variant);
  const result = preview.data;
  const error = commit.error ?? preview.error ?? index.error;

  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()} dirty={dirty && !result} onDiscard={onClose}>
      <SheetContent size="lg" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("import.title")}</SheetTitle>
          <SheetDescription>{t("import.description")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          <Alert variant="warning"><TriangleAlert /><AlertDescription>{t("import.baseline")}</AlertDescription></Alert>
          {error && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{error.message}</AlertDescription></Alert>}
          {!result ? (
            <fieldset disabled={busy} className="space-y-3">
              <FloatingField label={t("import.namespace")} required>
                <FieldSelect value={selection.namespace} onValueChange={(value) => change({ namespace: value })} options={namespaces.map((namespace) => ({ value: namespace, label: namespace }))} />
              </FloatingField>
              <FloatingField label={t("import.release")} required hint={t("import.releaseHint")}>
                <FieldInput value={selection.release} onChange={(event) => change({ release: event.target.value.trim() })} />
              </FloatingField>
              <FloatingField label={t("import.catalog")} required>
                <FieldSelect value={selection.catalog} onValueChange={(value) => change({ catalog: value, model: "", variant: "", version: undefined })} options={catalogs.map((catalog) => ({ value: catalog.name, label: catalog.name }))} />
              </FloatingField>
              <FloatingField label={t("import.model")} required>
                <FieldSelect value={selection.model} onValueChange={(value) => {
                  const next = models.find((candidate) => candidate.name === value);
                  change({ model: value, variant: next?.defaultVariant ?? next?.variants[0]?.id ?? "", version: undefined });
                }} disabled={index.isPending || !selection.catalog} options={models.map((candidate) => ({ value: candidate.name, label: candidate.displayName || candidate.name }))} />
              </FloatingField>
              <FloatingField label={t("import.variant")} required hint={t("import.chartMatch")}>
                <FieldSelect value={selection.variant} onValueChange={(value) => change({ variant: value, version: undefined })} disabled={!model} options={(model?.variants ?? []).map((variant) => ({ value: variant.id, label: variant.id, description: `${variant.chart.name} ${variant.chart.version}` }))} />
              </FloatingField>
              <FloatingField label={t("import.version")}>
                <FieldSelect value={selection.version ?? selectedVariant?.version ?? ""} onValueChange={(value) => change({ version: value })} disabled={!selectedVariant} options={versions.map((version) => ({ value: version, label: version }))} />
              </FloatingField>
              {history.error && <Button variant="outline" onClick={() => void history.refetch()}>{t("import.retryHistory")}</Button>}
              {index.error && <Button variant="outline" onClick={() => void index.refetch()}>{t("import.retryCatalog")}</Button>}
            </fieldset>
          ) : (
            <>
              <PropertyList columns={2} items={[
                { label: t("import.namespace"), value: preview.variables!.namespace },
                { label: t("import.release"), value: preview.variables!.release },
                { label: t("import.chart"), value: result.chart },
                { label: t("import.revision"), value: String(result.revision) },
                { label: t("import.model"), value: result.plan.source.model },
                { label: t("import.variant"), value: result.plan.source.variant },
                { label: t("import.version"), value: result.plan.source.version || "-" },
              ]} />
              {result.warnings?.map((warning, index) => <Alert variant="warning" key={index}><TriangleAlert /><AlertDescription>{t(`import.warnings.${warning}`, { defaultValue: warning })}</AlertDescription></Alert>)}
              <SectionCard title={t("import.plan")}><Provenance plan={result.plan} /></SectionCard>
            </>
          )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("common:actions.cancel")}</Button>
          {result ? <>
            <Button variant="outline" disabled={busy} onClick={() => { preview.reset(); commit.reset(); }}>{t("import.back")}</Button>
            <Button disabled={busy} onClick={() => commit.mutate()}>{commit.isPending ? t("import.importing") : t("import.confirm")}</Button>
          </> : <Button disabled={busy || !ready} onClick={() => preview.mutate(selection)}>{preview.isPending ? t("import.previewing") : t("import.preview")}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
