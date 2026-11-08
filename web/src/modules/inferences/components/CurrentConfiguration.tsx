import { useState } from "react";
import { Alert, AlertDescription, Button, CodeBlock, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@modelsphere/ui";
import type { RevisionValues } from "@swiss/lib/api";
import { useT } from "../i18n";

export function CurrentConfiguration({ data, loading, error, onRefresh }: { data?: RevisionValues; loading: boolean; error?: Error | null; onRefresh: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={loading || !data || !!error}>{t("deploy.draft.current")}</Button>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>{t("deploy.draft.refreshRevision")}</Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
          <DialogHeader><DialogTitle>{t("deploy.draft.current")} · {data?.revision}</DialogTitle></DialogHeader>
          <CodeBlock value={data?.all ?? ""} language="yaml" lineNumbers className="min-h-0 flex-1" />
          <DialogFooter><Button onClick={() => setOpen(false)}>{t("common:actions.close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
