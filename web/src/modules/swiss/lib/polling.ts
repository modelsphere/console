import { useEffect, useSyncExternalStore } from "react";

let pauses = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether background status polling is currently paused (e.g. an upgrade or install sheet is open). */
export function isPollingPaused(): boolean {
  return pauses > 0;
}

/** Increment the polling pause ref-count and return an idempotent release callback. */
export function pausePolling(): () => void {
  pauses += 1;
  if (pauses === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauses = Math.max(0, pauses - 1);
    if (pauses === 0) notify();
  };
}

/** Subscribe to whether background status polling is paused. */
export function usePollingPaused(): boolean {
  return useSyncExternalStore(subscribe, isPollingPaused, isPollingPaused);
}

/** Pause background status polling for as long as the calling component stays mounted with `active`. */
export function usePausePolling(active = true): void {
  useEffect(() => {
    if (!active) return;
    return pausePolling();
  }, [active]);
}

/** Query options that enable interval polling when `active` and suppress interval/focus/reconnect refetches when paused. */
export function pollOptions(active: boolean, ms: number | false) {
  return active
    ? { refetchInterval: ms }
    : { refetchInterval: false as const, refetchOnWindowFocus: false as const, refetchOnReconnect: false as const };
}

/** Subscribe to global polling pause state and return `pollOptions(active && !paused, ms)`. */
export function usePollOptions(ms: number | false, active = true) {
  const paused = usePollingPaused();
  return pollOptions(active && !paused, ms);
}
