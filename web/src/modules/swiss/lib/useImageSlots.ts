import { useQuery } from "@tanstack/react-query";
import { deployApi, type HelmValues, type PlanRequest } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { helmImageSlots, type ImageSlot } from "@swiss/lib/imageSlots";
import { emptyResourceEdits, helmResources, type HelmResources } from "@swiss/lib/resources";

// Keyed only by chart target (model/catalog/release/version/variant/chartVersion),
// so opening the deploy/upgrade window runs once using the latest form state,
// editing other form fields does not automatically re-compose, and manual reload()
// re-composes with the latest form state.
export function helmValuesTargetKey(request: PlanRequest | undefined) {
  return [
    "helmValues",
    "slots",
    request
      ? {
          catalog: request.catalog ?? null,
          model: request.model ?? null,
          fromRelease: request.fromRelease ?? null,
          version: request.version ?? null,
          variant: request.variant ?? null,
          chartVersion: request.chartVersion ?? null,
        }
      : null,
  ] as const;
}

export function previewForm(form: Form): Form {
  return { ...form, images: {}, resources: emptyResourceEdits(), edits: "" };
}

export function imageSlotsQueryOptions(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
) {
  const request = requestFor(previewForm(form));
  return {
    queryKey: helmValuesTargetKey(request),
    // enabled is false without a request, so this does not post an empty body.
    queryFn: (): Promise<HelmValues> => deployApi.helmValues(request as PlanRequest),
    enabled: enabled && !!request,
    retry: false as const,
    staleTime: Infinity,
    // Dropped with the page: one install or upgrade.
    gcTime: 0,
  };
}

export function useImageSlots(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
): {
  slots: ImageSlot[];
  resources?: HelmResources;
  fetching: boolean;
  queryError: Error | null;
  reload: () => Promise<HelmValues | undefined>;
} {
  const request = requestFor(previewForm(form));
  const query = useQuery(imageSlotsQueryOptions(form, requestFor, enabled));
  const slots = query.data ? helmImageSlots(query.data) : [];
  const resources = query.data ? helmResources(query.data) : undefined;
  const queryError = query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null;
  return {
    slots,
    resources,
    fetching: query.isFetching,
    queryError,
    reload: async () => {
      if (!request) return undefined;
      const result = await query.refetch();
      return result.data;
    },
  };
}
