import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver, environmentManager } from "@tanstack/react-query";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import { OverrideYaml, helmValuesQueryOptions } from "./OverrideYaml";
import en from "@/modules/inferences/locales/en-US.json";
import zh from "@/modules/inferences/locales/zh-CN.json";

afterEach(() => {
  vi.restoreAllMocks();
  environmentManager.setIsServer(() => typeof window === "undefined");
});

const render = (value: string) => renderToStaticMarkup(<OverrideYaml value={value} onChange={() => {}} />);

describe("Override YAML in the form", () => {
  it("shows the overridden paths in a read-only box beside its edit button", () => {
    const html = render("replicaCount: 3\nimage:\n  tag: v2\n");
    expect(html).not.toContain("<textarea");
    expect(html).toMatch(/<input[^>]*readOnly[^>]*value="replicaCount, image.tag"|<input[^>]*value="replicaCount, image.tag"[^>]*readOnly/);
    expect(html).toMatch(/aria-label="(Edit|编辑)"/);
  });

  it("says when the overrides are not valid YAML", () => {
    const html = render("a: [");
    expect(html.includes(en.deploy.overrides.invalid) || html.includes(zh.deploy.overrides.invalid)).toBe(true);
  });
});

describe("YAML textarea", () => {
  it("draws the text highlighted under a transparent textarea holding it", async () => {
    const { YamlTextarea } = await import("./YamlTextarea");
    const html = renderToStaticMarkup(<YamlTextarea aria-label="final" value={"# chart\nreplicaCount: 2\n"} onChange={() => {}} />);
    expect(html).toMatch(/<textarea[^>]*>[\s\S]*replicaCount: 2[\s\S]*<\/textarea>/);
    expect(html).toContain('style="color:var(--code-comment)"># chart</span>');
    expect(html).toContain('style="color:var(--code-key)">replicaCount</span>');
  });
});

describe("key search", () => {
  it("is a search box, its matches listed only once typed into", async () => {
    const { KeySearch } = await import("./KeySearch");
    const html = renderToStaticMarkup(<KeySearch keys={[{ path: "image.tag", line: 2 }]} onJump={() => {}} />);
    expect(html).toMatch(/placeholder="(Search keys|搜索 key)"/);
    expect(html).not.toContain('role="listbox"');
  });
});

describe("Override YAML dry-run query", () => {
  it("stays idle while closed, calls /api/v2/compose dry-run once across concurrent/reopen loads, and never calls /api/plans", async () => {
    environmentManager.setIsServer(() => false);
    const helm = { defaults: "replicaCount: 1\n", overrides: "{}\n" };
    const helmSpy = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
    const planSpy = vi.spyOn(deployApi, "plan");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const req1: PlanRequest = { model: "m", catalog: "c", overrides: { replicaCount: 2 } };
    const req2: PlanRequest = { model: "m", catalog: "c", overrides: { replicaCount: 4 } };

    const observerA = new QueryObserver(client, helmValuesQueryOptions(req1, false));
    const observerB = new QueryObserver(client, helmValuesQueryOptions(req1, false));
    const unsubA = observerA.subscribe(() => {});
    const unsubB = observerB.subscribe(() => {});

    // Closed dialog + form edits while closed stay quiet.
    await Promise.resolve();
    observerA.setOptions(helmValuesQueryOptions(req2, false));
    observerB.setOptions(helmValuesQueryOptions(req2, false));
    await Promise.resolve();
    expect(helmSpy).not.toHaveBeenCalled();

    // Opening with two concurrent observers (e.g. StrictMode) triggers a single dry-run call.
    observerA.setOptions(helmValuesQueryOptions(req1, true));
    observerB.setOptions(helmValuesQueryOptions(req1, true));
    await vi.waitFor(() => expect(observerA.getCurrentResult().data).toEqual(helm));
    expect(observerB.getCurrentResult().data).toEqual(helm);
    expect(helmSpy).toHaveBeenCalledTimes(1);
    expect(helmSpy).toHaveBeenCalledWith(req1);
    expect(planSpy).not.toHaveBeenCalled();

    // Close and reopen without changing the request: uses cache, 0 extra calls.
    observerA.setOptions(helmValuesQueryOptions(req1, false));
    await Promise.resolve();
    observerA.setOptions(helmValuesQueryOptions(req1, true));
    await Promise.resolve();
    expect(helmSpy).toHaveBeenCalledTimes(1);

    // Concurrent manual reloads dedupe to one new dry-run call; form change while open fetches once.
    const [r1, r2] = await Promise.all([
      observerA.refetch({ cancelRefetch: false }),
      observerB.refetch({ cancelRefetch: false }),
    ]);
    expect(r1.data).toEqual(helm);
    expect(r2.data).toEqual(helm);
    expect(helmSpy).toHaveBeenCalledTimes(2);

    observerA.setOptions(helmValuesQueryOptions(req2, true));
    observerB.setOptions(helmValuesQueryOptions(req2, true));
    await vi.waitFor(() => expect(helmSpy).toHaveBeenCalledTimes(3));
    expect(helmSpy).toHaveBeenLastCalledWith(req2);
    expect(planSpy).not.toHaveBeenCalled();

    unsubA();
    unsubB();
  });
});
