import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, FloatingField, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Spinner, Switch } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import { api, deployApi } from "@swiss/lib/api";
import { releaseCatalog } from "@swiss/components/CatalogChoice";
import { useT } from "@/modules/inferences/i18n";
import { pipelineState } from "@/modules/inferences/deploy-lib";
import { Review } from "@/modules/inferences/components/DeploySheet";

export interface RollbackTarget {
  namespace: string;
  release: string;
  revision: number;
}

const REFRESH = [["status"], ["revisions"], ["releasePlan"], ["release-plan"], ["runs"], ["deployments"], ["objects"]];

export function RollbackSheet({ target, onClose }: { target: RollbackTarget | null; onClose: () => void }) {
  return target ? <Body key={`${target.namespace}/${target.release}@${target.revision}`} target={target} onClose={onClose} /> : null;
}

function Body({ target, onClose }: { target: RollbackTarget; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { namespace, release, revision } = target;
  const [note, setNote] = useState("");
  const [skipSchema, setSkipSchema] = useState(false);
  const flags = (skip: boolean) => (skip ? { skipSchemaValidation: true } : undefined);
  const current = useQuery({ queryKey: ["releasePlan", namespace, release], queryFn: () => api.releasePlan(namespace, release), retry: false });
  const archived = useQuery({ queryKey: ["revision-plan", namespace, release, revision], queryFn: () => api.revisionPlan(namespace, release, revision), staleTime: Infinity });
  const live = useQuery({ queryKey: ["status", namespace, release], queryFn: () => api.status(namespace, release) });
  const cluster = useQuery({ queryKey: ["cluster"], queryFn: api.cluster });
  const currentCatalog = current.data ? releaseCatalog(cluster.data?.catalogs ?? [], current.data.source) : undefined;
  // Takes the switch as it is now, so toggling it can re-run the dry run at once.
  const diff = useMutation({ mutationFn: (skip: boolean) => deployApi.diffRevision(namespace, release, revision, flags(skip)) });
  useEffect(() => diff.mutate(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const state = pipelineState({ rollback: true, diff: diff.data ?? null, exists: live.data?.exists, applied: false });
  const run = useMutation({
    mutationFn: () => deployApi.rollback(namespace, release, revision, diff.data?.revision ?? live.data?.revision ?? 0, note.trim(), flags(skipSchema)),
    onSuccess: () => {
      for (const key of REFRESH) qc.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  const error = archived.error ?? run.error;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dismissible>
      <SheetContent size="2xl" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("deploy.rollbackSheet.title", { release, revision })}</SheetTitle>
          <SheetDescription>{t("deploy.rollbackSheet.description")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 space-y-4 overflow-auto bg-surface-page px-5 py-4">
          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          {archived.isPending ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : (
            archived.data && (
              <>
                <Review
                  upgrade={false}
                  rollback
                  current={current.data}
                  currentCatalog={currentCatalog}
                  plan={archived.data}
                  diff={diff.data ?? null}
                  diffing={diff.isPending}
                  diffError={diff.error?.message}
                  state={state}
                  note={note}
                  onNote={setNote}
                  force={false}
                  onForce={() => {}}
                />
                <FloatingField layout="inline" label={t("deploy.fields.skipSchemaValidation")} hint={t("deploy.fields.skipSchemaValidationHint")}>
                  <Switch
                    aria-label={t("deploy.fields.skipSchemaValidation")}
                    checked={skipSchema}
                    disabled={diff.isPending || run.isPending}
                    onCheckedChange={(v) => {
                      // The dry run checked the schema the other way: run it again.
                      setSkipSchema(v);
                      run.reset();
                      diff.mutate(v);
                    }}
                  />
                </FloatingField>
              </>
            )
          )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={() => run.mutate()} disabled={!state.canApply || run.isPending}>
            {run.isPending ? t("deploy.review.busy") : t("deploy.review.rollback")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
