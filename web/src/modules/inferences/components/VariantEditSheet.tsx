import { useState } from "react";
import { Link } from "react-router";
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
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useModulePath } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { CatalogWriteError, putVariant, readVariant, type WriteResult } from "@/modules/inferences/catalog-write-api";
import { bumpVersion, freeId, idProblem, setTopLevel, topLevel, variantFrom, variantPath } from "@/modules/inferences/catalog-write-lib";

// edit replaces one variant file; add writes a new one, starting from a copy of
// another of the model's variants.
export type VariantEdit =
  | { kind: "edit"; catalog: string; model: string; id: string }
  | { kind: "add"; catalog: string; model: string; from: string; ids: string[] };

export function VariantEditSheet({ target, onClose, onSaved }: { target: VariantEdit | null; onClose: () => void; onSaved: (r: WriteResult, id: string) => void }) {
  return target ? <Body key={JSON.stringify(target)} target={target} onClose={onClose} onSaved={onSaved} /> : null;
}

function Body({ target, onClose, onSaved }: { target: VariantEdit; onClose: () => void; onSaved: (r: WriteResult, id: string) => void }) {
  const t = useT();
  const { catalog, model } = target;
  const edit = target.kind === "edit";
  const sourceId = edit ? target.id : target.from;
  const source = useQuery({
    queryKey: ["catalog-variant-file", catalog, model, sourceId],
    queryFn: () => readVariant(catalog, model, sourceId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  // null until edited: the file as read is what the editor shows.
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const initial = source.data && (edit ? source.data.text : variantFrom(source.data.text, freeId(target.from, target.ids)));
  const value = text ?? initial ?? "";
  const id = edit ? target.id : (topLevel(value, "id") ?? "");
  const problem = edit ? undefined : idProblem(id, target.ids);

  const write = useMutation({
    mutationFn: (dryRun: boolean) => putVariant(catalog, model, id, value, edit ? { etag: source.data?.etag ?? "" } : { create: true }, { dryRun, message }),
    onSuccess: (r, dryRun) => {
      if (dryRun) return;
      onSaved(r, id);
      onClose();
    },
  });
  const change = (next: string) => {
    setText(next);
    write.reset();
  };
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
          <SheetTitle>{edit ? t("variantWrite.editTitle", { id }) : t("variantWrite.addTitle", { model })}</SheetTitle>
          <SheetDescription>{t("variantWrite.path", { path: variantPath(model, id || "…"), catalog })}</SheetDescription>
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
              {write.error && <WriteErrorAlert error={write.error} onReload={edit ? reload : undefined} />}
              {checked && (
                <Alert>
                  <CircleCheck />
                  <AlertDescription>{checked.unchanged ? t("variantWrite.unchangedCheck") : t("variantWrite.checked", { version: checked.version ?? "" })}</AlertDescription>
                </Alert>
              )}
              {!edit && (
                <FloatingField label={t("variantWrite.idLabel")} hint={t("variantWrite.idHint")} error={problem && t(`variantWrite.id.${problem}`, { id })}>
                  <FieldInput value={id} onChange={(e) => change(setTopLevel(value, "id", e.target.value.trim()))} className="font-mono text-xs" />
                </FloatingField>
              )}
              <FloatingField label={t("variantWrite.file")} multiline>
                <FieldTextarea value={value} onChange={(e) => change(e.target.value)} rows={26} spellCheck={false} className="font-mono text-xs" />
              </FloatingField>
              <FloatingField label={t("variantWrite.message")} hint={t("variantWrite.messageHint")}>
                <FieldInput value={message} onChange={(e) => setMessage(e.target.value)} />
              </FloatingField>
            </>
          )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          {edit && (
            <Button variant="ghost" className="me-auto" onClick={() => change(bumpVersion(value))} disabled={busy}>
              {t("variantWrite.bump")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={write.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="outline" onClick={() => write.mutate(true)} disabled={busy || !!problem}>
            {write.isPending && write.variables ? t("variantWrite.checking") : t("variantWrite.check")}
          </Button>
          <Button onClick={() => write.mutate(false)} disabled={busy || !!problem}>
            {write.isPending && !write.variables ? t("variantWrite.saving") : t("variantWrite.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// A refusal as catalog-server explains it: every problem it found, on a stale
// edit the way back to the current file, and on a token it no longer takes the
// way to the site profile.
export function WriteErrorAlert({ error, onReload }: { error: Error; onReload?: () => void }) {
  const t = useT();
  const p = useModulePath();
  const w = error instanceof CatalogWriteError ? error : null;
  if (w?.tokenRejected) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>
          {t("catalogWrite.tokenRejected")}{" "}
          <Link to={p("site-profile")} className="underline">
            {t("catalogWrite.setNewToken")}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription className="space-y-2">
        <p>{w?.status === 412 ? t("variantWrite.conflict") : error.message}</p>
        {w && w.problems.length > 0 && (
          <ul className="list-disc space-y-1 ps-5 font-mono text-xs">
            {w.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {w?.status === 412 && onReload && (
          <Button size="sm" variant="outline" onClick={onReload}>
            {t("variantWrite.reload")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function writeErrorText(error: Error | null, t: ReturnType<typeof useT>): string | undefined {
  if (!error) return undefined;
  if (error instanceof CatalogWriteError && error.tokenRejected) return `${t("catalogWrite.tokenRejected")} ${t("catalogWrite.setNewToken")}`;
  const problems = error instanceof CatalogWriteError ? error.problems : [];
  return problems.length ? `${error.message}: ${problems.join("; ")}` : error.message;
}
