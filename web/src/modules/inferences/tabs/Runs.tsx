import { RunsTable } from "@/modules/inferences/components/RunsTable";
import { useT } from "@/modules/inferences/i18n";

export function Runs({ namespace, release, poll = true }: { namespace: string; release: string; poll?: boolean }) {
  const t = useT();
  return <RunsTable namespace={namespace} release={release} title={t("tabs.runs")} poll={poll} />;
}
