import type {
  ChartVersions,
  ChartVersionsSource,
  CatalogIndexV2,
  CatalogVariant,
  LLMCanary,
  ProductionTarget,
} from "../types";
import {
  catalogIndexV2,
  catalogVariants,
  findVariant,
} from "../fixtures/catalog-v2";
import { fixtureCanaries } from "../fixtures/canaries";
import { productionTargets } from "../fixtures/deployments";

/**
 * Cluster writes stay behind this interface. The fixture host never talks to kube.
 */
export interface CanaryApi {
  list(): Promise<LLMCanary[]>;
  get(namespace: string, name: string): Promise<LLMCanary | null>;
  /** Upsert a client-side fixture. The host still does not write to a cluster. */
  create(canary: LLMCanary): Promise<LLMCanary>;
}

export interface CatalogApi {
  index(): Promise<CatalogIndexV2>;
  variant(
    model: string,
    id: string,
    version?: string,
  ): Promise<CatalogVariant | null>;
  variants(): Promise<CatalogVariant[]>;
  chartVersions(source: ChartVersionsSource): Promise<ChartVersions>;
}

export interface SwissApi {
  deployments(): Promise<ProductionTarget[]>;
}

/** Mutable overlay. The exported fixture array stays unchanged for tests. */
const canaryStore: LLMCanary[] = structuredClone(fixtureCanaries);

export const fixtureCanaryApi: CanaryApi = {
  async list() {
    return structuredClone(canaryStore);
  },
  async get(namespace, name) {
    const found = canaryStore.find(
      (c) => c.metadata.namespace === namespace && c.metadata.name === name,
    );
    return found ? structuredClone(found) : null;
  },
  async create(canary) {
    const next = structuredClone(canary);
    const index = canaryStore.findIndex(
      (c) =>
        c.metadata.namespace === next.metadata.namespace &&
        c.metadata.name === next.metadata.name,
    );
    if (index >= 0) canaryStore[index] = next;
    else canaryStore.push(next);
    return structuredClone(next);
  },
};

export const fixtureCatalogApi: CatalogApi = {
  async index() {
    if (catalogIndexV2.schema !== "v2") {
      throw new Error("catalog schema v1 is not supported");
    }
    return catalogIndexV2;
  },
  async variant(model, id, version) {
    return findVariant(model, id, version) ?? null;
  },
  async chartVersions(source) {
    const v = findVariant(source.model, source.variant, source.version);
    if (!v) throw new Error("Not found");
    return { chart: v.chart.name, range: v.chart.version, variant: v.id,
      versions: [v.resolvedChartVersion] };
  },
  async variants() {
    return catalogVariants;
  },
};

export const fixtureSwissApi: SwissApi = {
  async deployments() {
    return productionTargets;
  },
};

export const api = {
  canary: fixtureCanaryApi,
  catalog: fixtureCatalogApi,
  swiss: fixtureSwissApi,
};

