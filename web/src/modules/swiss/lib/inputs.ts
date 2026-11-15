import type { Input, SiteProfile } from "./api";
import { dropWritten, findAt, isFieldKey, readAt, splitKey, writeAt } from "./inputKey";

export interface InputChoice {
  answer: string;
  from: "release" | "site" | "variant";
}

// answer applies when the field is left empty; none means the deployer must fill it.
// choices, when more than one answer is found, are the ones to pick between, answer first.
// site is the site profile's answer: as it is written, and filled for this model.
export interface InputRow {
  input: Input;
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

// The order swissd answers in: the release's form layer (carried forward on upgrade),
// the site profile, the input's default, then the variant's own values.
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
  return (inputs ?? []).map((input) => {
    const v = profile?.inputs?.[input.key];
    const site = v === undefined || v === null ? undefined : { answer: typeof v === "string" ? fillTemplate(v, hf, model) : String(v), written: String(v) };
    const found: [string | undefined, InputChoice["from"]][] = [
      [recorded[input.key], "release"],
      [site?.answer, "site"],
      [input.default !== undefined && input.default !== null ? String(input.default) : answerAt(variantValues, input.key, input.patcher), "variant"],
    ];
    const answers = found.flatMap(([answer, from]) => (answer === undefined ? [] : [{ answer, from }]));
    if (!answers.length) return site ? { input, site } : { input };
    // The form sends no empty answer, so "" is no choice; one answer is listed once, under its first source.
    const choices = answers.filter((c, i) => c.answer && answers.findIndex((d) => d.answer === c.answer) === i);
    return { input, ...answers[0], ...(choices.length > 1 && { choices }), ...(site && { site }) };
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

// A typed answer the site profile can take: one the input takes, and not the site's own.
export function rememberable(row: InputRow, text = ""): boolean {
  const t = text.trim();
  return !!t && !inputError(row, t) && t !== row.site?.answer;
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
export const INPUT_KEY_TYPE = "kyaml" as const;
// swissd refuses a longer value with 400. Omitting the field keeps the previous one.
const MAX_INPUT_ANNOTATION_BYTES = 16384;

export interface InputRecord {
  key: string;
  keyType: typeof INPUT_KEY_TYPE;
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
    if (rec.keyType !== undefined && rec.keyType !== INPUT_KEY_TYPE) continue;
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
): { present: boolean; answers: Record<string, string>; dropped: DroppedInput[]; dropKeys: string[] } {
  const parsed = parseInputRecords(annotation);
  if (!parsed.present) {
    const answers: Record<string, string> = {};
    for (const input of inputs ?? []) {
      if (!isFieldKey(input.key)) continue;
      const text = answerAt(formLayer, input.key, input.patcher);
      if (text !== undefined) answers[input.key] = text;
    }
    return { present: false, answers, dropped: [], dropKeys: [] };
  }
  const byKey = new Map((inputs ?? []).map((input) => [input.key, input]));
  const answers: Record<string, string> = {};
  const dropped: DroppedInput[] = [];
  const dropKeys: string[] = [];
  const seen = new Set<string>();
  for (const rec of parsed.records) {
    if (seen.has(rec.key)) continue;
    seen.add(rec.key);
    dropKeys.push(rec.key);
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
  return { present: true, answers, dropped, dropKeys };
}

export function dropInputWrites(layer: Record<string, unknown>, keys: string[]) {
  for (const key of keys) dropWritten(layer, key);
}

export function filledSiteAnswers(
  inputs: Input[] | undefined,
  siteInputs: Record<string, string | number | boolean> | undefined,
  hf: string,
  model: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!siteInputs) return out;
  for (const input of inputs ?? []) {
    const v = siteInputs[input.key];
    if (v == null) continue;
    const text = typeof v === "string" ? fillTemplate(v, hf, model) : String(v);
    if (text) out[input.key] = text;
  }
  return out;
}

export function inputAnnotations(records: InputRecord[], opts?: { replace?: boolean }): Record<string, string> | undefined {
  if (!records.length && !opts?.replace) return undefined;
  const json = JSON.stringify(records.map(({ key, value }) => ({ key, keyType: INPUT_KEY_TYPE, value })));
  if (new TextEncoder().encode(json).length > MAX_INPUT_ANNOTATION_BYTES) return undefined;
  return { [INPUTS_ANNOTATION]: json };
}

export interface InputWriteOpts {
  values?: Record<string, unknown>;
  release?: Record<string, string>;
  site?: Record<string, string>;
}

// A field-only key sends a typed answer, or on an upgrade the release's; the
// site and the default stay with swissd. A key swissd cannot write sends the
// effective answer: typed, else release, else site, else the input's default.
export function setInputOverrides(
  overrides: Record<string, unknown>,
  inputs: Input[] | undefined,
  answers: Record<string, string>,
  opts?: InputWriteOpts,
): InputRecord[] {
  const written: InputRecord[] = [];
  for (const input of inputs ?? []) {
    const typedText = answers[input.key]?.trim() ?? "";
    let raw = typedText;
    if (!raw) {
      const release = opts?.release?.[input.key] ?? "";
      raw = isFieldKey(input.key) ? release : release || opts?.site?.[input.key] || (input.default != null ? String(input.default) : "");
    }
    if (!raw) continue;
    const value = typed(input, raw);
    const patcher = !input.type || input.type === "string" ? input.patcher : undefined;
    if (!writeAt(overrides, opts?.values, input.key, value, patcher)) continue;
    written.push({ key: input.key, keyType: INPUT_KEY_TYPE, value });
  }
  return written;
}

type Answer = string | number | boolean;
const SCALAR = /^(-?\d+|true|false)$/;

// An input answer as the YAML tab reads it: 8000 is a number, true a boolean, and
// quotes keep either a string. swissd checks the answer's type against the input's.
export const answerText = (v: Answer) => (typeof v === "string" && SCALAR.test(v) ? JSON.stringify(v) : String(v));

export function parseAnswer(text: string): Answer {
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return /^"(-?\d+|true|false)"$/.test(text) ? text.slice(1, -1) : text;
}

export const answersText = (a?: Record<string, Answer>) => a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, answerText(v)]));
export const parseAnswers = (r?: Record<string, string>) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, parseAnswer(v)]));
