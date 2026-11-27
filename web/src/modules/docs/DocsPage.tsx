import { useEffect, useRef } from "react";
import { Link, NavLink, useParams } from "react-router";
import { PageBanner } from "@modelsphere/ui";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useModulePath } from "@/shell";
import { useT } from "@/modules/docs/i18n";
import { Markdown } from "@/modules/docs/Markdown";
import { useHelpChapters, type HelpChapter } from "./use-chapters";

function ChapterNavigation({ chapters, selected }: { chapters: HelpChapter[]; selected?: string }) {
  const t = useT();
  const path = useModulePath();
  return (
    <nav className="w-52 shrink-0 overflow-y-auto rounded-lg border bg-card p-2">
      <div className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">{t("chapters")}</div>
      {chapters.map((chapter) => (
        <NavLink key={chapter.slug} to={path(`docs/${chapter.slug}`)}
          className={({ isActive }) => `block rounded-md px-2 py-1.5 text-sm transition-colors ${isActive || chapter.slug === selected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
          {chapter.title}
        </NavLink>
      ))}
    </nav>
  );
}

function ChapterPagination({ prev, next }: { prev?: HelpChapter; next?: HelpChapter }) {
  const t = useT();
  const path = useModulePath();
  return (
    <div className="mt-10 flex justify-between gap-4 border-t pt-4 text-sm">
      {prev ? <Link to={path(`docs/${prev.slug}`)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />{t("prev")} · {prev.title}
      </Link> : <span />}
      {next && <Link to={path(`docs/${next.slug}`)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        {t("next")} · {next.title}<ChevronRight className="size-4" />
      </Link>}
    </div>
  );
}

export function DocsPage() {
  const t = useT();
  const { locale } = useLocale();
  const chapters = useHelpChapters(locale);
  const { chapter = chapters[0]?.slug } = useParams();
  const index = chapters.findIndex((entry) => entry.slug === chapter);
  const current = chapters[index];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [chapter]);

  return (
    <div className="flex h-full flex-col">
      <PageBanner title={t("title")} description={t("description")} icon={<BookOpen className="size-5" />} />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <ChapterNavigation chapters={chapters} selected={chapter} />
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto rounded-lg border bg-card">
          <div className="mx-auto max-w-3xl px-8 py-6">
            {current?.text ? <>
              <Markdown text={current.text} assetBase={current.assetBase} />
              <ChapterPagination prev={chapters[index - 1]} next={chapters[index + 1]} />
            </> : <p className="text-sm text-muted-foreground">{t("notFound")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
