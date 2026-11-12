import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  CodeBlock,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  FieldInput,
  FloatingField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@modelsphere/ui";
import { Pencil } from "lucide-react";
import type { HelmValues } from "@swiss/lib/api";
import { editsWithEnv, withEnv } from "@swiss/lib/formLayer";
import { useT } from "@/modules/inferences/i18n";
import { KeySearch } from "./KeySearch";
import { YamlTextarea, type YamlTextareaHandle } from "./YamlTextarea";
import { computedYaml, keyLines, mergeValues, overrideEdit, overridePaths, parseValues, readYaml, valuesYaml, type KeyLine, type Values } from "../override-yaml";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The Advanced section's Override YAML: a summary in the form, its editor in a dialog.
// The chart's values and swissd's layers for the form as it stands, without
// the overrides. The deploy sheet caches them per request; load reads them
// again and resolves undefined on an error.
export interface HelmValuesSource {
  data?: HelmValues;
  loading: boolean;
  error?: Error | null;
  load: () => Promise<HelmValues | undefined>;
}

export function OverrideYaml({ value, onChange, source }: {
  value: string;
  onChange: (edits: string) => void;
  source?: HelmValuesSource;
}) {
  const t = useT();
  const f = (k: string) => t(`deploy.fields.${k}`);
  const [open, setOpen] = useState(false);
  const paths = overridePaths(value);
  const edit = () => setOpen(true);
  return (
    <>
      <FloatingField
        label={f("edits")}
        hint={f("editsHint")}
        error={paths ? undefined : t("deploy.overrides.invalid")}
        action={
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.edit")} title={t("common:actions.edit")} onClick={edit}>
            <Pencil className="size-3.5" />
          </Button>
        }
      >
        {/* Read-only: a click, Enter or Space opens the editor. */}
        <FieldInput
          readOnly
          value={paths?.join(", ") ?? ""}
          title={value || undefined}
          onClick={edit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              edit();
            }
          }}
          className="cursor-pointer font-mono text-xs"
        />
      </FloatingField>
      {open && <OverrideDialog value={value} source={source} onClose={() => setOpen(false)} onSave={(edits) => (onChange(edits), setOpen(false))} />}
    </>
  );
}

interface Loaded {
  values: HelmValues;
  layers: Values;
  // The overrides merged in, and swissd's layers with them over.
  edits: Values;
  overrides: string;
  // What the release would render from, as YAML and parsed.
  computed: string;
  base: Values;
}

// The tabs for these overrides: merged over swissd's layers, as the edit layer
// is, and those over the chart's values.
export function loadedFor(values: HelmValues, editsText: string): Loaded | undefined {
  try {
    const layers = parseValues(values.overrides);
    const edits = withEnv(layers, parseValues(editsText));
    const overrides = valuesYaml(mergeValues(layers, edits));
    const computed = computedYaml(values.defaults, overrides);
    return { values, layers, edits, overrides, computed, base: parseValues(computed) };
  } catch {
    return undefined;
  }
}

