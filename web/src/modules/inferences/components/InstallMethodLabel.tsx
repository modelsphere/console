import { Badge } from "@modelsphere/ui";
import type { ApplyWith } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";

export function ExperimentalBadge() {
  const t = useT();
  return <Badge variant="warning">{t("deploy.fields.applyWithExperimental")}</Badge>;
}

// The install method's name, marked when it is still experimental.
export function InstallMethodLabel({ method }: { method: ApplyWith }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5">
      {t(`deploy.fields.applyWithMethod.${method}`)}
      {method === "llmsvc" && <ExperimentalBadge />}
    </span>
  );
}
