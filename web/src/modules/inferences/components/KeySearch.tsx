import { useMemo, useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput, cn } from "@modelsphere/ui";
import { Search } from "lucide-react";
import { useT } from "@/modules/inferences/i18n";
import { searchKeys, type KeyLine } from "../override-yaml";

// A search over a YAML text's keys; picking one jumps to its line. Arrow keys
// move through the matches and Enter takes the highlighted one.
export function KeySearch({ keys, onJump }: { keys: KeyLine[]; onJump: (line: number) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchKeys(keys, query), [keys, query]);
  const jump = (key?: KeyLine) => {
    if (!key) return;
    setOpen(false);
    onJump(key.line);
  };
  return (
    <div className="relative">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder={t("deploy.overrides.search")}
          aria-label={t("deploy.overrides.search")}
          role="combobox"
          aria-expanded={open}
          onChange={(e) => (setQuery(e.target.value), setActive(0), setOpen(true))}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.max(0, Math.min(hits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter") {
              e.preventDefault();
              jump(hits[active]);
            }
          }}
        />
      </InputGroup>
      {open && query.trim() && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {hits.length ? (
            hits.map((key, i) => (
              <li
                key={`${key.path}@${key.line}`}
                role="option"
                aria-selected={i === active}
                className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-2 py-1 font-code text-xs", i === active && "bg-accent text-accent-foreground")}
                onMouseDown={(e) => (e.preventDefault(), jump(key))}
                onMouseEnter={() => setActive(i)}
              >
                <span className="truncate">{key.path}</span>
                <span className="shrink-0 text-muted-foreground">{key.line + 1}</span>
              </li>
            ))
          ) : (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t("deploy.overrides.noKey")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