function OverrideDialog({ value, source, onClose, onSave }: {
  value: string;
  source?: HelmValuesSource;
  onClose: () => void;
  onSave: (edits: string) => void;
}) {
  const t = useT();
  const o = (k: string, params?: Record<string, string | number>) => t(`deploy.overrides.${k}`, params);
  // Values read earlier for this form open the tabs straight away.
  const [loaded, setLoaded] = useState(() => (source?.data ? loadedFor(source.data, value) : undefined));
  const [draft, setDraft] = useState(() => (loaded ? editsWithEnv(value, loaded.layers) : value));
  const [final, setFinal] = useState(() => loaded?.computed ?? "");
  // Values that arrive with the dialog open, as when the form settles onto a
  // request read before, fill the tabs with the overrides as they stand.
  useEffect(() => {
    if (loaded || !source?.data) return;
    const l = loadedFor(source.data, draft);
    if (!l) return;
    setDraft(editsWithEnv(draft, l.layers));
    setLoaded(l);
    setFinal(l.computed);
  }, [source?.data]);
  const [tab, setTab] = useState<Tab>(loaded ? "final" : "edit");
  // Two editors: edit.yaml is the overrides as stored, Final values the merged
  // values once the chart's are loaded. Switching tabs carries one into the other.
  const onFinal = tab === "final" && !!loaded;
  const text = onFinal ? final : draft;
  const setText = onFinal ? setFinal : setDraft;
  // Parsing a large values.yaml takes tens of milliseconds, so it waits for a
  // pause in typing rather than running on every keystroke; switching editor
  // or landing a load reads the new text at once.
  const settleKey = useMemo(() => ({}), [loaded, onFinal]);
  const settled = useSettled(text, settleKey);
  const read = useMemo(() => readYaml(settled), [settled]);
  const edit = useMemo(() => onFinal && loaded && read.values && overrideEdit(loaded.base, loaded.edits, read.values), [onFinal, loaded, read]);
  // The overrides as the editors hold them now, not as last settled: edit.yaml,
  // with Final values' changes folded in when that is the open tab. Undefined
  // while the text does not parse.
  const overridesNow = (): string | undefined => {
    const now = readYaml(text).values;
    if (!now) return undefined;
    if (!onFinal || !loaded) return loaded ? editsWithEnv(draft, loaded.layers) : draft;
    const e = overrideEdit(loaded.base, loaded.edits, now);
    return e.changes ? valuesYaml(e.edits) : editsWithEnv(draft, loaded.layers);
  };
  // Rebuilds the merged tabs over these overrides, with the values already read.
  const rebuild = (edits: string) => {
    const l = loaded && loadedFor(loaded.values, edits);
    if (!l) return;
    setLoaded(l);
    setFinal(l.computed);
  };
  // Leaving an editor carries its text into the other; a text that does not parse keeps its tab.
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    const edits = overridesNow();
    if (edits === undefined) return;
    if (onFinal || tab === "edit") {
      setDraft(edits);
      rebuild(edits);
    }
    setTab(next);
  };
  // A reload keeps what was typed: the changes go into the overrides first.
  const loadValues = async () => {
    const edits = overridesNow();
    if (edits === undefined || !source) return;
    const values = await source.load();
    const l = values && loadedFor(values, edits);
    if (!l) return;
    setDraft(editsWithEnv(edits, l.layers));
    setLoaded(l);
    setFinal(l.computed);
    setTab("final");
  };
  const save = () => {
    const edits = overridesNow();
    if (edits !== undefined) onSave(edits);
  };
  const finalEditor = useRef<YamlTextareaHandle>(null);
  const editEditor = useRef<YamlTextareaHandle>(null);
  const defaultsBox = useRef<HTMLDivElement>(null);
  const overridesBox = useRef<HTMLDivElement>(null);
  const loadedKeys = useMemo(() => loaded && { defaults: keyLines(loaded.values.defaults), overrides: keyLines(loaded.overrides) }, [loaded]);
  // The search runs over whichever text is on screen.
  const view: { keys: KeyLine[]; jump: (line: number) => void } =
    tab === "defaults"
      ? { keys: loadedKeys?.defaults ?? [], jump: (line) => jumpInBlock(defaultsBox.current, line) }
      : tab === "overrides"
        ? { keys: loadedKeys?.overrides ?? [], jump: (line) => jumpInBlock(overridesBox.current, line) }
        : tab === "edit"
          ? { keys: read.keys, jump: (line) => editEditor.current?.jumpTo(line) }
          : { keys: loaded ? read.keys : [], jump: (line) => finalEditor.current?.jumpTo(line) };
  const [size, setSize] = useState<Size>();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[85vh] max-h-[calc(100vh-2rem)] w-[min(92vw,80rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]"
        style={size && { width: size.w, height: size.h }}
      >
        <DialogHeader>
          {/* The explanation waits behind the hint; screen readers still get it as the description. */}
          <div className="flex items-center gap-1.5">
            <DialogTitle>{t("deploy.fields.edits")}</DialogTitle>
            <FieldHint>{o(loaded ? "layersDescription" : "description")}</FieldHint>
          </div>
          <DialogDescription className="sr-only">{o(loaded ? "layersDescription" : "description")}</DialogDescription>
        </DialogHeader>
        <KeySearch keys={view.keys} onJump={view.jump} />

        {/* In merge order: what the chart ships, what this deploy sets over it, the overrides as stored, and the result. */}
        <Tabs value={tab} onValueChange={(v) => switchTab(v as Tab)} className="min-h-0 min-w-0 flex-1 gap-2">
          <div className="flex items-center gap-2">
            {source && (
              <Button onClick={loadValues} disabled={source.loading || !!read.error}>
                {source.loading ? o("loading") : o("load")}
              </Button>
            )}
            <TabsList>
              <TabsTrigger value="defaults">{o("chart")}</TabsTrigger>
              <TabsTrigger value="overrides">{o("swiss")}</TabsTrigger>
              <TabsTrigger value="edit">{o("edit")}</TabsTrigger>
              <TabsTrigger value="final">{o("final")}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="defaults" className={TAB}>
            {loaded ? (
              <>
                <p className="text-xs text-muted-foreground">{o("chartHint")}</p>
                <div ref={defaultsBox} className={TAB}>
                  <ReadOnlyYaml language="yaml" lineNumbers value={loaded.values.defaults} downloadName="values.yaml" maxHeight="100%" className="min-h-0 flex-1" />
                </div>
              </>
            ) : (
              <NotLoaded text={o("notLoaded")} />
            )}
          </TabsContent>
          <TabsContent value="overrides" className={TAB}>
            {loaded ? (
              <>
                <p className="text-xs text-muted-foreground">{o("swissHint")}</p>
                <div ref={overridesBox} className={TAB}>
                  <ReadOnlyYaml language="yaml" lineNumbers value={loaded.overrides} downloadName="overrides.yaml" maxHeight="100%" className="min-h-0 flex-1" />
                </div>
              </>
            ) : (
              <NotLoaded text={o("notLoaded")} />
            )}
          </TabsContent>
          <TabsContent value="edit" className={TAB}>
            <p className="text-xs text-muted-foreground">{o("editHint")}</p>
            <YamlTextarea ref={editEditor} aria-label={o("edit")} invalid={tab === "edit" && !!read.error} value={draft} onChange={setDraft} className="min-h-0 flex-1" />
          </TabsContent>
          <TabsContent value="final" className={TAB}>
            {loaded ? (
              <>
                <p className="text-xs text-muted-foreground">{o("finalHint")}</p>
                <YamlTextarea ref={finalEditor} aria-label={o("final")} invalid={onFinal && !!read.error} value={final} onChange={setText} className="min-h-0 flex-1" />
              </>
            ) : (
              <NotLoaded text={o("notLoaded")} />
            )}
          </TabsContent>
        </Tabs>
        {read.error || source?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{read.error ?? message(source?.error)}</AlertDescription>
          </Alert>
        ) : edit && (
          <p className="text-xs text-muted-foreground">{o("changes", { n: edit.changes })}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={save} disabled={!!source?.loading || !!read.error}>
            {t("common:actions.save")}
          </Button>
        </DialogFooter>
        <ResizeHandle onResize={setSize} />
      </DialogContent>
    </Dialog>
  );
}

