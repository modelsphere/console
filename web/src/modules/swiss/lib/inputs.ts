import type { Input, SiteInput, SiteProfile } from "./api";
import { findAt, isFieldKey, readAt, splitKey, writeAt } from "./inputKey";

export interface InputChoice {
  answer: string;
  from: "site" | "variant";
}

// answer applies when the field is left empty; none means the deployer must fill it.
// choices, when more than one answer is found, are the ones to pick between, answer first.
// site is the site profile's answer: as it is written, and filled for this model.
// release is the release's recorded answer, which an upgrade prefills into the field.
export interface InputRow {
  input: Input;
  release?: string;
  answer?: string;
  from?: InputChoice["from"];
  choices?: InputChoice[];
  site?: { answer?: string; written: string };
}

// fillTemplate mirrors swissd's site.fill, and is undefined where swissd refuses.
export function fillTemplate(tmpl: string, hf: string, model: string): string | undefined {
  if (!hf && /\{\{(hf|org|name)\}\}/.test(tmpl)) return undefined;
  const slash = hf.indexOf("/");
  const org = slash < 0 ? hf : hf.slice(0, slash);
  const name = slash < 0 ? "" : hf.slice(slash + 1);
  const out = tmpl.replace(/\{\{(hf|org|name|model)\}\}/g, (_, ph: string) => ({ hf, org, name, model })[ph] ?? "");
  return out.includes("{{") ? undefined : out;
}

export function answerAt(tree: Record<string, unknown> | undefined, key: string, patcher?: string): string | undefined {
  return readAt(tree, key, patcher);
}

// What an empty field falls back to: the site profile, the input's default, then the
// variant's own values. The release's answer is not a fallback: an upgrade prefills it
// into the field, so clearing the field drops it.
export function inputRows(
  inputs: Input[] | undefined,
  profile: SiteProfile | undefined,
  hf: string,
  model: string,
  variantValues?: Record<string, unknown>,
  release?: Record<string, unknown>,
  annotation?: string,
): InputRow[] {
  const recorded = releaseInputState(inputs, variantValues, release, annotation).answers;
  const siteInputs = siteInputList(profile?.inputs);
  return (inputs ?? []).map((input) => {
    const v = siteInputs.find((s) => s.key === input.key)?.value;
    const site = v === undefined || v === null ? undefined : { answer: typeof v === "string" ? fillTemplate(v, hf, model) : String(v), written: String(v) };
    const release = recorded[input.key];
    const found: [string | undefined, InputChoice["from"]][] = [
      [site?.answer, "site"],
      [input.default !== undefined && input.default !== null ? String(input.default) : answerAt(variantValues, input.key, input.patcher), "variant"],
    ];
    const answers = found.flatMap(([answer, from]) => (answer === undefined ? [] : [{ answer, from }]));
    const base = { input, ...(release !== undefined && { release }), ...(site && { site }) };
    if (!answers.length) return base;
    // The form sends no empty answer, so "" is no choice; one answer is listed once, under its first source.
    const choices = answers.filter((c, i) => c.answer && answers.findIndex((d) => d.answer === c.answer) === i);
    return { ...base, ...answers[0], ...(choices.length > 1 && { choices }) };
  });
}

// An input is checked once typing pauses for this long, not on every key.
export const CHECK_MS = 500;

const patterns = new Map<string, RegExp>();
const patternOf = (p: string) => patterns.get(p) ?? patterns.set(p, new RegExp(`^(?:${p})$`, "u")).get(p)!;

// What swissd would refuse an answer for.
export function inputProblem(input: Input, text: string): string | undefined {
  const t = text.trim();
  switch (input.type ?? "string") {
    case "integer":
      return /^-?\d+$/.test(t) ? undefined : "a whole number";
    case "boolean":
      return t === "true" || t === "false" ? undefined : "true or false";
    default:
      if (!input.pattern) return undefined;
      try {
        return patternOf(input.pattern).test(t) ? undefined : `must match ${input.pattern}`;
      } catch {
        return undefined; // swissd's own check names a pattern it cannot read
      }
  }
}

