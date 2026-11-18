import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@modelsphere/ui";
import { api, deployApi } from "@swiss/lib/api";
import { serviceRelationship } from "../service-relationship";
import { useT } from "@/modules/inferences/i18n";

export interface UninstallTarget {
  namespace: string;
  release: string;
}

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
  // The uninstall succeeded but left its plan ConfigMap behind.
  const [planError, setPlanError] = useState("");
  const run = useMutation({
    mutationFn: async (x: UninstallTarget) => {
      const relationship = serviceRelationship(await api.status(x.namespace, x.release));
      if (relationship.owned || relationship.uninstallLocked) throw new Error(t(relationship.owned ? "disabled.serviceManaged" : "disabled.serviceAssigned"));
      return deployApi.uninstall(x.namespace, x.release);
    },
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
        if (r.planError) {
          setPlanError(t("uninstall.planError", { error: r.planError }));
          throw new Error(r.planError);
        }
        onDone?.();
      }}
    />
  );
}
