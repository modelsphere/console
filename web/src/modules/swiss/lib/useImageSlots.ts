import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { useDebounced } from "@swiss/lib/useDebounced";
import { discoverImageSlots, mergedHelmValues, type ImageSlot } from "@swiss/lib/imageSlots";

// The chart's merged values for this form, from compose's dry run. Keyed on the
// request with image edits and edit YAML left out, and debounced, so typing in
// those fields does not compose again. The placeholder is that value.
export function useImageSlots(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
): { slots: ImageSlot[]; error?: string } {
  const request = enabled ? requestFor({ ...form, images: {}, edits: "" }) : undefined;
  const key = request ? JSON.stringify(request) : "";
  const debouncedKey = useDebounced(key, 400);
  const query = useQuery({
    queryKey: ["helmValues", "images", debouncedKey],
    queryFn: () => deployApi.helmValues(JSON.parse(debouncedKey) as PlanRequest),
    enabled: enabled && !!debouncedKey,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const slots = query.data ? discoverImageSlots(mergedHelmValues(query.data)) : [];
  const error = query.error instanceof Error ? query.error.message : query.error ? String(query.error) : undefined;
  return { slots, error };
}
