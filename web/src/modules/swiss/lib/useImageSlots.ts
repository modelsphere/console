import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { deployApi, type HelmValues, type PlanRequest } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { helmImageSlots, type ImageSlot } from "@swiss/lib/imageSlots";

// Keyed only by chart target (model/catalog/release/version/variant/chartVersion),
// so editing other form fields does not automatically re-compose while Images is
// open. Opening Images runs once using the latest form state, and manual reload()
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
  return { ...form, images: {}, edits: "" };
}

export function imageSlotsQueryOptions(
  form: Form,
  requestFor: (form: Form) => PlanRequest | undefined,
  enabled: boolean,
  latestRequest?: () => PlanRequest | undefined,
) {
  const bare = previewForm(form);
  const request = requestFor(bare);
  return {
    queryKey: helmValuesTargetKey(request),
    // enabled is false without a request, so this does not post an empty body.
    // latestRequest reads current form edits on first open or manual refresh.
    queryFn: (): Promise<HelmValues> => deployApi.helmValues((latestRequest?.() ?? request) as PlanRequest),
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
  fetching: boolean;
  queryError: Error | null;
  reload: () => Promise<HelmValues | undefined>;
} {
  const latestRequestRef = useRef<() => PlanRequest | undefined>(() => undefined);
  latestRequestRef.current = () => requestFor(previewForm(form));
  const query = useQuery(imageSlotsQueryOptions(form, requestFor, enabled, () => latestRequestRef.current()));
  const slots = query.data ? helmImageSlots(query.data) : [];
  const queryError = query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null;
  return {
    slots,
    fetching: query.isFetching,
    queryError,
    reload: async () => {
      if (!latestRequestRef.current()) return undefined;
      const result = await query.refetch();
      return result.data;
    },
  };
}
