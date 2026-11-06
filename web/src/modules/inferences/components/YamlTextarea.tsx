import { memo, useImperativeHandle, useRef } from "react";
import { cn, highlightLine } from "@modelsphere/ui";

const CODE = { fontSize: "var(--code-font-size)", lineHeight: "var(--code-line-height)" };

export interface YamlTextareaHandle {
  // Selects a 0-based line and scrolls it a third of the way down.
  jumpTo: (line: number) => void;
}

// A YAML textarea, highlighted as CodeBlock draws: the text is drawn under a
// transparent textarea of the same font and padding, its scroll following the
// textarea's. The extra bottom and right room lets it scroll as far as the
// textarea does beside its scrollbars.
export function YamlTextarea({ value, onChange, invalid, className, ref, ...aria }: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
  ref?: React.Ref<YamlTextareaHandle>;
}) {
  const under = useRef<HTMLPreElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    jumpTo(line) {
      // The layer under the text has a row per line, so its offset is the line's.
      const ta = area.current;
      const row = under.current?.firstElementChild?.children[line] as HTMLElement | undefined;
      if (!ta || !row) return;
      const lines = ta.value.split("\n");
      const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
      const text = lines[line] ?? "";
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start + text.length - text.trimStart().length, start + text.length);
      ta.scrollTop = Math.max(0, row.offsetTop - ta.clientHeight / 3);
    },
  }), []);
  return (
    <div
      className={cn("relative overflow-hidden rounded-md border border-input font-code", invalid && "border-destructive", className)}
      style={{ background: "var(--code-bg)", color: "var(--code-fg)", ...CODE }}
    >
      <pre ref={under} aria-hidden className="pointer-events-none absolute inset-0 m-0 overflow-hidden font-code" style={CODE}>
        <div className="w-max min-w-full px-3 pt-2 pr-8 pb-8 whitespace-pre">
          {value.split("\n").map((line, i) => (
            <Line key={i} text={line} />
          ))}
        </div>
      </pre>
      <textarea
        ref={area}
        {...aria}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (!under.current) return;
          under.current.scrollTop = e.currentTarget.scrollTop;
          under.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 m-0 size-full resize-none overflow-auto bg-transparent px-3 py-2 font-code whitespace-pre text-transparent outline-none selection:bg-primary/25"
        style={{ ...CODE, caretColor: "var(--code-fg)" }}
      />
    </div>
  );
}

// Memoised on its text, so a keystroke redraws only the line it changed. An
// empty line holds a zero-width space to keep its height.
const Line = memo(function Line({ text }: { text: string }) {
  return (
    <div>
      {highlightLine(text, "yaml")}
      {text === "" ? "\u200b" : null}
    </div>
  );
});
