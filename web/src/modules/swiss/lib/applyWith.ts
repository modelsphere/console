import type { ApplyWith, CatalogSchema, LLMServiceInfo } from "@swiss/lib/api";

// Why an install cannot use llmsvc: the CRD is not served, swissd cannot use
// it, or the catalog is not v2 (swissd refuses an LLMService for a v1 plan).
export type LLMSVCBlock = "unserved" | "unavailable" | "schema";

export function llmsvcBlock(info: LLMServiceInfo | undefined, schema: CatalogSchema | undefined): LLMSVCBlock | undefined {
  if (!info?.served) return "unserved";
  if (!info.available) return "unavailable";
  if (schema !== "v2") return "schema";
}

// The picked method, else the site profile's; helm whenever llmsvc cannot take it.
export function installMethod(picked: ApplyWith | undefined, info: LLMServiceInfo | undefined, schema: CatalogSchema | undefined): ApplyWith {
  if (llmsvcBlock(info, schema)) return "helm";
  return picked ?? (info?.newInstalls === "llmsvc" ? "llmsvc" : "helm");
}
