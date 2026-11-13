import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, environmentManager } from "@tanstack/react-query";
import { EMPTY, planRequest, type Form } from "@swiss/components/DeploySettings";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import { helmValuesTargetKey, imageSlotsQueryOptions, previewForm } from "./useImageSlots";

const helm = { defaults: "image:\n  repository: chart/engine\n  tag: \"1\"\n", overrides: "{}\n" };
const requestFor = (form: Form, chartVersion?: string): PlanRequest =>
  planRequest(form, { model: "m", catalog: "c", version: "v1", variant: "vllm", chartVersion });

afterEach(() => {
  vi.restoreAllMocks();
  environmentManager.setIsServer(() => typeof window === "undefined");
});

function setup(initialForm: Form, initialEnabled: boolean, chartVersion?: string) {
  environmentManager.setIsServer(() => false);
  const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current = { form: initialForm, chartVersion };
  const latest = () => requestFor(previewForm(current.form), current.chartVersion);
  const options = (form: Form, enabled: boolean, nextChartVersion?: string) => {
    current = { form, chartVersion: nextChartVersion };
    return imageSlotsQueryOptions(form, (f) => requestFor(f, nextChartVersion), enabled, latest);
  };
  const observer = new QueryObserver(client, options(initialForm, initialEnabled, chartVersion));
  const unsubscribe = observer.subscribe(() => {});
  return {
    fetch,
    observer,
    update: (form: Form, enabled: boolean, nextChartVersion?: string) => observer.setOptions(options(form, enabled, nextChartVersion)),
    unsubscribe,
  };
}

describe("image slot discovery query", () => {
  it("does not fetch while Images is collapsed", async () => {
    const { fetch, unsubscribe } = setup({ ...EMPTY, serviceId: "m" }, false);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("queries once on open and ignores non-target form edits or collapse/reopen cycles", async () => {
    const form: Form = { ...EMPTY, serviceId: "m", replicaCount: "2", namespace: "ns1" };
    const { fetch, update, unsubscribe } = setup(form, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const edited: Form = {
      ...form,
      namespace: "ns2",
      replicaCount: "5",
      serviceId: "m2",
      preset: "fast",
      images: { image: "mirror/x:1" },
      edits: "replicaCount: 9\n",
    };
    expect(helmValuesTargetKey(requestFor(previewForm(edited)))).toEqual(helmValuesTargetKey(requestFor(previewForm(form))));
    update(edited, true);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    update(edited, false);
    await Promise.resolve();
    update(edited, true);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("re-queries automatically when chartVersion changes while open", async () => {
    const form: Form = { ...EMPTY, serviceId: "m" };
    const { fetch, update, unsubscribe } = setup(form, true, "0.1.0");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    update(form, true, "0.2.0");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0].chartVersion).toBe("0.2.0");
    unsubscribe();
  });

  it("posts the latest form edits on manual refetch while leaving image/edit overrides stripped", async () => {
    const form: Form = { ...EMPTY, serviceId: "m", namespace: "ns1" };
    const { fetch, observer, update, unsubscribe } = setup(form, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0].namespace).toBe("ns1");

    const updated: Form = { ...form, namespace: "ns2", images: { image: "mirror/x:1" }, edits: "note: typed\n" };
    update(updated, true);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    await observer.refetch();
    expect(fetch).toHaveBeenCalledTimes(2);
    const posted = fetch.mock.calls[1][0];
    expect(posted.namespace).toBe("ns2");
    expect(posted.editsYAML).toBeUndefined();
    expect(posted.overrides?.image).toBeUndefined();
    unsubscribe();
  });
});
