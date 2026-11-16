import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, environmentManager, focusManager } from "@tanstack/react-query";
import { isPollingPaused, pausePolling, pollOptions } from "./polling";

const releases: Array<() => void> = [];

afterEach(() => {
  while (releases.length) releases.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  environmentManager.setIsServer(() => typeof window === "undefined");
  focusManager.setFocused(undefined);
});

describe("polling pause state", () => {
  it("ref-counts concurrent pauses and ignores duplicate releases", () => {
    expect(isPollingPaused()).toBe(false);

    const releaseUpgrade = pausePolling();
    releases.push(releaseUpgrade);
    expect(isPollingPaused()).toBe(true);

    const releaseInstall = pausePolling();
    releases.push(releaseInstall);
    expect(isPollingPaused()).toBe(true);

    releaseUpgrade();
    releaseUpgrade();
    expect(isPollingPaused()).toBe(true);

    releaseInstall();
    expect(isPollingPaused()).toBe(false);
  });

  it("disables interval, focus, and reconnect refetches when paused", () => {
    expect(pollOptions(true, 15_000)).toEqual({ refetchInterval: 15_000 });
    expect(pollOptions(false, 15_000)).toEqual({
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });

  it("stops QueryObserver timer and focus refetches while paused and resumes cleanly", async () => {
    environmentManager.setIsServer(() => false);
    vi.useFakeTimers();

    const queryFn = vi.fn().mockResolvedValue({ ok: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, {
      queryKey: ["status", "ns", "rel"],
      queryFn,
      ...pollOptions(true, 15_000),
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(queryFn).toHaveBeenCalledTimes(2);

    const release = pausePolling();
    releases.push(release);
    observer.setOptions({
      queryKey: ["status", "ns", "rel"],
      queryFn,
      ...pollOptions(!isPollingPaused(), 15_000),
    });

    await vi.advanceTimersByTimeAsync(45_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);

    release();
    observer.setOptions({
      queryKey: ["status", "ns", "rel"],
      queryFn,
      ...pollOptions(!isPollingPaused(), 15_000),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(queryFn).toHaveBeenCalledTimes(3);

    unsubscribe();
  });
});