// Why a deploy cannot go with the row's answer, the typed one or else the row's own:
// it has none, or one the input does not take.
export function inputError(row: InputRow, text = ""): "required" | "invalid" | undefined {
  const answer = text.trim() || row.answer;
  if (!answer) return answer === undefined || inputProblem(row.input, "") ? "required" : undefined;
  return inputProblem(row.input, answer) ? "invalid" : undefined;
}

// A typed answer the site profile can take: one the input takes, not the site's own,
// and not the release's answer prefilled on an upgrade.
export function rememberable(row: InputRow, text = ""): boolean {
  const t = text.trim();
  return !!t && !inputError(row, t) && t !== row.site?.answer && t !== row.release;
}

export interface SiteSave {
  key: string;
  text: string;
  value: unknown;
  replaces?: string;
}

// What a deploy saves to the site profile once it applies: the ticked answers it can take.
export function siteSaves(rows: InputRow[], answers: Record<string, string>, remember: Record<string, boolean>): SiteSave[] {
  return rows.flatMap((row) => {
    const text = answers[row.input.key]?.trim() ?? "";
    if (!remember[row.input.key] || !rememberable(row, text)) return [];
    return [{ key: row.input.key, text, value: typed(row.input, text), replaces: row.site?.written }];
  });
}

export const inputsAnswered = (rows: InputRow[], answers: Record<string, string>) => rows.every((row) => !inputError(row, answers[row.input.key]));

export function typed(input: Input, text: string): unknown {
  switch (input.type ?? "string") {
    case "integer":
      return Number(text);
    case "boolean":
      return text === "true";
    default:
      return text;
  }
}

export const INPUTS_ANNOTATION = "swiss.modelsphere.dev/inputs";

export interface InputRecord {
  key: string;
  value: unknown;
}

export interface DroppedInput {
  key: string;
  value: string;
  reason: "deprecated" | "broken";
}

type Recorded = { key: string; value: string | number | boolean };

function onePrimitive(root: unknown, key: string): boolean {
  const found = findAt(root, splitKey(key));
  return found.length === 1 && ["string", "number", "boolean"].includes(typeof found[0].value);
}

export function parseInputRecords(raw: string | undefined): { present: boolean; records: Recorded[] } {
  if (raw === undefined) return { present: false, records: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { present: true, records: [] };
  }
  if (!Array.isArray(data)) return { present: true, records: [] };
  const records: Recorded[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.key !== "string") continue;
    if (typeof rec.value !== "string" && typeof rec.value !== "number" && typeof rec.value !== "boolean") continue;
    records.push({ key: rec.key, value: rec.value });
  }
  return { present: true, records };
}

// Annotation present: recheck every recorded answer against the new variant.
// None: field-only keys still read from the release form layer, as they did before.
export function releaseInputState(
  inputs: Input[] | undefined,
  values: Record<string, unknown> | undefined,
  formLayer: Record<string, unknown> | undefined,
  annotation: string | undefined,
): { present: boolean; answers: Record<string, string>; dropped: DroppedInput[] } {
  const parsed = parseInputRecords(annotation);
  if (!parsed.present) {
    const answers: Record<string, string> = {};
    for (const input of inputs ?? []) {
      if (!isFieldKey(input.key)) continue;
      const text = answerAt(formLayer, input.key, input.patcher);
      if (text !== undefined) answers[input.key] = text;
    }
    return { present: false, answers, dropped: [] };
  }
  const byKey = new Map((inputs ?? []).map((input) => [input.key, input]));
  const answers: Record<string, string> = {};
  const dropped: DroppedInput[] = [];
  const seen = new Set<string>();
  for (const rec of parsed.records) {
    if (seen.has(rec.key)) continue;
    seen.add(rec.key);
    const value = String(rec.value);
    if (!byKey.has(rec.key)) {
      dropped.push({ key: rec.key, value, reason: "deprecated" });
      continue;
    }
    if (!isFieldKey(rec.key) && !onePrimitive(values, rec.key)) {
      dropped.push({ key: rec.key, value, reason: "broken" });
      continue;
    }
    answers[rec.key] = value;
  }
  return { present: true, answers, dropped };
}

export function filledSiteAnswers(
  inputs: Input[] | undefined,
  siteInputs: SiteInput[] | undefined,
  hf: string,
  model: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const list = siteInputList(siteInputs);
  if (!list.length) return out;
  for (const input of inputs ?? []) {
    const v = list.find((s) => s.key === input.key)?.value;
    if (v == null) continue;
    const text = typeof v === "string" ? fillTemplate(v, hf, model) : String(v);
    if (text) out[input.key] = text;
  }
  return out;
}

