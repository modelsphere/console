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
import { putFile, readFile } from "@/modules/inferences/catalog-write-api";
import { WriteErrorAlert } from "@/modules/inferences/components/VariantEditSheet";

// One of a writable catalog's files edited in place, at the digest it was read
// at: catalog.yaml, a model's metadata.yaml.
export interface FileTarget {
  catalog: string;
  file: string;
  label: string;
  title: string;
  description: string;
}

export function FileSheet({ target, onClose, onSaved }: { target: FileTarget | null; onClose: () => void; onSaved: () => void }) {
  return target ? <Body key={`${target.catalog}/${target.file}`} target={target} onClose={onClose} onSaved={onSaved} /> : null;
}

function Body({ target, onClose, onSaved }: { target: FileTarget; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { catalog, file } = target;
  const source = useQuery({ queryKey: ["catalog-file", catalog, file], queryFn: () => readFile(catalog, file), staleTime: 0, gcTime: 0, retry: false });
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const value = text ?? source.data?.text ?? "";
  const write = useMutation({
    mutationFn: (dryRun: boolean) => putFile(catalog, file, value, { etag: source.data?.etag ?? "" }, { dryRun, message }),
    onSuccess: (_, dryRun) => {
      if (dryRun) return;
      onSaved();
      onClose();
    },
  });
  const reload = () => {
    setText(null);
    write.reset();
    void source.refetch();
  };
  const busy = write.isPending || !source.data;
  const checked = write.variables === true ? write.data : undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dismissible>
      <SheetContent size="lg" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{target.title}</SheetTitle>
          <SheetDescription>{target.description}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {source.error ? (
            <WriteErrorAlert error={source.error} />
          ) : !source.data ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : (
            <>
              {write.error && <WriteErrorAlert error={write.error} onReload={reload} />}
              {checked && (
                <Alert>
                  <CircleCheck />
                  <AlertDescription>{t(checked.unchanged ? "catalogWrite.unchanged" : "catalogWrite.checked")}</AlertDescription>
                </Alert>
              )}
              <FloatingField label={target.label} multiline>
                <FieldTextarea
                  value={value}
                  onChange={(e) => {
                    setText(e.target.value);
                    write.reset();
                  }}
                  rows={22}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </FloatingField>
              <FloatingField label={t("variantWrite.message")}>
                <FieldInput value={message} onChange={(e) => setMessage(e.target.value)} />
              </FloatingField>
            </>
          )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={onClose} disabled={write.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="outline" onClick={() => write.mutate(true)} disabled={busy}>
            {write.isPending && write.variables ? t("variantWrite.checking") : t("variantWrite.check")}
          </Button>
          <Button onClick={() => write.mutate(false)} disabled={busy}>
            {write.isPending && !write.variables ? t("variantWrite.saving") : t("variantWrite.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
