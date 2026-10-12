import { PageBanner } from "@modelsphere/ui";
import { LayoutDashboard } from "lucide-react";
import { useAuth } from "@/shell/auth";
import { ModuleProvider, type ConsoleModule } from "@/shell/module";
import { useT } from "@/shell/i18n";

export function Home({ modules }: { modules: ConsoleModule[] }) {
  const { me } = useAuth();
  const t = useT("shell");

  return (
    <div>
      <PageBanner title={t("home.title")} icon={<LayoutDashboard className="size-5" />} />
      <div className="w-full space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {modules.map((m) => {
            const Overview = m.overview;
            return Overview ? (
              <ModuleProvider key={m.id} module={m}>
                <Overview />
              </ModuleProvider>
            ) : null;
          })}
        </div>

        <details className="rounded-lg border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("home.session")}</summary>
          <div className="space-y-1 pt-3 break-words">
            <div>
              <span className="text-muted-foreground">{t("home.user")}</span>
              {me?.name}
            </div>
            {me?.email && (
              <div>
                <span className="text-muted-foreground">{t("home.email")}</span>
                {me.email}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("home.groups")}</span>
              {me?.groups?.join(", ")}
            </div>
            <div>
              <span className="text-muted-foreground">{t("home.role")}</span>
              {t(me?.isAdmin ? "home.admin" : "home.member")}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
