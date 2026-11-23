import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Check, Grid2X2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@modelsphere/ui";
import { useT } from "./i18n";
import { activeApplication, type ApplicationItem } from "./applications";

export function ApplicationLauncher({ items, className }: { items: ApplicationItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const t = useT("shell");
  const activeID = activeApplication(items, pathname);
  const labelFor = (item: ApplicationItem) => t(`${item.ns}:scope.${item.scope}`, { defaultValue: item.label });
  const current = items.find(item => item.id === activeID);
  const triggerLabel = current ? `${t("applications.title")}: ${labelFor(current)}` : t("applications.title");
  const available = items.filter(item => item.launcher !== false);
  if (!available.some(item => item.id !== "console")) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label={triggerLabel} title={triggerLabel} className={`flex h-8 min-w-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors ${className ?? ""}`}>
        <Grid2X2 className="h-4 w-4 shrink-0" />
        <span className="hidden max-w-28 truncate sm:inline md:max-w-48">{current ? labelFor(current) : t("applications.title")}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("applications.title")}</DialogTitle>
          <DialogDescription>{t("applications.description")}</DialogDescription>
        </DialogHeader>
        <nav aria-label={t("applications.title")} className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto p-1 sm:grid-cols-2">
          {available.map(item => {
            const Icon = item.icon;
            const active = item.id === activeID;
            const label = labelFor(item);
            return (
              <Link key={item.id} to={item.to} onClick={() => setOpen(false)} aria-current={active ? "true" : undefined}
                className={`flex min-h-16 min-w-0 items-center gap-3 rounded-lg border px-3 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary/30 bg-primary/5 text-primary" : "border-border hover:bg-accent"}`}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-5" /></span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{label}</span>
                {active && <Check aria-hidden className="size-4 shrink-0" />}
              </Link>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
