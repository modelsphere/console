import type { Input, SiteProfile } from "./api";

export interface InputChoice {
  answer: string;
  from: "release" | "site" | "variant";
}

// answer applies when the field is left empty; none means the deployer must fill it.
// choices, when more than one answer is found, are the ones to pick between, answer first.
export interface InputRow {
  input: Input;
  answer?: string;
  from?: InputChoice["from"];
  choices?: InputChoice[];
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

export function answerAt(tree: Record<string, unknown> | undefined, key: string): string | undefined {
  let node: unknown = tree;
  for (const k of key.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[k];
  }
  if (node === undefined || node === null || typeof node === "object") return undefined;
  return String(node);
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
): InputRow[] {
  return (inputs ?? []).map((input) => {
    const v = profile?.inputs?.[input.key];
    const found: [string | undefined, InputChoice["from"]][] = [
      [answerAt(release, input.key), "release"],
      [v === undefined || v === null ? undefined : typeof v === "string" ? fillTemplate(v, hf, model) : String(v), "site"],
      [input.default !== undefined && input.default !== null ? String(input.default) : answerAt(variantValues, input.key), "variant"],
    ];
    const answers = found.flatMap(([answer, from]) => (answer === undefined ? [] : [{ answer, from }]));
    if (!answers.length) return { input };
    // The form sends no empty answer, so "" is no choice; one answer is listed once, under its first source.
    const choices = answers.filter((c, i) => c.answer && answers.findIndex((d) => d.answer === c.answer) === i);
    return { input, ...answers[0], ...(choices.length > 1 && { choices }) };
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

export const inputsAnswered = (rows: InputRow[], answers: Record<string, string>) => rows.every((row) => !inputError(row, answers[row.input.key]));

function typed(input: Input, text: string): unknown {
  switch (input.type ?? "string") {
    case "integer":
      return Number(text);
    case "boolean":
      return text === "true";
    default:
      return text;
  }
}

// An empty field sends nothing, so its answer stays the site's and follows the profile.
export function setInputOverrides(overrides: Record<string, unknown>, inputs: Input[] | undefined, answers: Record<string, string>) {
  for (const input of inputs ?? []) {
    const text = answers[input.key]?.trim();
    if (!text) continue;
    const keys = input.key.split(".");
    let node = overrides;
    for (const key of keys.slice(0, -1)) {
      const next = node[key];
      if (!next || typeof next !== "object" || Array.isArray(next)) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[keys[keys.length - 1]] = typed(input, text);
  }
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
