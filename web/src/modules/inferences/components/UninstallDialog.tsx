import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@modelsphere/ui";
import { deployApi } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";

export interface UninstallTarget {
  namespace: string;
  release: string;
}

// Uninstall, typed to confirm: it removes a release that takes 20-40 minutes to
// load back, so the name is the one thing the operator must have read first.
// The list and the detail page share it; onDone says where to go afterwards.
export function UninstallDialog({
  target,
  onClose,
  onDone,
}: {
  target: UninstallTarget | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // What the call itself cannot report: it succeeded, and left the plan behind.
  const [planError, setPlanError] = useState("");
  const run = useMutation({
    mutationFn: (x: UninstallTarget) => deployApi.uninstall(x.namespace, x.release),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (o) return;
        onClose();
        run.reset();
        setPlanError("");
      }}
      title={t("uninstall.title")}
      description={t("uninstall.description")}
      action={t("actions.uninstall")}
      tone="destructive"
      items={target ? [{ name: target.release, id: target.release }] : []}
      error={run.error?.message ?? (planError || undefined)}
      loading={run.isPending}
      onConfirm={async () => {
        if (!target) return;
        const r = await run.mutateAsync(target);
        // The release is gone either way; a plan left behind is worth saying,
        // and saying it means not closing.
        if (r.planError) {
          setPlanError(t("uninstall.planError", { error: r.planError }));
          throw new Error(r.planError);
        }
        onDone?.();
      }}
    />
  );
}
