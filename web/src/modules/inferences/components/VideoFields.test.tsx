import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployForm } from "./DeployForm";
import { EMPTY, type Form } from "@swiss/components/DeploySettings";
import type { InputRow } from "@swiss/lib/inputs";
import { formKind } from "@/modules/inferences/deploy-lib";
import zh from "@/modules/inferences/locales/zh-CN.json";

const expanded = { basic: true, resources: true, routing: true, advanced: true };

function render(opts: { video?: boolean; upgrade?: boolean; form?: Partial<Form>; inputs?: InputRow[] } = {}) {
  return renderToStaticMarkup(
    <DeployForm
      form={{ ...EMPTY, serviceId: "h3", ...opts.form }}
      onChange={() => {}}
      upgrade={opts.upgrade}
      submitted={false}
      target={null}
      defaults={{ localPathTemplate: "/mnt/models/{{org}}/{{name}}" }}
      gpuOptions={[]}
      expanded={expanded}
      onExpand={() => {}}
      idPrefix="t-"
      inputs={opts.inputs}
      video={opts.video}
    />,
  );
}

const classInput: InputRow = { input: { key: "sharedStorage.storageClass", title: "Shared asset volume storage class", example: "ceph-filesystem" }, answer: "ceph-filesystem" } as InputRow;

describe("formKind", () => {
  it("names a video variant, or a video release on upgrade, as video", () => {
    expect(formKind(false, undefined, "video")).toBe("video");
    expect(formKind(true, "video", "sglang")).toBe("video");
    expect(formKind(false, undefined, "sglang")).toBe("llm");
    expect(formKind(false, "video", "vllm")).toBe("llm");
    expect(formKind(true, "sglang", "video")).toBe("llm");
    expect(formKind(false, undefined, undefined)).toBe("llm");
  });
});

describe("DeployForm for a video variant", () => {
  const v = zh.deploy.video;
  const f = zh.deploy.fields;

  it("is the LLM form plus the video chart's own fields", () => {
    const html = render({ video: true });
    // The video chart's own.
    for (const want of [v.pools.fl2va.title, v.pools.ref2va.title, v.turbo, v.storageClass, v.storageSize, v.database, "共 8 张 GPU", "每个 Pod 4 张 GPU"]) {
      expect(html).toContain(want);
    }
    // The LLM form's, unchanged: the same rows an LLM deploy shows.
    for (const shared of [f.serviceId, f.modelRoute, f.namespace, f.slo, f.gpuProducts, f.priorityClass, f.scheduler, f.localPath, f.skipSchemaValidation]) {
      expect(html).toContain(shared);
    }
    // What only an LLM chart takes.
    for (const llmOnly of [f.cart, f.exposeRoutedPeer, f.adaptiveCc, f.serviceMonitor, f.backendMaxConcurrency]) expect(html).not.toContain(llmOnly);
    expect(html).toContain('type="password"');
  });

  it("leaves the storage class to the input when the variant declares one", () => {
    const html = render({ video: true, inputs: [classInput] });
    expect(html).toContain(classInput.input.title);
    expect(html).not.toContain(`>${v.storageClass}<`);
  });

  it("on an upgrade, locks the storage class and says what the release has now", () => {
    const html = render({ video: true, upgrade: true, form: { video: { ...EMPTY.video, storageSize: "", databaseKept: true, current: { storageSize: "1Ti", storageClass: "ceph-filesystem" } } } });
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    const placeholder = (p: string) => inputs.filter((i) => i.includes(`placeholder="${p}"`));
    // The class is the release's, and cannot change.
    expect(placeholder("ceph-filesystem").filter((i) => /\sdisabled=""/.test(i))).toHaveLength(1);
    // The size and the database name what an empty field keeps.
    expect(placeholder(v.storageSizeCurrent.replace("{size}", "1Ti"))).toHaveLength(1);
    expect(placeholder(v.databaseKept)).toHaveLength(1);
    expect(html).not.toContain('placeholder="保留"');
  });

  it("leaves the LLM form as it was", () => {
    const html = render();
    for (const want of [f.cart, f.slo, f.exposeRoutedPeer]) expect(html).toContain(want);
    expect(html).not.toContain('data-testid="video-pools"');
  });
});
