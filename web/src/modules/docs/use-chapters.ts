import { useCapabilities } from "@/shell/capabilities";
import { useOptionalPermissions } from "@/shell/permissions";
import type { Locale } from "@/shell/i18n";
import { CHAPTERS, chapterText, chapterTitle } from "./chapters";
import { pluginHelpChapters } from "./plugin-chapters";

export interface HelpChapter {
  slug: string;
  title: string;
  text?: string;
  assetBase?: string;
}

export function useHelpChapters(locale: Locale): HelpChapter[] {
  const capabilities = useCapabilities();
  const permissions = useOptionalPermissions();
  const builtins = CHAPTERS.map((slug) => {
    const text = chapterText(locale, slug);
    return { slug, text, title: chapterTitle(text ?? "") };
  });
  const plugins = pluginHelpChapters.filter((chapter) => {
    if (chapter.authKey && !permissions?.has(chapter.authKey)) return false;
    if (!chapter.capability) return true;
    const access = capabilities.data?.[chapter.capability];
    return !capabilities.loading && !capabilities.failed && !!(access?.configured && access.canRead);
  }).sort((left, right) => left.slug.localeCompare(right.slug));
  return [...builtins, ...plugins.map((chapter) => ({
    slug: chapter.slug, title: chapter.title[locale], text: chapter.content[locale], assetBase: chapter.assetBase,
  }))];
}
