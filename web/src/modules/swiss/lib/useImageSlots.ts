import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { deployApi, type HelmValues, type PlanRequest } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { useDebounced } from "@swiss/lib/useDebounced";
import { discoverImageSlots, mergedHelmValues, type ImageSlot } from "@swiss/lib/imageSlots";

// One compose dry-run for this form state. The Images section and the Override
// YAML editor both use it, so opening both is one call. Image edits and edit
// YAML are left out; callers apply them on the returned values. The query runs
// only while `enabled` (one of those sections is open).
export const IMAGE_SLOTS_DEBOUNCE_MS = 400;

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
    // enabled is false without a request, so this does not post an empty body.
    queryFn: async (): Promise<HelmValues> => {
      const posted = prepare ? await prepare(bare) : request;
      return deployApi.helmValues(posted as PlanRequest);
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
  // Server values, without this form's image edits. Undefined while a refetch is still showing the previous form.
  values?: HelmValues;
  fetching: boolean;
  queryError: Error | null;
  reload: () => Promise<HelmValues | undefined>;
} {
  const request = requestFor(previewForm(form));
  // Form identity is stable between edits. The query key strips image edits,
  // so a new requestFor each render does not refetch.
  const debouncedForm = useDebounced(form, IMAGE_SLOTS_DEBOUNCE_MS);
  const query = useQuery(imageSlotsQueryOptions(debouncedForm, requestFor, enabled, prepare));
  const slots = query.data ? discoverImageSlots(mergedHelmValues(query.data)) : [];
  const queryError = query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null;
  return {
    slots,
    values: query.isPlaceholderData ? undefined : query.data,
    fetching: query.isFetching,
    queryError,
    reload: async () => {
      if (!request) return undefined;
      const result = await query.refetch();
      return result.data;
    },
  };
}
