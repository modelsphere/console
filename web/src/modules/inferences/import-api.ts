import { ApiError, request } from "@/shell/api";
import type { Plan } from "@swiss/lib/api";

export interface ImportOptions {
  enabled: boolean;
  namespaces: string[];
}

export interface ImportSelection {
  namespace: string;
  release: string;
  catalog: string;
  model: string;
  variant: string;
  version?: string;
}

export interface ImportPreview {
  plan: Plan;
  revision: number;
  chart: string;
  secretUID: string;
  resourceVersion: string;
  warnings: string[];
}

export async function importOptions(): Promise<ImportOptions> {
  try {
    return await request<ImportOptions>("GET", "/api/deployment-imports");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { enabled: false, namespaces: [] };
    throw error;
  }
}

export const previewImport = (selection: ImportSelection) => request<ImportPreview>("POST", "/api/deployment-imports/preview", selection);

export function confirmImport(selection: ImportSelection, preview: ImportPreview) {
  return request<{ namespace: string; release: string; revision: number; planHash: string }>("POST", "/api/deployment-imports", {
    ...selection,
    expectedRevision: preview.revision,
    expectedSecretUID: preview.secretUID,
    expectedResourceVersion: preview.resourceVersion,
    expectedPlanHash: preview.plan.hash,
  });
}
