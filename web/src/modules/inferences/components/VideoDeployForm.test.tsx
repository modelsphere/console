import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployForm } from "./DeployForm";
import { VideoDeployForm } from "./VideoDeployForm";
import { EMPTY } from "@swiss/components/DeploySettings";
import { VIDEO_EMPTY, type VideoForm } from "@swiss/lib/video";
import { formKind } from "@/modules/inferences/deploy-lib";
import zh from "@/modules/inferences/locales/zh-CN.json";

const expanded = { basic: true, resources: true, routing: true, advanced: true };

function video(form: Partial<VideoForm> = {}) {
  return renderToStaticMarkup(
    <VideoDeployForm
      form={{ ...VIDEO_EMPTY, serviceId: "h3", ...form }}
      onChange={() => {}}
      submitted={false}
      target={null}
      gpuOptions={[]}
      expanded={expanded}
      onExpand={() => {}}
      idPrefix="t-"
    />,
  );
}

function llm() {
  return renderToStaticMarkup(
    <DeployForm form={{ ...EMPTY, serviceId: "m" }} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} expanded={expanded} onExpand={() => {}} idPrefix="t-" />,
  );
}

describe("formKind", () => {
  it("routes a video variant, or a video release on upgrade, to the video form", () => {
    expect(formKind(false, undefined, "video")).toBe("video");
    expect(formKind(true, "video", "sglang")).toBe("video");
    expect(formKind(false, undefined, "sglang")).toBe("llm");
    expect(formKind(false, "video", "vllm")).toBe("llm");
    expect(formKind(true, "sglang", "video")).toBe("llm");
    expect(formKind(false, undefined, undefined)).toBe("llm");
  });
});

describe("VideoDeployForm", () => {
  const v = zh.deploy.video;
  const f = zh.deploy.fields;

  it("shows the pools, storage, database and autoscaling, and none of the LLM settings", () => {
    const html = video({ autoscale: true });
    for (const want of [v.pools.fl2va.title, v.pools.ref2va.title, v.turbo, v.storageClass, v.database, v.autoscale, "共 8 张 GPU", "每个 Pod 4 张 GPU"]) {
      expect(html).toContain(want);
    }
    for (const llmOnly of [f.cart, f.slo, f.cache, f.localPath, f.exposeRoutedPeer, f.adaptiveCc]) expect(html).not.toContain(llmOnly);
    expect(html).toContain('type="password"');
  });

  it("has one autoscale switch and no per-pool SLO fields: those are the SLO sheet's", () => {
    const html = video({ autoscale: true });
    expect(html.split(v.autoscale).length - 1).toBeGreaterThan(0);
    for (const none of ["最大副本数", "最大队列深度"]) expect(html).not.toContain(none);
  });

  it("leaves the LLM form as it was", () => {
    const html = llm();
    for (const want of [f.cart, f.slo]) expect(html).toContain(want);
    expect(html).not.toContain('data-testid="video-deploy-form"');
  });
});