import type { CanaryClient } from "./live-api";
import type { Experiment, Prepared, PricingTable } from "../types";
import { freezeFixtureEconomics } from "./fixture-economics";
import { emitManifests } from "./emit";
const fixtureExperiments: Experiment[] = canaryStore.map((c, i) => ({
  id: `fixture-${i}`,
  prepareId: `fixture-${i}`,
  name: c.metadata.name,
  namespace: c.metadata.namespace,
  creator: "fixture",
  createdAt: c.metadata.creationTimestamp ?? new Date().toISOString(),
  canary: c,
  prepared: {
    id: `fixture-${i}`,
    createdAt: new Date().toISOString(),
    draft: {} as Prepared["draft"],
    canary: c,
    plans: [],
    warnings: [],
  },
  compareArms: c.spec.arms.slice(0, 2).map((a) => a.name),
  state: "Running",
  cleanup: "pending",
  snapshot: "pending",
  archived: false,
  windows: [],
}));
const fixturePlans = new Map<string, Prepared>();
function fixtureExperiment(id: string) {
  const e = fixtureExperiments.find((e) => e.id === id);
  if (!e) throw new Error("Not found");
  return e;
}
import { fixtureMetrics } from "./fixture-metrics";
export const fixtureApi: CanaryClient = {
  mode: "fixture",
  async config() {
    return { namespaces: ["llm-serving"] };
  },
  pricing: {
    async get() {
      return structuredClone(fixturePricing);
    },
    async save(table) {
      if (table.revision !== fixturePricing.revision)
        throw new Error("Pricing changed; reload before saving");
      fixturePricing = {
        ...structuredClone(table),
        revision: table.revision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "fixture",
      };
      return structuredClone(fixturePricing);
    },
  },
  canary: fixtureCanaryApi,
  catalog: fixtureCatalogApi,
  swiss: fixtureSwissApi,
  experiments: {
    async list() {
      return structuredClone(
        fixtureExperiments.map((e) => ({
          id: e.id,
          name: e.name,
          namespace: e.namespace,
          creator: e.creator,
          createdAt: e.createdAt,
          state: e.state,
          archived: e.archived,
          cleanup: e.cleanup,
          snapshot: e.snapshot,
          snapshotError: e.snapshotError,
          error: e.error,
          compareArms: e.compareArms,
          targetRef: e.canary.spec.targetRef,
          phase: e.canary.status?.phase,
        })),
      );
    },
    async get(id) {
      return structuredClone(fixtureExperiment(id));
    },
    async prepare(draft) {
      const emitted = emitManifests(draft);
      const issues = emitted.issues;
      if (issues.length)
        throw new Error(
          issues.map((i) => `${i.path}: ${i.message}`).join("; "),
        );
      const p: Prepared = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        draft: structuredClone(draft),
        canary: emitted.canary,
        plans: [],
        warnings: [],
      };
      p.economics = freezeFixtureEconomics(
        p.canary,
        draft.arms,
        fixturePricing,
      );
      fixturePlans.set(p.id, p);
      return structuredClone(p);
    },
    async create(id) {
      const old = fixtureExperiments.find((e) => e.prepareId === id);
      if (old) return structuredClone(old);
      const p = fixturePlans.get(id);
      if (!p) throw new Error("Not found");
      if (
        fixtureExperiments.some(
          (e) =>
            e.name === p.draft.name &&
            e.namespace === p.draft.namespace &&
            e.cleanup !== "complete",
        )
      )
        throw new Error("Name already exists");
      const e: Experiment = {
        id: crypto.randomUUID(),
        prepareId: id,
        name: p.draft.name,
        namespace: p.draft.namespace,
        creator: "fixture",
        createdAt: new Date().toISOString(),
        canary: p.canary,
        prepared: p,
        compareArms:
          p.draft.compareArms ?? p.draft.arms.slice(0, 2).map((a) => a.name),
        state: "Running",
        cleanup: "pending",
        snapshot: "pending",
        archived: false,
        windows: [],
      };
      fixtureExperiments.unshift(e);
      canaryStore.push(e.canary);
      return structuredClone(e);
    },
    async stop(id) {
      const e = fixtureExperiment(id);
      e.state = "Stopped";
      e.cleanup = "complete";
      e.stopAt = new Date().toISOString();
      e.snapshot = "complete";
      return structuredClone(e);
    },
    async archive(id, archived) {
      const e = fixtureExperiment(id);
      if (e.state !== "Stopped") throw new Error("Stop experiment first");
      e.archived = archived;
      return structuredClone(e);
    },
    async snapshot(id) {
      return structuredClone(fixtureExperiment(id));
    },
    async revalue(id, revision, arms) {
      const e = fixtureExperiment(id);
      if ((e.prepared.economics?.revision ?? 0) !== revision)
        throw new Error("Valuation changed; reload before saving");
      e.prepared.economics = freezeFixtureEconomics(
        e.canary,
        arms.map((a) => ({
          ...a,
          chart: { name: "", version: "" },
          layers: {},
          replicaCount: 1,
        })),
        fixturePricing,
      );
      e.prepared.economics.revision = revision + 1;
      return structuredClone(e);
    },
    async metrics(id, start, end, requestedView) {
      const e = fixtureExperiment(id);
      return fixtureMetrics(e, start, end, {
        currency: e.prepared.economics?.currency ?? fixturePricing.currency,
        normalization: "raw",
        ...requestedView,
      });
    },
  },
};

let fixturePricing: PricingTable = {
  revision: 1,
  currency: "USD",
  models: {},
  default: {
    USD: { inputPerMillion: 1, cachedPerMillion: 0.1, outputPerMillion: 2 },
    CNY: { inputPerMillion: 7, cachedPerMillion: 0.7, outputPerMillion: 14 },
  },
};
for (const e of fixtureExperiments)
  e.prepared.economics = freezeFixtureEconomics(e.canary, [], fixturePricing);

const fixtureEnd = Math.floor(Date.now() / 60000) * 60 - 120;
for (const [index, e] of fixtureExperiments.entries()) {
  const end =
    index === 0 ? Date.parse("2026-10-20T08:00:00Z") / 1000 : fixtureEnd;
  e.createdAt = new Date((end - 3600) * 1000).toISOString();
  if (index === 0) {
    e.state = "Stopped";
    e.stopAt = new Date(end * 1000).toISOString();
    e.snapshot = "complete";
    e.cleanup = "complete";
  }
  e.windows = [
    [end - 2400, end - 1320],
    [end - 1200, end],
  ].map(([start, stop], generation) => ({
    start: new Date(start * 1000).toISOString(),
    end: new Date(stop * 1000).toISOString(),
    generation: generation + 1,
    bindings: Object.fromEntries(
      e.compareArms.map((arm) => [
        arm,
        {
          namespace: e.namespace,
          service: `fixture-${arm}`,
          uid: `synthetic-${generation}-${arm}`,
        },
      ]),
    ),
  }));
}
