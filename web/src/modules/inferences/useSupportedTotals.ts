import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { api, type ClusterInfo } from "@swiss/lib/api";
import { supportedTotals } from "@/modules/inferences/dashboard-lib";

export function useSupportedTotals(cluster: UseQueryResult<ClusterInfo>) {
  const catalogs = cluster.data?.catalogs ?? [];
  const queries = useQueries({
    queries: catalogs.map((catalog) => ({
      queryKey: ["catalog", catalog.name],
      queryFn: () => api.catalog(catalog.name),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });
  const error = cluster.error ?? queries.find((q) => q.error)?.error ?? null;
  const loading = cluster.isPending || queries.some((q) => q.isPending);
  const complete = !!cluster.data && !loading && !error;
  const totals = complete ? supportedTotals(queries.map((q) => q.data!)) : null;
  const retry = () => {
    if (cluster.error) void cluster.refetch();
    else
      queries.forEach((q) => {
        if (q.error) void q.refetch();
      });
  };
  return { totals, error, loading, retry };
}