function NotLoaded({ text }: { text: string }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed p-6 text-sm text-muted-foreground">{text}</div>;
}

const TAB = "flex min-h-0 flex-1 flex-col gap-1.5";

// Its props do not change while the editor is typed in, so it is not redrawn.
const ReadOnlyYaml = memo(CodeBlock);

// value once it has not changed for ms. A new reset takes value at once: a
// load replaces the text rather than typing into it.
function useSettled<T>(value: T, reset?: unknown, ms = 200): T {
  const [settled, setSettled] = useState(value);
  const [last, setLast] = useState(reset);
  if (reset !== last) {
    setLast(reset);
    setSettled(value);
  }
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return reset !== last ? value : settled;
}

type Tab = "defaults" | "overrides" | "edit" | "final";

// Scrolls a CodeBlock to a 0-based line, a third of the way down, and flashes it.
function jumpInBlock(box: HTMLElement | null, line: number) {
  const pre = box?.querySelector("pre");
  const row = pre?.children[line] as HTMLElement | undefined;
  if (!pre || !row) return;
  pre.scrollTop += row.getBoundingClientRect().top - pre.getBoundingClientRect().top - pre.clientHeight / 3;
  row.animate([{ backgroundColor: "color-mix(in oklab, var(--primary) 25%, transparent)" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
}

interface Size {
  w: number;
  h: number;
}

const MIN: Size = { w: 480, h: 360 };

// The bottom-right corner drags the dialog's size. It stays centred, so it
// grows by twice the drag, which keeps the corner under the pointer; the
// viewport caps it in CSS.
function ResizeHandle({ onResize }: { onResize: (size: Size) => void }) {
  const start = useRef<Size & { x: number; y: number }>(undefined);
  return (
    <div
      aria-hidden
      className="absolute right-0.5 bottom-0.5 size-4 cursor-se-resize touch-none text-muted-foreground"
      onPointerDown={(e) => {
        const box = e.currentTarget.parentElement!.getBoundingClientRect();
        start.current = { x: e.clientX, y: e.clientY, w: box.width, h: box.height };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) onResize({ w: Math.max(MIN.w, s.w + 2 * (e.clientX - s.x)), h: Math.max(MIN.h, s.h + 2 * (e.clientY - s.y)) });
      }}
      onPointerUp={() => (start.current = undefined)}
    >
      <svg viewBox="0 0 16 16" className="size-full">
        <path d="M14 6 6 14M14 10l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}
