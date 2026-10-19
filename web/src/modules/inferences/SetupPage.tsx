import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PageBanner, Skeleton } from "@modelsphere/ui";
import { Settings2 } from "lucide-react";
import { useModulePath } from "@/shell";
import { api, type ProfileResponse } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { ProfileEditorBody, SaveButton, useProfileEditor } from "@/modules/inferences/components/ProfileEditor";

// The first run only: the gate sends a site that has a profile to the site
// profile page, so this always starts from swissd's default.
export function SetupPage() {
  const t = useT();
  const template = useQuery({ queryKey: ["profile-template"], queryFn: api.profileTemplate });
  return (
    <div className="flex h-full flex-col">
      <PageBanner title={t("profile.setup.title")} description={t("profile.setup.description")} icon={<Settings2 className="size-5" />} />
      {template.data?.profile ? (
        <Setup start={template.data} />
      ) : (
        <Scroll>
          <Skeleton className="h-96 w-full" />
        </Scroll>
      )}
    </div>
  );
}

function Setup({ start }: { start: ProfileResponse }) {
  const t = useT();
  const p = useModulePath();
  const navigate = useNavigate();
  const editor = useProfileEditor(start.profile!, start.yaml ?? "", () => navigate(p(""), { replace: true }));
  return (
    <>
      <Scroll>
        <ProfileEditorBody editor={editor} />
      </Scroll>
      {/* Outside the scroll: the form runs to eight groups, and saving should not need a scroll to the end. */}
      <div className="border-t bg-background px-4 py-3">
        <div className="mx-auto flex max-w-4xl justify-end">
          <SaveButton editor={editor} label={t("profile.setup.save")} />
        </div>
      </div>
    </>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-page p-4">
      <div className="mx-auto max-w-4xl space-y-4">{children}</div>
    </div>
  );
}
