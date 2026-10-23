import { Button } from "@modelsphere/ui";
import { TriangleAlert } from "lucide-react";
import type { ReleaseStatus } from "@swiss/lib/api";
import { isUninstalling } from "@swiss/lib/phase";
import { useT } from "@/modules/inferences/i18n";
import { stalled } from "@/modules/inferences/lib";

export function LoadHint({ status: s, onViewInstances }: { status: ReleaseStatus; onViewInstances?: () => void }) {
  const t = useT();
  if (isUninstalling(s) || s.total === 0 || s.ready >= s.total) return null;
  if (!stalled(s)) return <p className="text-sm text-muted-foreground">{t("overview.coldLoad")}</p>;
  return (
    <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t("overview.stalled")}</span>
      {onViewInstances && (
        <Button variant="outline" size="sm" onClick={onViewInstances}>
          {t("overview.viewInstances")}
        </Button>
      )}
    </div>
  );
}
