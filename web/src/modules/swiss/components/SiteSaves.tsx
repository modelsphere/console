import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { ProfileResponse } from "@swiss/lib/api";
import type { SiteSave } from "@swiss/lib/inputs";
import { saveSiteAnswers } from "@swiss/lib/siteAnswers";
import { messageOf, useToast } from "@swiss/components/ui/toast";

// Which typed answers to save, and the save, run once the deploy applies: one
// abandoned before that leaves the profile as it was. A profile swissd did not
// parse is not written to from here.
export function useSiteSaver(profile?: ProfileResponse) {
  const qc = useQueryClient();
  const toast = useToast();
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const can = profile?.yaml !== undefined && !profile.error;
  return {
    remember: can ? remember : undefined,
    onRemember: (key: string, on: boolean) => setRemember((r) => ({ ...r, [key]: on })),
    save: (saves: SiteSave[]) => {
      if (!saves.length) return;
      saveSiteAnswers(saves).then(
        (saved) => {
          qc.setQueryData(["profile"], saved);
          toast.success(`Saved to the site profile: ${saves.map((s) => s.key).join(", ")}`);
        },
        (e) => toast.error(`Deployed; the site profile was not saved: ${messageOf(e)}`),
      );
    },
  };
}

// Typed answers saved to the site profile once the deploy applies.
export function SiteSaves({ saves }: { saves: SiteSave[] }) {
  if (!saves.length) return null;
  return (
    <div className="space-y-1.5 rounded-md border p-3 text-sm">
      <p className="text-muted-foreground">Saved to the site profile once this applies:</p>
      {saves.map((s) => (
        <div key={s.key} className="font-mono text-xs">
          <div className="break-all">{s.key}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 ps-4">
            {s.replaces && (
              <>
                <span className="break-all text-muted-foreground">{s.replaces}</span>
                <ArrowRight className="size-3.5 shrink-0 text-primary" />
              </>
            )}
            <span className="break-all font-medium">{s.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
