import type { ArmDraft, CatalogInfo } from "../types";

export function defaultCatalog(catalogs: CatalogInfo[]): string {
  const supported = catalogs.filter((c) => c.schema !== "v1");
  return (supported.find((c) => c.name === "upstreamv2") ??
    supported.find((c) => c.default) ?? supported[0])?.name ?? "";
}

export function changeArmCatalog(arm: ArmDraft, catalog: string): ArmDraft {
  return {
    ...arm,
    source: { catalog, model: "", variant: "", version: "" },
    chart: { name: "", version: "" },
    layers: { form: { replicaCount: arm.replicaCount } },
  };
}
