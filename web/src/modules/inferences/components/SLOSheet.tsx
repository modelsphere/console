import { Alert, AlertDescription, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, Spinner } from "@modelsphere/ui";
import { Info } from "lucide-react";
import { SLOCard } from "@swiss/components/SLOCard";
import { VideoSLOCard } from "@swiss/components/VideoSLOCard";
import { useT } from "@/modules/inferences/i18n";

export interface SLOTarget {
  namespace: string;
  release: string;
}

// The cluster resources tab shows the stored SLO; editing it is an action, so
// the form opens here from the header rather than as a tab of its own.
// A video release has one SLO per pool, so the sheet shows one section each.
export function SLOSheet({ target, canEdit, setup, waiting, video = false, onClose }: { target: SLOTarget | null; canEdit: boolean; setup?: boolean; waiting?: boolean; video?: boolean; onClose: () => void }) {
  const t = useT();
  if (!target) return null;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} dismissible>
      <SheetContent size="md" className="gap-0">
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle>{t("slo.title", { release: target.release })}</SheetTitle>
          <SheetDescription>{t(video ? "slo.videoDescription" : "slo.description")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1 overflow-auto bg-surface-page px-5 py-4">
          {setup && (
            <Alert variant="warning" className="mb-4">
              <Info />
              <AlertDescription>{t("slo.setup", { release: target.release })}</AlertDescription>
            </Alert>
          )}
          {/* SLOCard reads the requirement once; before the install applies it would settle on "not registered". */}
          {waiting ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" text={t("slo.waiting")} />
            </div>
          ) : video ? (
            <VideoSLOCard namespace={target.namespace} release={target.release} canEdit={canEdit} />
          ) : (
            <SLOCard namespace={target.namespace} release={target.release} canEdit={canEdit} onSaved={setup ? onClose : undefined} />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
