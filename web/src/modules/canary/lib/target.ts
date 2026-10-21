import type { CanaryDraft, ProductionTarget } from "../types";

/** Environment-owned fields always follow the selected production target. */
export function applyProductionTarget(
  draft: CanaryDraft,
  target: ProductionTarget,
): CanaryDraft {
  const routeKey = target.route?.replace(/^\//, "");
  const path = routeKey ? `/${routeKey}` : "";
  return {
    ...draft,
    targetRef: {
      kind: target.kind,
      name: target.name,
      namespace: target.namespace,
    },
    gateway: {
      name: target.gateway?.name ?? "",
      namespace: target.gateway?.namespace ?? "",
      hostname: target.gateway?.hostname,
      sectionName: target.gateway?.sectionName,
    },
    route: {
      ...draft.route,
      path,
      servicePort: undefined,
      productionOpenrestyService: target.openrestyService ?? "",
    },
  };
}

/** Match a select value (`namespace/name`) or a unique release name. */
export function findProductionTarget(
  targets: readonly ProductionTarget[],
  value: string,
): ProductionTarget | undefined {
  const byKey = targets.find(
    (target) => `${target.namespace}/${target.name}` === value,
  );
  if (byKey) return byKey;
  const byName = targets.filter((target) => target.name === value);
  return byName.length === 1 ? byName[0] : undefined;
}