export function inputAnnotations(records: InputRecord[], opts?: { replace?: boolean }): Record<string, string> | undefined {
  if (!records.length && !opts?.replace) return undefined;
  return { [INPUTS_ANNOTATION]: JSON.stringify(records) };
}

export interface InputWriteOpts {
  values?: Record<string, unknown>;
  site?: Record<string, string>;
}

// Every key, a field-only dotted one included, writes the effective answer:
// typed (an upgrade prefills the release's), else the site's, else the input's default.
// Only a typed answer is returned, so a site or default answer is in the form
// layer and not the annotation.
export function setInputOverrides(
  overrides: Record<string, unknown>,
  inputs: Input[] | undefined,
  answers: Record<string, string>,
  opts?: InputWriteOpts,
): InputRecord[] {
  const written: InputRecord[] = [];
  for (const input of inputs ?? []) {
    const typedText = answers[input.key]?.trim() ?? "";
    const raw = typedText || opts?.site?.[input.key] || (input.default != null ? String(input.default) : "");
    if (!raw) continue;
    const value = typed(input, raw);
    const patcher = !input.type || input.type === "string" ? input.patcher : undefined;
    if (!writeAt(overrides, opts?.values, input.key, value, patcher)) continue;
    if (typedText) written.push({ key: input.key, value });
  }
  return written;
}

type Answer = string | number | boolean;
const SCALAR = /^(-?\d+|true|false)$/;

// Tolerates a map from an older swissd while preferring the current list shape.
export function siteInputList(inputs: SiteInput[] | Record<string, Answer> | undefined): SiteInput[] {
  if (Array.isArray(inputs)) return inputs;
  if (inputs && typeof inputs === "object") return Object.entries(inputs).map(([key, value]) => ({ key, value }));
  return [];
}

// An input answer as the YAML tab reads it: 8000 is a number, true a boolean, and
// quotes keep either a string. swissd checks the answer's type against the input's.
export const answerText = (v: Answer | null | undefined) =>
  v === null || v === undefined ? "" : typeof v === "string" && SCALAR.test(v) ? JSON.stringify(v) : String(v);

export function parseAnswer(text: string): Answer {
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return /^"(-?\d+|true|false)"$/.test(text) ? text.slice(1, -1) : text;
}

export interface SiteInputRow {
  key: string;
  value: string;
}

export type SiteInputError = "required" | "duplicate";

const blankInputRow = (r: SiteInputRow) => !r.key.trim() && !r.value;

export function siteInputRows(inputs?: SiteInput[]): SiteInputRow[] {
  return siteInputList(inputs).map((s) => ({ key: s.key, value: answerText(s.value) }));
}

// Completely blank rows are ones just added; half-filled rows stay so validation flags them.
export function siteInputsFromRows(rows: SiteInputRow[]): SiteInput[] | undefined {
  const kept = rows.filter((r) => !blankInputRow(r));
  return kept.length ? kept.map((r) => ({ key: r.key.trim(), value: parseAnswer(r.value) })) : undefined;
}

function checkInputKeys(keys: string[], skip?: (i: number) => boolean): (SiteInputError | undefined)[] {
  const seen = new Set<string>();
  return keys.map((raw, i) => {
    if (skip?.(i)) return undefined;
    const key = raw.trim();
    if (!key) return "required";
    if (seen.has(key)) return "duplicate";
    seen.add(key);
    return undefined;
  });
}

export function siteInputErrors(inputs?: SiteInput[]): (SiteInputError | undefined)[] {
  return checkInputKeys(siteInputList(inputs).map((s) => s.key));
}

export function siteInputRowErrors(rows: SiteInputRow[]): (SiteInputError | undefined)[] {
  return checkInputKeys(rows.map((r) => r.key), (i) => blankInputRow(rows[i]));
}

export function sameSiteInputs(a?: SiteInput[], b?: SiteInput[]): boolean {
  const la = siteInputList(a);
  const lb = siteInputList(b);
  if (la.length !== lb.length) return false;
  return la.every((x, i) => x.key === lb[i].key && x.value === lb[i].value);
}
