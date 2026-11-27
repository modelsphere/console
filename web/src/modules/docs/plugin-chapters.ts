import type { HelpChapterRegistration } from "../../../packages/plugin-sdk/src/types";
import { CHAPTERS } from "./chapter-list";

export interface PluginHelpChapter extends HelpChapterRegistration {
  plugin: string;
  assetBase: string;
  capability?: string;
}

export const pluginHelpChapters: PluginHelpChapter[] = [];

export function validateHelpChapter(plugin: string, chapter: HelpChapterRegistration): void {
  const fail = (reason: string): never => { throw new Error(`Invalid help chapter for "${plugin}": ${reason}`); };
  if (!chapter || typeof chapter !== "object") fail("expected an object");
  if (typeof chapter.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(chapter.slug)) fail("invalid slug");
  if (chapter.slug !== plugin && !chapter.slug.startsWith(`${plugin}-`)) fail("slug must belong to the plugin");
  if ((CHAPTERS as readonly string[]).includes(chapter.slug)) fail("built-in chapters cannot be replaced");
  for (const locale of ["en-US", "zh-CN"] as const) {
    if (typeof chapter.title?.[locale] !== "string" || !chapter.title[locale].trim()) fail(`missing ${locale} title`);
    if (typeof chapter.content?.[locale] !== "string" || !chapter.content[locale].trim()) fail(`missing ${locale} content`);
  }
  if (chapter.authKey !== undefined && (typeof chapter.authKey !== "string" || !chapter.authKey.trim())) fail("invalid authKey");
}

export function registerPluginHelpChapter(chapter: PluginHelpChapter): () => void {
  validateHelpChapter(chapter.plugin, chapter);
  if (pluginHelpChapters.some((current) => current.slug === chapter.slug)) {
    throw new Error(`Help chapter "${chapter.slug}" is already registered`);
  }
  const registered = { ...chapter, title: { ...chapter.title }, content: { ...chapter.content } };
  pluginHelpChapters.push(registered);
  return () => {
    const index = pluginHelpChapters.indexOf(registered);
    if (index >= 0) pluginHelpChapters.splice(index, 1);
  };
}
