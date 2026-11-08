import { Alert, AlertDescription } from "@modelsphere/ui";
import { useT } from "../i18n";
import type { ConfigurationOverride } from "../configuration-overrides";

const display = (value: unknown) => value === undefined ? "—" : JSON.stringify(value);

export function ConfigurationOverrides({ items }: { items: ConfigurationOverride[] }) {
  const t = useT();
  if (!items.length) return null;
  return <Alert variant="warning"><AlertDescription><ul className="space-y-1">{items.map((item) => <li key={item.path}>{t("deploy.draft.managed", { field: item.path, requested: display(item.requested), actual: display(item.actual), source: item.source })}</li>)}</ul></AlertDescription></Alert>;
}
