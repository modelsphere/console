import { useRef, type ComponentProps } from "react";
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import "@/modules/docs/markdown.css";
import { CopyButton } from "@/shell";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function Pre(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="group relative">
      <pre ref={ref} {...props} />
      <CopyButton className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100" text={() => ref.current?.textContent ?? ""} />
    </div>
  );
}

// "/inferences/catalog" in a chapter is a console page: navigate in place.
function A({ href = "", node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  if (href.startsWith("/")) return <Link to={href} {...props} />;
  return <a href={href} target="_blank" rel="noreferrer" {...props} />;
}

const components = { pre: Pre, a: A };

function imageSource(src: string | undefined, assetBase?: string): string | undefined {
  if (!src || !assetBase || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return src;
  if (/[\\%]/.test(src) || src.split("/").includes("..")) return undefined;
  return assetBase + src.replace(/^(\.\/)+/, "");
}

export function Markdown({ text, assetBase }: { text: string; assetBase?: string }) {
  const image = ({ src, node: _node, ...props }: ComponentProps<"img"> & { node?: unknown }) => (
    <img {...props} src={imageSource(typeof src === "string" ? src : undefined, assetBase)} />
  );
  return (
    <article className="docs-markdown prose prose-sm max-w-none break-words text-foreground prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-th:text-foreground prose-blockquote:rounded-r-md prose-blockquote:border-primary prose-blockquote:bg-muted/50 prose-blockquote:py-0.5 prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-foreground [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{ ...components, img: image }}>
        {text}
      </ReactMarkdown>
    </article>
  );
}
