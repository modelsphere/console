import { isMap, parseDocument } from "yaml";
import type { Plan, SiteProfile } from "@swiss/lib/api";
import { presetValues, withEnv } from "@swiss/lib/formLayer";
import { answerAt } from "@swiss/lib/inputs";
import type { Form } from "@swiss/components/DeploySettings";
import { formFromPlan, planRequest } from "./deployment-settings";
import { mergeValues, overrideEdit, parseValues, valuesYaml, type Values } from "./override-yaml";

const CONTROL_FIELDS = ["namespace", "serviceId", "createNamespace", "skipSchemaValidation", "preset"] as const;

export interface DeploymentDraftContext {
  options?: Omit<Parameters<typeof planRequest>[1], "model">;
  profile?: SiteProfile;
  layers?: Plan["layers"];
}

function formValues(form: Form, context?: DeploymentDraftContext): Values {
  const serialize = (settings: Form) => planRequest({ ...settings, edits: "", preset: "" }, { ...context?.options, model: settings.serviceId }, context?.profile).overrides ?? {};
  // Disabling a feature changes its switch, not the settings hidden by that switch.
  const settings = serialize({ ...form, scaler: true, cart: true, cache: true, monitor: true, adaptiveCc: true });
  const values = mergeValues(settings, serialize(form));
  values.cache = { ...(values.cache as Values), enabled: form.cache };
  if (form.localPath.trim()) values.model = mergeValues((values.model as Values | undefined) ?? {}, { localPath: form.localPath.trim() });
  if (form.gpuResource) values.model = mergeValues((values.model as Values | undefined) ?? {}, { gpuResource: form.gpuResource });
  return values;
}

export function seedDraft(form: Form, explicit?: Values, context?: DeploymentDraftContext): string {
  explicit ??= formValues(form, context);
  const resource = form.gpuResource ? { model: { gpuResource: form.gpuResource } } : {};
  return valuesYaml(mergeValues(mergeValues(resource, explicit), parseValues(form.edits)));
}

export function draftBaseline(controls: Form, baseline: Values, context?: DeploymentDraftContext): Values {
  const preset = presetValues(context?.profile, controls.preset) ?? {};
  return mergeValues(mergeValues(baseline, withEnv(baseline, preset)), context?.options?.formLayer ?? {});
}

export function draftForm(controls: Form, text: string, baseline: Values = {}, context?: DeploymentDraftContext): Form {
  const values = mergeValues(draftBaseline(controls, baseline, context), parseValues(text));
  const resource = (values.model as Values | undefined)?.gpuResource;
  const projected = formFromPlan({ release: { name: controls.serviceId, namespace: controls.namespace }, layers: { form: values, derived: { model: { gpuResource: typeof resource === "string" ? resource : "" } } } });
  const explicit = context ? mergeValues(context.options?.formLayer ?? {}, parseValues(text)) : values;
  const owned = formFromPlan({ release: { name: controls.serviceId, namespace: controls.namespace }, layers: { ...context?.layers, catalog: context?.options?.values ?? context?.layers?.catalog ?? {}, site: context?.profile?.extra ?? context?.layers?.site ?? {}, form: explicit } }, context?.profile?.nodes?.gpus ?? context?.options?.gpuSpecs);
  const inputs = Object.fromEntries((context?.options?.inputs ?? []).map((input) => [input.key, answerAt(values, input.key) ?? ""]));
  const metadata = Object.fromEntries(CONTROL_FIELDS.map((key) => [key, controls[key]]));
  return { ...projected, images: owned.images, resources: owned.resources, customResources: owned.customResources, pd: owned.pd, affinity: owned.affinity, inputs, ...metadata, edits: text };
}

// Use the existing serializer to identify a control's values, including conditional fields.
export function editDraftForm(text: string, form: Form, patch: Partial<Form>, context?: DeploymentDraftContext): string {
  const current = context && { ...context, options: { ...context.options, formLayer: mergeValues(context.options?.formLayer ?? {}, parseValues(text)) } };
  const before = formValues(form, current);
  const after = formValues({ ...form, ...patch }, current);
  const changes = overrideEdit(before, {}, after).edits;
  const edited = editDraftValues(text, changes, before);
  const pd = patch.pd ? pdAffinityChanges(changes) : {};
  return editDraftValues(editDraftValues(edited, pd, {}, "retain"), explicitNulls(changes, after), {}, "retain");
}

function pdAffinityChanges(changes: Values): Values {
  const pd = changes.pd;
  if (!pd || typeof pd !== "object" || Array.isArray(pd)) return {};
  const roles = Object.entries(pd).flatMap(([role, value]) => value && typeof value === "object" && Object.hasOwn(value, "affinityReplace") ? [[role, { affinityReplace: (value as Values).affinityReplace }]] : []);
  return roles.length ? { pd: Object.fromEntries(roles) } : {};
}

function explicitNulls(changes: Values, after: Values): Values {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (value === null && Object.hasOwn(after, key) && after[key] === null) entries.push([key, null]);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const next = after[key];
      const nested = explicitNulls(value as Values, next && typeof next === "object" ? next as Values : {});
      if (Object.keys(nested).length) entries.push([key, nested]);
    }
  }
  return Object.fromEntries(entries);
}

export function editDraftValues(text: string, changes: Values, before: Values = {}, nulls: "remove" | "retain" = "remove"): string {
  parseValues(text);
  if (!Object.keys(changes).length) return text;
  const document = parseDocument(text, { uniqueKeys: true });
  const apply = (values: Values, previous: Values, parent: string[]) => {
    for (const [key, value] of Object.entries(values)) {
      const path = [...parent, key];
      const old = previous[key];
      if (value === null && nulls === "remove") {
        if (old && typeof old === "object" && !Array.isArray(old)) {
          apply(Object.fromEntries(Object.keys(old).map((child) => [child, null])), old as Values, path);
        } else if (document.hasIn(path)) document.deleteIn(path);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        if (!isMap(document.getIn(path, true))) document.setIn(path, document.createNode({}));
        apply(value as Values, old && typeof old === "object" ? old as Values : {}, path);
      } else document.setIn(path, value);
    }
  };
  apply(changes, before, []);
  return document.contents === null ? "" : document.toString();
}

export function draftControls(controls: Form, patch: Partial<Form>): Form {
  const metadata = Object.fromEntries(CONTROL_FIELDS.filter((key) => key in patch).map((key) => [key, patch[key]]));
  return { ...controls, ...metadata };
}
