import type { RiseHostSDK } from "./types";

/** Read the canonical host, retaining existing Global bundle compatibility. */
export function readHostSDK(): RiseHostSDK | undefined {
  const scope = globalThis as typeof globalThis & {
    __MODELSPHERE_SDK__?: RiseHostSDK;
    __GLOBAL_SDK__?: RiseHostSDK;
    __RISE_SDK__?: RiseHostSDK;
  };
  return scope.__MODELSPHERE_SDK__ ?? scope.__GLOBAL_SDK__ ?? scope.__RISE_SDK__;
}
