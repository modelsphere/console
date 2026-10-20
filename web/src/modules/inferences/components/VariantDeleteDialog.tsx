import { useMutation } from "@tanstack/react-query";
import { ConfirmDialog } from "@modelsphere/ui";
import { useT } from "@/modules/inferences/i18n";
import { deleteVariant, readVariant, type WriteResult } from "@/modules/inferences/catalog-write-api";
import { writeErrorText } from "@/modules/inferences/components/VariantEditSheet";

export interface VariantDeleteTarget {
  catalog: string;
  model: string;
  id: string;
}

export function VariantDeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: VariantDeleteTarget | null;
  onClose: () => void;
  onDeleted: (r: WriteResult, id: string) => void;
}) {
  const t = useT();
  // The digest is read at confirm time: a delete names the file it saw.
  const run = useMutation({
    mutationFn: async (x: VariantDeleteTarget) => {
      const { etag } = await readVariant(x.catalog, x.model, x.id);
      return deleteVariant(x.catalog, x.model, x.id, etag);
    },
  });

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (o) return;
        onClose();
        run.reset();
      }}
      title={t("variantWrite.deleteTitle")}
      description={t("variantWrite.deleteDescription")}
      action={t("common:actions.delete")}
      tone="destructive"
      items={target ? [{ name: target.id, id: target.id }] : []}
      error={writeErrorText(run.error)}
      loading={run.isPending}
      onConfirm={async () => {
        if (!target) return;
        const r = await run.mutateAsync(target);
        onDeleted(r, target.id);
      }}
    />
  );
}
