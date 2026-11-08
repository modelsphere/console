import { useRef, type ReactNode } from "react";
import { CodeBlock, Spinner } from "@modelsphere/ui";
import { useT } from "../i18n";
import type { HelmValuesSource } from "../use-deployment-values";
import { KeySearch } from "./KeySearch";
import { YamlTextarea, type YamlTextareaHandle } from "./YamlTextarea";
import { readYaml } from "../override-yaml";

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border"><h3 className="border-b bg-muted/30 px-3 py-2 text-xs font-medium">{title}</h3><div className="flex min-h-0 flex-1 flex-col">{children}</div></section>;
}

function ReadOnlyValues({ value, loading, unavailable, label }: { value?: string; loading?: boolean; unavailable: string; label: string }) {
  return value !== undefined
    ? <div aria-label={label} className="flex min-h-0 flex-1 flex-col"><CodeBlock value={value} language="yaml" lineNumbers maxHeight="100%" className="min-h-0 flex-1" /></div>
    : <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground" role="status">{loading ? <Spinner size="sm" /> : unavailable}</div>;
}

export function ConfigurationPanes({ value, onChange, source }: { value: string; onChange: (value: string) => void; source?: HelmValuesSource }) {
  const t = useT();
  const read = readYaml(value);
  const editor = useRef<YamlTextareaHandle>(null);
  const validSource = !read.error ? source?.data : undefined;
  const unavailable = t("deploy.draft.unavailable");
  return (
    <>
      <KeySearch keys={read.keys} onJump={(line) => editor.current?.jumpTo(line)} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto lg:grid-cols-3 lg:overflow-hidden">
        <Pane title={t("deploy.draft.baseline")}><ReadOnlyValues value={source?.data?.baseline} loading={source?.loading} unavailable={unavailable} label={t("deploy.draft.baseline")} /></Pane>
        <Pane title={t("deploy.draft.user")}><YamlTextarea ref={editor} aria-label={t("deploy.draft.user")} value={value} onChange={onChange} invalid={!!read.error} className="min-h-48 flex-1 p-3" /></Pane>
        <Pane title={t("deploy.draft.effective")}><ReadOnlyValues value={validSource?.effective} loading={source?.loading && !read.error} unavailable={unavailable} label={t("deploy.draft.effective")} /></Pane>
      </div>
    </>
  );
}
