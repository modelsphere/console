import { useEffect, useMemo, useState, type SetStateAction } from "react";
import type { Form } from "@swiss/components/DeploySettings";
import type { GPUSpec } from "@swiss/lib/api";
import { applyResolvedGpu, configuredGpuProducts } from "./deployment-gpu";
import { draftBaseline, draftControls, draftForm, editDraftForm, editDraftValues, seedDraft, type DeploymentDraftContext } from "./deployment-draft";
import { mergeValues, overrideEdit, readYaml, type Values } from "./override-yaml";
import { recoveryInputError, recoverySettings, withRecovery, type RecoverySettings } from "./recovery";

export interface Draft {
  controls: Form;
  text: string;
  fields: Partial<Form>;
  recoveryFields: Partial<RecoverySettings>;
  initialText: string;
  initialControls: Form;
}

export function initialDraft(controls: Form, explicit?: Values, context?: DeploymentDraftContext): Draft {
  const text = seedDraft(controls, explicit, context);
  return { controls, text, initialText: text, initialControls: controls, fields: {}, recoveryFields: {} };
}

export function projection(draft: Draft, baseline: Values, specifications: GPUSpec[] = [], context?: DeploymentDraftContext): Form {
  const form = draftForm(draft.controls, draft.text, baseline, context);
  return { ...form, gpuProducts: configuredGpuProducts(mergeValues(baseline, parseValuesForGpu(draft.text)), specifications, form.gpuProducts), ...draft.fields, edits: draft.text };
}

function parseValuesForGpu(text: string): Values { return readYaml(text).values ?? {}; }

export function changeForm(draft: Draft, update: SetStateAction<Form> | Partial<Form>, baseline: Values, context?: DeploymentDraftContext): Draft {
  const valid = readYaml(draft.text).values;
  const current = valid ? projection(draft, baseline, context?.profile?.nodes?.gpus ?? context?.options?.gpuSpecs, context) : { ...draft.controls, edits: draft.text };
  const patch = typeof update === "function" ? update(current) : update;
  if (patch.edits !== undefined && patch.edits !== draft.text) return { ...draft, text: patch.edits, fields: {}, recoveryFields: {} };
  if (!valid) return draft;
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== current[key as keyof Form]));
  const fields = { ...draft.fields, ...changed };
  delete fields.edits;
  return { ...draft, controls: draftControls(draft.controls, patch), text: invalidNumber(fields, context) ? draft.text : editDraftForm(draft.text, draftForm(draft.controls, draft.text, baseline, context), fields, context), fields };
}

const NUMBERS = ["replicaCount", "scalerMin", "scalerMax", "backendMaxConcurrency", "cartMaxLoad", "ttftLimitMs", "tpsLimitTps", "adaptiveCcMinFrac", "cacheHistoryLimit", "cacheMaxSlots"] as const;

function invalidNumber(fields: Partial<Form>, context?: DeploymentDraftContext): keyof Form | undefined {
  if ((context?.options?.inputs ?? []).some((input) => input.type === "integer" && fields.inputs?.[input.key]?.trim() && !Number.isInteger(Number(fields.inputs[input.key])))) return "inputs";
  return NUMBERS.find((key) => fields[key]?.trim() && !Number.isFinite(Number(fields[key])));
}

export function changeRecovery(draft: Draft, patch: Partial<RecoverySettings>, baseline: Values): Draft {
  const values = readYaml(draft.text).values;
  if (!values) return draft;
  if (patch.enabled === false) return {
    ...draft,
    text: editDraftValues(draft.text, { continuationGateway: { enabled: false } }),
    recoveryFields: { ...draft.recoveryFields, ...patch },
  };
  const before = recoverySettings(mergeValues(baseline, values));
  const next = { ...before, ...draft.recoveryFields, ...patch };
  if (next.idleTimeout.trim() && !Number.isFinite(Number(next.idleTimeout))) return { ...draft, recoveryFields: { ...draft.recoveryFields, ...patch } };
  const changes = overrideEdit(withRecovery({}, before).overrides ?? {}, {}, withRecovery({}, next).overrides ?? {}).edits;
  return { ...draft, text: editDraftValues(draft.text, changes, withRecovery({}, before).overrides ?? {}), recoveryFields: { ...draft.recoveryFields, ...patch } };
}

export function useDeploymentDraft(initial: Form, explicit?: Values, baseline: Values = {}, specifications: GPUSpec[] = [], context?: DeploymentDraftContext) {
  const [draft, setDraft] = useState(() => initialDraft(initial, explicit, context));
  useEffect(() => setDraft(initialDraft(initial, explicit, context)), [initial, explicit]);
  const read = useMemo(() => readYaml(draft.text), [draft.text]);
  const form = read.values ? projection(draft, baseline, specifications, context) : { ...draft.controls, edits: draft.text };
  const recovery = { ...recoverySettings(mergeValues(draftBaseline(draft.controls, baseline, context), read.values ?? {})), ...draft.recoveryFields };
  return {
    form, recovery, error: read.error, invalidField: invalidNumber(draft.fields, context),
    values: read.values,
    dirty: draft.text !== draft.initialText || JSON.stringify(draft.controls) !== JSON.stringify(draft.initialControls) || !!invalidNumber(draft.fields, context) || !!recoveryInputError(recovery),
    reseedForm: (update: SetStateAction<Form>) => setDraft((previous) => {
      const pristine = previous.text === previous.initialText && Object.keys(previous.fields).length === 0;
      const next = changeForm(previous, update, baseline, context);
      return pristine ? { ...next, initialText: next.text, fields: {} } : next;
    }),
    setForm: (update: SetStateAction<Form> | Partial<Form>) => setDraft((previous) => changeForm(previous, update, baseline, context)),
    setResolvedGpu: (changes: Values) => setDraft((previous) => ({ ...previous, text: applyResolvedGpu(previous.text, changes) })),
    setRecovery: (patch: Partial<RecoverySettings>) => setDraft((previous) => changeRecovery(previous, patch, draftBaseline(previous.controls, baseline, context))),
  };
}
