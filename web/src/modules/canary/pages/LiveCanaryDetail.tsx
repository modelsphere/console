import { ErrorNotice } from "../components/ErrorNotice";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LoadingBlock } from "@modelsphere/ui";
import { useTranslation } from "../lib/translation";
import { useCanaryApi } from "../lib/provider";
import { ExperimentDetail } from "./ExperimentDetail";
export function LiveCanaryDetail() {
  const { ns, name } = useParams();
  const api = useCanaryApi();
  const { t } = useTranslation("canary");
  const q = useQuery({
    queryKey: ["experiments", api.mode],
    queryFn: () => api.experiments.list(),
    refetchInterval: 10000,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error)
    return <ErrorNotice error={q.error} className="p-4 text-destructive" />;
  const e = q.data?.find(
    (e) => e.namespace === ns && e.name === name && e.cleanup !== "complete",
  );
  if (!e) return <p className="p-4">{t("common.missing")}</p>;
  return <ExperimentDetail id={e.id} />;
}
