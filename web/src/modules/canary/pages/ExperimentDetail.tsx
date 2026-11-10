import { ErrorNotice } from "../components/ErrorNotice";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LoadingBlock } from "@modelsphere/ui";
import { useCanaryApi } from "../lib/provider";
import { CanaryDetail } from "./CanaryDetail";
export function ExperimentDetail({ id: providedID }: { id?: string } = {}) {
  const { id: routeID = "" } = useParams();
  const id = providedID ?? routeID;
  const api = useCanaryApi();
  const q = useQuery({
    queryKey: ["experiment", api.mode, id],
    queryFn: () => api.experiments.get(id),
    refetchInterval: (query) =>
      query.state.data?.state === "Stopped" &&
      query.state.data.snapshot === "complete"
        ? false
        : 10000,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error)
    return <ErrorNotice error={q.error} className="p-4 text-destructive" />;
  if (!q.data) return null;
  return (
    <CanaryDetail
      snapshot={q.data.canary}
      experiment={q.data}
      onRefresh={() => void q.refetch()}
    />
  );
}
