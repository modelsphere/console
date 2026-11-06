import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  FieldInput,
  FloatingField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@modelsphere/ui";
import { Pencil } from "lucide-react";
import type { HelmValues } from "@swiss/lib/api";
import { useT } from "@/modules/inferences/i18n";
import { KeySearch } from "./KeySearch";
import { YamlTextarea, type YamlTextareaHandle } from "./YamlTextarea";
import { computedYaml, keyLines, overrideEdit, overridePaths, parseValues, readYaml, valuesYaml, type KeyLine, type Values } from "../override-yaml";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The Advanced section's Override YAML: a summary in the form, its editor in a dialog.
export function OverrideYaml({ value, onChange, load }: {
  value: string;
  onChange: (edits: string) => void;
  // Composes the form with these overrides, storing nothing.
  load?: (edits: string) => Promise<HelmValues>;
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
      {open && <OverrideDialog value={value} load={load} onClose={() => setOpen(false)} onSave={(edits) => (onChange(edits), setOpen(false))} />}
    </>
  );
}

interface Loaded {
  values: HelmValues;
  // The overrides the values were composed with.
  edits: Values;
  // What the release would render from, as YAML and parsed.
  computed: string;
  base: Values;
}

function OverrideDialog({ value, load, onClose, onSave }: {
  value: string;
  load?: (edits: string) => Promise<HelmValues>;
  onClose: () => void;
  onSave: (edits: string) => void;
}) {
  const t = useT();
  const o = (k: string, params?: Record<string, string | number>) => t(`deploy.overrides.${k}`, params);
  const [draft, setDraft] = useState(value);
  const [loaded, setLoaded] = useState<Loaded>();
  const [final, setFinal] = useState("");
  // Parsing a large values.yaml takes tens of milliseconds, so it waits for a
  // pause in typing rather than running on every keystroke.
  const settledDraft = useSettled(draft);
  const draftRead = useMemo(() => readYaml(settledDraft), [settledDraft]);
  const draftError = draftRead.error;
  const settledFinal = useSettled(final, loaded);
  const finalRead = useMemo(() => readYaml(settledFinal), [settledFinal]);
  const fetch = useMutation({
    mutationFn: async (): Promise<Loaded> => {
      const values = await load!(draft);
      const computed = computedYaml(values.defaults, values.overrides);
      return { values, edits: parseValues(draft), computed, base: parseValues(computed) };
    },
    onSuccess: (l) => {
      setLoaded(l);
      setFinal(l.computed);
      setTab("final");
    },
  });
  const [tab, setTab] = useState<Tab>("final");
  const draftEditor = useRef<YamlTextareaHandle>(null);
  const finalEditor = useRef<YamlTextareaHandle>(null);
  const defaultsBox = useRef<HTMLDivElement>(null);
  const overridesBox = useRef<HTMLDivElement>(null);
  const loadedKeys = useMemo(() => loaded && { defaults: keyLines(loaded.values.defaults), overrides: keyLines(loaded.values.overrides) }, [loaded]);
  // The search runs over whichever text is on screen.
  const view: { keys: KeyLine[]; jump: (line: number) => void } = !loaded || !loadedKeys
    ? { keys: draftRead.keys, jump: (line) => draftEditor.current?.jumpTo(line) }
    : tab === "defaults"
      ? { keys: loadedKeys.defaults, jump: (line) => jumpInBlock(defaultsBox.current, line) }
      : tab === "overrides"
        ? { keys: loadedKeys.overrides, jump: (line) => jumpInBlock(overridesBox.current, line) }
        : { keys: finalRead.keys, jump: (line) => finalEditor.current?.jumpTo(line) };
  const edit = useMemo(
    () => loaded && (finalRead.values ? overrideEdit(loaded.base, loaded.edits, finalRead.values) : { error: finalRead.error ?? "" }),
    [loaded, finalRead],
  );
  const blocked = !edit || "error" in edit;
  // Saving reads the text as it is now, not the settled read behind it.
  const saveDraft = () => {
    if (!readYaml(draft).error) onSave(draft);
  };
  const finish = () => {
    const now = loaded && readYaml(final).values;
    if (!loaded || !now) return;
    const e = overrideEdit(loaded.base, loaded.edits, now);
    onSave(e.changes ? valuesYaml(e.edits) : draft);
  };
  const [size, setSize] = useState<Size>();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[85vh] max-h-[calc(100vh-2rem)] w-[min(92vw,80rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]"
        style={size && { width: size.w, height: size.h }}
      >
        <DialogHeader>
          <DialogTitle>{t("deploy.fields.edits")}</DialogTitle>
          <DialogDescription>
            {o(loaded ? "layersDescription" : "description")}
          </DialogDescription>
        </DialogHeader>
        <KeySearch keys={view.keys} onJump={view.jump} />

        {!loaded ? (
          <>
            <YamlTextarea ref={draftEditor} aria-label={t("deploy.fields.edits")} invalid={!!draftError} value={draft} onChange={setDraft} className="min-h-0 flex-1" />
            {(draftError || fetch.error) && (
              <Alert variant="destructive">
                <AlertDescription>{draftError ?? message(fetch.error)}</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            {/* One at a time, in merge order: what the chart ships, what this deploy sets over it, and the result to edit. */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 min-w-0 flex-1 gap-2">
              <TabsList>
                <TabsTrigger value="defaults">{o("chart")}</TabsTrigger>
                <TabsTrigger value="overrides">{o("swiss")}</TabsTrigger>
                <TabsTrigger value="final">{o("final")}</TabsTrigger>
              </TabsList>
              <TabsContent value="defaults" className={TAB}>
                <p className="text-xs text-muted-foreground">{o("chartHint")}</p>
                <div ref={defaultsBox} className={TAB}>
                  <ReadOnlyYaml language="yaml" lineNumbers value={loaded.values.defaults} downloadName="values.yaml" maxHeight="100%" className="min-h-0 flex-1" />
                </div>
              </TabsContent>
              <TabsContent value="overrides" className={TAB}>
                <p className="text-xs text-muted-foreground">{o("swissHint")}</p>
                <div ref={overridesBox} className={TAB}>
                  <ReadOnlyYaml language="yaml" lineNumbers value={loaded.values.overrides} downloadName="overrides.yaml" maxHeight="100%" className="min-h-0 flex-1" />
                </div>
              </TabsContent>
              <TabsContent value="final" className={TAB}>
                <p className="text-xs text-muted-foreground">{o("finalHint")}</p>
                <YamlTextarea ref={finalEditor} aria-label={o("final")} invalid={!!edit && "error" in edit} value={final} onChange={setFinal} className="min-h-0 flex-1" />
              </TabsContent>
            </Tabs>
            {edit && "error" in edit ? (
              <Alert variant="destructive">
                <AlertDescription>{edit.error}</AlertDescription>
              </Alert>
            ) : edit && (
              <p className="text-xs text-muted-foreground">{o("changes", { n: edit.changes })}</p>
            )}
          </>
        )}

        <DialogFooter>
          {!loaded ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("common:actions.cancel")}
              </Button>
              {load && (
                <Button variant="outline" onClick={() => fetch.mutate()} disabled={!!draftError || fetch.isPending}>
                  {fetch.isPending ? o("loading") : o("load")}
                </Button>
              )}
              <Button onClick={saveDraft} disabled={!!draftError}>
                {t("common:actions.save")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setLoaded(undefined)}>
                {o("back")}
              </Button>
              <Button variant="outline" onClick={onClose}>
                {t("common:actions.cancel")}
              </Button>
              <Button onClick={finish} disabled={blocked}>
                {o("finish")}
              </Button>
            </>
          )}
        </DialogFooter>
        <ResizeHandle onResize={setSize} />
      </DialogContent>
    </Dialog>
  );
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

type Tab = "defaults" | "overrides" | "final";

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
