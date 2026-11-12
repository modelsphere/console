import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import { useDebounced } from "@swiss/lib/useDebounced";
import { discoverImageSlots, mergedHelmValues, type ImageSlot } from "@swiss/lib/imageSlots";

// The chart's merged values for this form, from compose's dry run. Debounced
// so a keystroke does not compose on every change. Layers name the slots; they
// are not part of the request.
export function useImageSlots(
  request: PlanRequest | undefined,
  layers: Record<string, Record<string, unknown>> | undefined,
  enabled: boolean,
): { slots: ImageSlot[]; error?: string } {
  const key = request ? JSON.stringify(request) : "";
  const debouncedKey = useDebounced(key, 400);
  const query = useQuery({
    queryKey: ["helmValues", "images", debouncedKey],
    queryFn: () => deployApi.helmValues(JSON.parse(debouncedKey) as PlanRequest),
    enabled: enabled && !!debouncedKey,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const layerKey = layers ? JSON.stringify(layers) : "";
  const slots = useMemo(() => {
    if (!query.data) return [];
    try {
      return discoverImageSlots(mergedHelmValues(query.data), layers);
    } catch {
      return [];
    }
    // layerKey stands in for layers: the object is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, layerKey]);
  const error = query.error instanceof Error ? query.error.message : query.error ? String(query.error) : undefined;
  return { slots, error };
}
