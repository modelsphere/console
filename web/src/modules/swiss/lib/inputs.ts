import type { Input, SiteProfile } from "./api";

// answer applies when the field is left empty; none means the deployer must fill it.
export interface InputRow {
  input: Input;
  answer?: string;
  from?: "release" | "site" | "variant";
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
    const kept = answerAt(release, input.key);
    if (kept !== undefined) return { input, answer: kept, from: "release" };
    const v = profile?.inputs?.[input.key];
    const site = v === undefined || v === null ? undefined : typeof v === "string" ? fillTemplate(v, hf, model) : String(v);
    if (site !== undefined) return { input, answer: site, from: "site" };
    if (input.default !== undefined && input.default !== null) return { input, answer: String(input.default), from: "variant" };
    const base = answerAt(variantValues, input.key);
    return base !== undefined ? { input, answer: base, from: "variant" } : { input };
  });
}

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
        return new RegExp(`^(?:${input.pattern})$`, "u").test(t) ? undefined : `must match ${input.pattern}`;
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
