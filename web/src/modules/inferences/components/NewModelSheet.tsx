import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  FieldInput,
  FieldTextarea,
  FloatingField,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@modelsphere/ui";
import { CircleCheck } from "lucide-react";
import { useT } from "@/modules/inferences/i18n";
import { createModel, readVariant } from "@/modules/inferences/catalog-write-api";
import { newModelFiles, setTopLevel, topLevel } from "@/modules/inferences/catalog-write-lib";
import { WriteErrorAlert } from "@/modules/inferences/components/VariantEditSheet";

const NAME = "my-model";
const VARIANT = "my-variant";

// A new model in a writable catalog: its metadata.yaml and first variant, in
// one commit. from is a variant of the catalog's to start the variant from.
export function NewModelSheet({
  catalog,
  from,
  onClose,
  onCreated,
}: {
  catalog: string;
  from?: { model: string; variant: string };
  onClose: () => void;
  onCreated: (model: string) => void;
}) {
  const t = useT();
  const source = useQuery({
    queryKey: ["catalog-variant-file", catalog, from?.model, from?.variant],
    queryFn: () => readVariant(catalog, from!.model, from!.variant),
    enabled: !!from,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  // null until edited; a copy that cannot be read falls back to the template.
  const [metadata, setMetadata] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const start = newModelFiles(NAME, VARIANT, source.data?.text);
  const files = { metadata: metadata ?? start.metadata, variants: [variant ?? start.variant] };
  const name = topLevel(files.metadata, "name") ?? "";
  const variantId = topLevel(files.variants[0], "id") ?? "";

  const write = useMutation({
    mutationFn: (dryRun: boolean) => createModel(catalog, files, { dryRun, message }),
    onSuccess: (_, dryRun) => {
      if (dryRun) return;
      onCreated(name);
      onClose();
    },
  });
  // A name typed in its field goes into both files: the model's name is the
  // variant's model, and the first variant is the model's default.
  const rename = (metaKey: string, variantKey: string) => (v: string) => {
    setMetadata(setTopLevel(files.metadata, metaKey, v.trim()));
    setVariant(setTopLevel(files.variants[0], variantKey, v.trim()));
    write.reset();
  };
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    write.reset();
  };
  const loading = !!from && source.isPending;
  const checked = write.variables === true ? write.data : undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dismissible>
      <SheetContent size="lg" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("newModel.title", { catalog })}</SheetTitle>
          <SheetDescription>{t("newModel.description")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : (
            <>
              {write.error && <WriteErrorAlert error={write.error} />}
              {checked && (
                <Alert>
                  <CircleCheck />
                  <AlertDescription>{t("newModel.checked", { name })}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <FloatingField label={t("newModel.name")} hint={t("newModel.nameHint", { name: name || "…" })}>
                  <FieldInput value={name} onChange={(e) => rename("name", "model")(e.target.value)} className="font-mono text-xs" />
                </FloatingField>
                <FloatingField label={t("newModel.variantId")} hint={t("newModel.variantIdHint", { id: variantId || "…" })}>
                  <FieldInput value={variantId} onChange={(e) => rename("defaultVariant", "id")(e.target.value)} className="font-mono text-xs" />
                </FloatingField>
              </div>
              <FloatingField label="metadata.yaml" multiline>
                <FieldTextarea value={files.metadata} onChange={(e) => edit(setMetadata)(e.target.value)} rows={9} spellCheck={false} className="font-mono text-xs" />
              </FloatingField>
              <FloatingField label={t("newModel.variant")} hint={from && source.data ? t("newModel.variantFrom", { from: `${from.model}/${from.variant}` }) : undefined} multiline>
                <FieldTextarea value={files.variants[0]} onChange={(e) => edit(setVariant)(e.target.value)} rows={22} spellCheck={false} className="font-mono text-xs" />
              </FloatingField>
              <FloatingField label={t("variantWrite.message")} hint={t("variantWrite.messageHint")}>
                <FieldInput value={message} onChange={(e) => setMessage(e.target.value)} />
              </FloatingField>
            </>
          )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={onClose} disabled={write.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="outline" onClick={() => write.mutate(true)} disabled={loading || write.isPending}>
            {write.isPending && write.variables ? t("variantWrite.checking") : t("variantWrite.check")}
          </Button>
          <Button onClick={() => write.mutate(false)} disabled={loading || write.isPending}>
            {write.isPending && !write.variables ? t("newModel.creating") : t("newModel.create")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
