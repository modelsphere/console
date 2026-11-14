import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deployApi, type Plan, type PlanRequest } from "@swiss/lib/api";
import { composeDeploymentDraft, deploymentValuesRequest, deploymentPolicy, type DeploymentSettings } from "./deployment-preview";
import { computedYaml, parseValues, type Values } from "./override-yaml";
import { layersOf } from "@swiss/components/Provenance";
import { mergeValues, valuesYaml } from "./override-yaml";

export interface ConfigurationPreview {
  baseline: string;
  effective: string;
  plan: Plan;
  policy?: Values;
}

export interface HelmValuesSource {
  key: string;
  data?: ConfigurationPreview;
  loading: boolean;
  error?: Error | null;
  load: () => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}

export async function readDeploymentValues(request: PlanRequest, text: string, catalog: string | undefined, settings: DeploymentSettings): Promise<ConfigurationPreview> {
  let submitted = request;
  const plan = await composeDeploymentDraft(request, parseValues(text), (input) => { submitted = input; return deployApi.plan(input); }, catalog, settings);
  const actual = await deployApi.helmValues(deploymentValuesRequest(submitted, plan, catalog));
  // Use the same validated plan: composing without user inputs can reject a required answer.
  const baseline = layersOf(plan).filter((key) => ["defaults", "catalog", "site", "derived"].includes(key)).reduce((values, key) => mergeValues(values, plan.layers[key]), {});
  const policy = deploymentPolicy(request);
  return { baseline: computedYaml(actual.defaults, valuesYaml(mergeValues(baseline, policy))), effective: computedYaml(actual.defaults, actual.overrides), plan, policy };
}

export function useDeploymentValues(request: PlanRequest | undefined, text: string, catalog: string | undefined, context: string, settings: DeploymentSettings) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(text);
  useEffect(() => { const timer = setTimeout(() => setSettled(text), 250); return () => clearTimeout(timer); }, [text]);
  const metadata = request && { ...request, editsYAML: undefined };
  const key = JSON.stringify([metadata, text, catalog, context]);
  const query = useQuery({
    queryKey: ["configuration-preview", metadata, settled, catalog, context, settings],
    queryFn: () => readDeploymentValues(metadata!, settled, catalog, settings),
    enabled: open && !!metadata && text === settled,
    retry: false,
    gcTime: 0,
  });
  const current = text === settled;
  return {
    key,
    data: current && !query.isError && !query.isFetching ? query.data : undefined,
    loading: open && (!current || query.isFetching),
    error: current ? query.error : undefined,
    load: () => query.refetch(),
    onOpenChange: setOpen,
  } satisfies HelmValuesSource;
}
