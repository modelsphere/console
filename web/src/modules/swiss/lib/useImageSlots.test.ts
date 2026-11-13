import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, environmentManager } from "@tanstack/react-query";
import { EMPTY, planRequest, type Form } from "@swiss/components/DeploySettings";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import { helmValuesQueryKey, imageSlotsQueryOptions, previewForm } from "./useImageSlots";

const helm = { defaults: "image:\n  repository: chart/engine\n  tag: \"1\"\n", overrides: "{}\n" };
const requestFor = (form: Form) => planRequest(form, { model: "m" });

afterEach(() => {
  vi.restoreAllMocks();
  environmentManager.setIsServer(() => typeof window === "undefined");
});

function watch(enabled: boolean, form: Form = { ...EMPTY, serviceId: "m", images: { image: "mirror/x:1" }, edits: "note: typed\n" }, prepare?: (form: Form) => Promise<PlanRequest>) {
  environmentManager.setIsServer(() => false);
  const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = imageSlotsQueryOptions(form, requestFor, enabled, prepare);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  return { fetch, client, options, observer, unsubscribe };
}

describe("compose dry-run query", () => {
  it("does not fetch while nothing has opened it", async () => {
    const { fetch, unsubscribe } = watch(false);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("uses one key for the Images section and the Override YAML editor", async () => {
    const form = { ...EMPTY, serviceId: "m", replicaCount: "2", images: { image: "mirror/x:1" }, edits: "replicaCount: 9\n" };
    const images = imageSlotsQueryOptions(form, requestFor, true);
    const yaml = imageSlotsQueryOptions({ ...form, images: { image: "other/x:2" }, edits: "note: 1\n" }, requestFor, true);
    expect(images.queryKey).toEqual(yaml.queryKey);
    expect(images.queryKey).toEqual(helmValuesQueryKey(requestFor(previewForm(form))));
    expect(helmValuesQueryKey(requestFor(previewForm({ ...form, namespace: "other" })))).not.toEqual(images.queryKey);

    environmentManager.setIsServer(() => false);
    const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = new QueryObserver(client, images);
    const b = new QueryObserver(client, yaml);
    const stopA = a.subscribe(() => {});
    const stopB = b.subscribe(() => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const posted = fetch.mock.calls[0][0];
    expect(posted.editsYAML).toBeUndefined();
    expect(posted.overrides?.image).toBeUndefined();
    stopA();
    stopB();
  });

  it("posts the prepared request when recovery recomposes it", async () => {
    const form = { ...EMPTY, serviceId: "m" };
    const prepared = { ...requestFor(previewForm(form)), release: "prepared" };
    const { fetch, unsubscribe } = watch(true, form, async () => prepared);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(prepared);
    unsubscribe();
  });
});
