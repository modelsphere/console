import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { deployApi, type HelmValues, type PlanRequest } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { discoverImageSlots, mergedHelmValues, type ImageSlot } from "@swiss/lib/imageSlots";

// One compose dry-run for this form state. The Images section and the Override
// YAML editor both use it, so opening both is one call. Image edits and edit
// YAML are left out; callers apply them on the returned values. The query runs
// only while `enabled` (one of those sections is open).
export function helmValuesQueryKey(request: PlanRequest | undefined) {
  return ["helmValues", JSON.stringify(request ?? null)] as const;
}

export function previewForm(form: Form): Form {
  return { ...form, images: {}, edits: "" };
}

export function imageSlotsQueryOptions(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
  // Recompose recovery and adaptive concurrency, as the Override YAML preview does.
  // Absent, the keyed request is posted as it is.
  prepare?: (form: Form) => Promise<PlanRequest>,
) {
  const bare = previewForm(form);
  const request = requestFor(bare);
  return {
    queryKey: helmValuesQueryKey(request),
    queryFn: async (): Promise<HelmValues> => {
      const posted = prepare ? await prepare(bare) : request;
      if (!posted) throw new Error("nothing to compose");
      return deployApi.helmValues(posted);
    },
    enabled: enabled && !!request,
    retry: false as const,
    staleTime: Infinity,
    // Dropped with the page: one install or upgrade.
    gcTime: 0,
    placeholderData: keepPreviousData,
  };
}

export function useImageSlots(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
  prepare?: (form: Form) => Promise<PlanRequest>,
): {
  slots: ImageSlot[];
  error?: string;
  // Server values, without this form's image edits. Undefined while a refetch is still showing the previous form.
  values?: HelmValues;
  fetching: boolean;
  queryError: Error | null;
  reload: () => Promise<HelmValues | undefined>;
} {
  const query = useQuery(imageSlotsQueryOptions(form, requestFor, enabled, prepare));
  const slots = query.data ? discoverImageSlots(mergedHelmValues(query.data)) : [];
  const error = query.error instanceof Error ? query.error.message : query.error ? String(query.error) : undefined;
  const queryError = query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null;
  return {
    slots,
    error,
    values: query.isPlaceholderData ? undefined : query.data,
    fetching: query.isFetching,
    queryError,
    reload: async () => {
      if (!imageSlotsQueryOptions(form, requestFor, true, prepare).enabled) return undefined;
      const result = await query.refetch();
      return result.data;
    },
  };
}
