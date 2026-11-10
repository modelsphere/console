import { isMap, parseDocument } from "yaml";
import { api, type ProfileResponse } from "./api";
import type { SiteSave } from "./inputs";

// The profile's text with each answer set under inputs, its comments and every other line kept.
export function withSiteAnswers(yaml: string, saves: Pick<SiteSave, "key" | "value">[]): string {
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  if (doc.has("inputs") && !isMap(doc.get("inputs", true))) doc.set("inputs", doc.createNode({}));
  for (const s of saves) doc.setIn(["inputs", s.key], s.value);
  return String(doc);
}

// Read just before the write, so an edit made since the deploy page opened is kept.
export async function saveSiteAnswers(saves: SiteSave[]): Promise<ProfileResponse> {
  const current = await api.profile();
  if (current.error || current.yaml === undefined) throw new Error(current.error ?? "the site profile could not be read");
  return api.saveProfile({ yaml: withSiteAnswers(current.yaml, saves) });
}
