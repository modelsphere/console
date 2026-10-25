import { CanaryApiError, errorMessage } from "./errors";
import { isExactChartVersion } from "./values";
import type {
  CanaryDraft,
  ChartVersions,
  ChartVersionsSource,
  CatalogIndexV2,
  CatalogVariant,
  CatalogInfo,
  LLMCanary,
  ProductionTarget,
  Experiment,
  ExperimentSummary,
  Prepared,
  Metrics,
  PricingTable,
  ValuationView,
  ArmDraft,
} from "../types";

export interface CanaryClient {
  mode: "live" | "fixture";
  config(): Promise<{ namespaces: string[] }>;
  pricing: {
    get(): Promise<PricingTable>;
    save(table: PricingTable): Promise<PricingTable>;
  };
  canary: {
    list(): Promise<LLMCanary[]>;
    get(namespace: string, name: string): Promise<LLMCanary | null>;
  };
  catalog: {
    list(): Promise<CatalogInfo[]>;
    index(catalog?: string): Promise<CatalogIndexV2>;
    variants(catalog?: string): Promise<CatalogVariant[]>;
    chartVersions(source: ChartVersionsSource): Promise<ChartVersions>;
  };
  swiss: { deployments(): Promise<ProductionTarget[]> };
  experiments: {
    list(): Promise<ExperimentSummary[]>;
    get(id: string): Promise<Experiment>;
    prepare(draft: CanaryDraft): Promise<Prepared>;
    create(prepareId: string): Promise<Experiment>;
    stop(id: string): Promise<Experiment>;
    updateTraffic(id: string, change: { production: number; canary: number; expectedGeneration: number }): Promise<Experiment>;
    archive(id: string, archived: boolean): Promise<Experiment>;
    snapshot(id: string): Promise<Experiment>;
    metrics(
      id: string,
      start?: number,
      end?: number,
      view?: ValuationView,
    ): Promise<Metrics>;
    revalue(
      id: string,
      revision: number,
      arms: Pick<ArmDraft, "name" | "pricingKey" | "gpuCount">[],
    ): Promise<Experiment>;
  };
}
export type AuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export function createLiveApi(
  fetcher: AuthFetch = fetch,
  base = "/api/canary",
): CanaryClient {
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    requestBase = base,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${requestBase}${path}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) throw error;
      throw new CanaryApiError(
        errorMessage(error),
        undefined,
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "network",
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (response.ok)
        throw new CanaryApiError(
          errorMessage(error),
          response.status,
          "badResponse",
        );
      data = null;
    }
    if (!response.ok) {
      const body =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      const message =
        typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      const params =
        body.params && typeof body.params === "object"
          ? (Object.fromEntries(
              Object.entries(body.params).filter(
                ([, value]) =>
                  typeof value === "string" || typeof value === "number",
              ),
            ) as Record<string, string | number>)
          : {};
      throw new CanaryApiError(
        message,
        response.status,
        typeof body.code === "string" ? body.code : undefined,
        params,
      );
    }
    return data as T;
  }
  const experiments = {
    updateTraffic: (id: string, change: { production: number; canary: number; expectedGeneration: number }) => request<Experiment>(`/experiments/${encodeURIComponent(id)}/traffic`, "PATCH", change),
    list: () => request<ExperimentSummary[]>("/experiments"),
    get: (id: string) =>
      request<Experiment>(`/experiments/${encodeURIComponent(id)}`),
    prepare: (draft: CanaryDraft) =>
      request<Prepared>("/prepare", "POST", draft),
    create: (prepareId: string) =>
      request<Experiment>("/experiments", "POST", { prepareId }),
    stop: (id: string) =>
      request<Experiment>(
        `/experiments/${encodeURIComponent(id)}/stop`,
        "POST",
      ),
    archive: (id: string, archived: boolean) =>
      request<Experiment>(`/experiments/${encodeURIComponent(id)}`, "PATCH", {
        archived,
      }),
    snapshot: (id: string) =>
      request<Experiment>(
        `/experiments/${encodeURIComponent(id)}/snapshot`,
        "POST",
      ),
    revalue: (
      id: string,
      revision: number,
      arms: Pick<ArmDraft, "name" | "pricingKey" | "gpuCount">[],
    ) =>
      request<Experiment>(
        `/experiments/${encodeURIComponent(id)}/valuation`,
        "POST",
        { revision, arms },
      ),
    metrics: (id: string, start?: number, end?: number, view?: ValuationView) =>
      request<Metrics>(
        `/experiments/${encodeURIComponent(id)}/metrics?${new URLSearchParams({ ...(start === undefined ? {} : { start: String(start) }), ...(end === undefined ? {} : { end: String(end) }), ...(view?.currency ? { currency: view.currency } : {}), ...(view ? { normalization: view.normalization } : {}), ...(view?.normalization === "as-if" ? { gpus: String(view.targetGPUs ?? "") } : {}) })}`,
      ),
  };
  const catalog = {
    list: async () => (await request<{ catalogs?: CatalogInfo[] }>("/cluster", "GET", undefined, "/api/deploy")).catalogs ?? [],
    async index(name?: string): Promise<CatalogIndexV2> {
      const index = await request<CatalogIndexV2>(
        name ? `/catalog?${new URLSearchParams({ catalog: name })}` : "/catalog",
        "GET", undefined, name ? "/api/deploy" : base,
      );
      if (index.schema !== "v2") throw new Error("catalog schema v2 is required");
      return index;
    },
    async chartVersions(source: ChartVersionsSource): Promise<ChartVersions> {
      const query = new URLSearchParams({
        variant: source.variant,
        version: source.version,
        ...(source.catalog ? { catalog: source.catalog } : {}),
      });
      const data = await request<ChartVersions>(
        `/catalog/${encodeURIComponent(source.model)}/chart-versions?${query}`,
        "GET", undefined, "/api/deploy",
      );
      if (!data || typeof data.chart !== "string" || !data.chart ||
          typeof data.range !== "string" || data.variant !== source.variant ||
          !Array.isArray(data.versions) ||
          !data.versions.every((v) => typeof v === "string" && isExactChartVersion(v)))
        throw new CanaryApiError("Invalid Swiss chart versions response", undefined, "badResponse");
      return { ...data, versions: [...new Set(data.versions)] };
    },
    async variants(name?: string): Promise<CatalogVariant[]> {
      return variantsFromIndex(await catalog.index(name));
    },
  };
  return {
    mode: "live",
    config: () => request<{ namespaces: string[] }>("/config"),
    pricing: {
      get: () => request<PricingTable>("/pricing"),
      save: (table) => request<PricingTable>("/pricing", "PATCH", table),
    },
    experiments,
    catalog,
    swiss: { deployments: () => request<ProductionTarget[]>("/deployments") },
    canary: {
      async list() {
        const active = (await experiments.list()).filter(
          (e) => e.cleanup !== "complete",
        );
        return Promise.all(
          active.map(async (e) => (await experiments.get(e.id)).canary),
        );
      },
      async get(namespace, name) {
        const summary = (await experiments.list()).find(
          (e) =>
            e.namespace === namespace &&
            e.name === name &&
            e.cleanup !== "complete",
        );
        return summary ? (await experiments.get(summary.id)).canary : null;
      },
    },
  };
}

export function variantsFromIndex(index: CatalogIndexV2): CatalogVariant[] {
  return index.models.flatMap((m) => m.variants.map((v) => ({
    ...v,
    apiVersion: "catalog.swiss/v2" as const,
    kind: "Variant" as const,
    model: m.name,
    engine: v.engine as CatalogVariant["engine"],
    chart: v.chart as CatalogVariant["chart"],
    resolvedChartVersion: "",
    values: {},
  })));
}
