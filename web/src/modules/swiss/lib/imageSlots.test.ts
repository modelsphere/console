import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { EMPTY, formFromPlan, planRequest } from "@swiss/components/DeploySettings";
import type { Plan } from "@swiss/lib/api";
import {
  applyImageEdits,
  discoverImageSlots,
  dropClearedImages,
  helmImageSlots,
  imageEditsFromLayer,
  imagePatch,
  imageRows,
  imageText,
  joinImage,
  mergedHelmValues,
  mirrorImage,
  slotImageChoices,
  splitImage,
  withImageEdits,
  type ImageEdit,
} from "./imageSlots";

const plan = (form: Record<string, unknown>) => ({ release: { name: "r", namespace: "n" }, layers: { form } }) as unknown as Plan;

describe("splitImage", () => {
  it("keeps a digest on the tag and a registry port on the repository", () => {
    expect(splitImage("repo:pinned@sha256:abc")).toEqual({ repository: "repo", tag: "pinned@sha256:abc" });
    expect(splitImage("quay.io/ascend/vllm-ascend:pinned@sha256:abc")).toEqual({
      repository: "quay.io/ascend/vllm-ascend",
      tag: "pinned@sha256:abc",
    });
    expect(splitImage("host:5000/repo:tag")).toEqual({ repository: "host:5000/repo", tag: "tag" });
    expect(splitImage("host:5000/repo")).toEqual({ repository: "host:5000/repo" });
    expect(splitImage("registry.example.com:5000/sglang")).toEqual({ repository: "registry.example.com:5000/sglang" });
    expect(splitImage("lmsysorg/sglang:v0.5.4")).toEqual({ repository: "lmsysorg/sglang", tag: "v0.5.4" });
    // A ref with a digest and no tag has nothing to put the digest on but the repository.
    expect(splitImage("example.com/repo@sha256:abc")).toEqual({ repository: "example.com/repo@sha256:abc" });
  });

  it("round-trips a tag that contains a digest", () => {
    const split = splitImage("quay.io/ascend/vllm-ascend:pinned@sha256:abc");
    expect(joinImage(split.repository, split.tag ?? "")).toBe("quay.io/ascend/vllm-ascend:pinned@sha256:abc");
  });
});

describe("discoverImageSlots", () => {
  const values = {
    image: { repository: "quay.io/ascend/vllm-ascend", tag: "pinned@sha256:abc", pullPolicy: "IfNotPresent" },
    hangWatcher: { enabled: true, image: { repository: "example.com/hang-watcher", tag: "0.1.27" } },
    sidecar: { image: "example.com/echo:1" },
    pd: { enabled: false, router: { imageOverride: { repository: "example.com/smg", tag: "1" } } },
    cart: { enabled: false, image: { repository: "example.com/cart", tag: "1" } },
    continuationGateway: { enabled: false, image: "example.com/gateway:1" },
    localKVOffload: {
      enabled: false,
      mooncakeStore: { master: { imageOverride: { repository: "example.com/vllm", tag: "t" } } },
    },
    metricsMock: { enabled: true, image: "example.com/http-echo:0.2.3" },
    other: { enabled: true, image: { repository: "example.com/other", tag: "9" } },
  };

  it("lists map and string slots and hides disabled sections", () => {
    const slots = discoverImageSlots(values);
    expect(slots.map((s) => [s.path, s.kind, s.value])).toEqual([
      ["image", "map", "quay.io/ascend/vllm-ascend:pinned@sha256:abc"],
      ["hangWatcher.image", "map", "example.com/hang-watcher:0.1.27"],
      ["sidecar.image", "string", "example.com/echo:1"],
      ["metricsMock.image", "string", "example.com/http-echo:0.2.3"],
      ["other.image", "map", "example.com/other:9"],
    ]);
  });

  it("hides a slot under a disabled ancestor even when a nearer map is enabled", () => {
    const slots = discoverImageSlots({
      pd: { enabled: false, prefill: { enabled: true, image: { repository: "example.com/engine", tag: "1" } } },
    });
    expect(slots).toEqual([]);
  });
});

describe("mergedHelmValues", () => {
  it("merges chart defaults with layer overrides and lets null delete", () => {
    const merged = mergedHelmValues({
      defaults: "image:\n  repository: chart/engine\n  tag: chart\nhangWatcher:\n  enabled: true\n  image:\n    repository: chart/hang\n    tag: \"1\"\n",
      overrides: "image:\n  repository: mirror/engine\n  tag: pinned@sha256:abc\nhangWatcher:\n  enabled: false\n",
    });
    expect(discoverImageSlots(merged).map((s) => s.path)).toEqual(["image"]);
    expect(discoverImageSlots(merged)[0]?.value).toBe("mirror/engine:pinned@sha256:abc");
  });
});

describe("imageRows", () => {
  it("shows the engine before a dry run, and a form-layer image the chart did not list", () => {
    expect(imageRows(undefined, { catalog: "cat/engine:1", site: "mirror/engine:1" }).map((s) => [s.path, s.value])).toEqual([
      ["image", "mirror/engine:1"],
    ]);
    const rows = imageRows(
      [{ path: "image", kind: "map", value: "chart/engine:1" }],
      undefined,
      { "sidecar.image": "example.com/echo:1", image: "", "gone.image": "" },
    );
    expect(rows.map((s) => [s.path, s.kind, s.value])).toEqual([
      ["image", "map", "chart/engine:1"],
      ["sidecar.image", "string", "example.com/echo:1"],
    ]);
  });
});

describe("image edits on dumped helm values", () => {
  it("merges them onto the overrides and leaves the chart defaults", () => {
    const values = {
      defaults: "image:\n  repository: chart/engine\n  tag: \"1\"\n",
      overrides: "image:\n  pullPolicy: Always\n",
    };
    const next = withImageEdits(values, { image: { repository: "mirror/engine", tag: "pinned@sha256:abc" }, "sidecar.image": "example.com/echo:2" });
    expect(next.defaults).toBe(values.defaults);
    expect(parse(next.overrides)).toEqual({
      image: { pullPolicy: "Always", repository: "mirror/engine", tag: "pinned@sha256:abc" },
      sidecar: { image: "example.com/echo:2" },
    });
    expect(withImageEdits(values, {})).toBe(values);
    expect(withImageEdits(values, { image: "" })).toBe(values);
  });
});

describe("image edits on the form layer", () => {
  it("writes a map slot as repository and tag, and a string slot as the string", () => {
    const overrides: Record<string, unknown> = {};
    applyImageEdits(overrides, imagePatch(imagePatch({}, "image", "map", "quay.io/ascend/vllm-ascend:pinned@sha256:abc"), "sidecar.image", "string", "example.com/echo:2"));
    expect(overrides).toEqual({
      image: { repository: "quay.io/ascend/vllm-ascend", tag: "pinned@sha256:abc" },
      sidecar: { image: "example.com/echo:2" },
    });
    expect(planRequest({ ...EMPTY, images: imagePatch({}, "image", "map", "host:5000/repo:tag") }, { model: "m" }).overrides?.image).toEqual({
      repository: "host:5000/repo",
      tag: "tag",
    });
    // A trailing colon is kept in the field and is not sent as its own key.
    const half = imagePatch({}, "image", "map", "repo:");
    expect(imageText(half.image)).toBe("repo:");
    const typed: Record<string, unknown> = {};
    applyImageEdits(typed, half);
    expect(typed).toEqual({ image: { repository: "repo" } });
  });

  it("seeds upgrades from the form layer and drops a cleared override without touching other keys", () => {
    const layer = {
      image: { repository: "example.com/engine", tag: "custom", pullPolicy: "Always" },
      extraArgs: ["--x"],
      hangWatcher: { image: { repository: "example.com/hang", tag: "1" } },
      sidecar: { image: "example.com/echo:1" },
    };
    const form = formFromPlan(plan(layer));
    expect(form.images).toEqual({
      image: { repository: "example.com/engine", tag: "custom" },
      "hangWatcher.image": { repository: "example.com/hang", tag: "1" },
      "sidecar.image": "example.com/echo:1",
    });
    expect(imageEditsFromLayer(layer).image).toEqual({ repository: "example.com/engine", tag: "custom" });

    const kept = planRequest(form, { model: "m", formLayer: layer }).overrides!;
    expect(kept.image).toEqual({ repository: "example.com/engine", tag: "custom", pullPolicy: "Always" });
    expect(kept.hangWatcher).toEqual({ image: { repository: "example.com/hang", tag: "1" } });
    expect(kept.sidecar).toEqual({ image: "example.com/echo:1" });
    expect(kept.extraArgs).toEqual(["--x"]);

    const blank = { image: "", "hangWatcher.image": "", "sidecar.image": "" };
    for (const images of [blank, {}]) {
      const cleared = planRequest({ ...form, images }, { model: "m", formLayer: layer }).overrides!;
      expect(cleared.image).toEqual({ pullPolicy: "Always" });
      expect(cleared.hangWatcher).toEqual({});
      expect(cleared.sidecar).toEqual({});
      expect(cleared.extraArgs).toEqual(["--x"]);
    }
  });

  it("drops a form-layer image the form left empty, and keeps one it still holds", () => {
    const layer = { image: { repository: "example.com/engine", tag: "custom", pullPolicy: "Always" }, note: true };
    const kept = structuredClone(layer);
    dropClearedImages(kept, imageEditsFromLayer(layer));
    expect(kept).toEqual(layer);
    const clearedBy: Record<string, ImageEdit>[] = [{}, { image: "" }];
    for (const images of clearedBy) {
      const cleared = structuredClone(layer);
      dropClearedImages(cleared, images);
      expect(cleared).toEqual({ image: { pullPolicy: "Always" }, note: true });
    }
  });
});

describe("mirrorImage and slotImageChoices", () => {
  it("mirrors every repository shape using the final path element and strips trailing mirror slashes", () => {
    expect(mirrorImage("ghcr.io/modelsphere/hang-watcher:0.1.27", "mirror.example.com/team/")).toBe(
      "mirror.example.com/team/hang-watcher:0.1.27",
    );
    expect(mirrorImage("quay.io/ascend/vllm-ascend:pinned@sha256:abc", "mirror.example.com/team")).toBe(
      "mirror.example.com/team/vllm-ascend:pinned@sha256:abc",
    );
    expect(mirrorImage("docker.io/curlimages/curl@sha256:abc", "registry.local:5000/mirror")).toBe(
      "registry.local:5000/mirror/curl@sha256:abc",
    );
    expect(mirrorImage("busybox:1.36", "mirror.example.com/team")).toBe("mirror.example.com/team/busybox:1.36");
    expect(mirrorImage("ghcr.io/org/app:1", "")).toBe("ghcr.io/org/app:1");
    expect(mirrorImage("", "mirror.example.com/team")).toBe("");
  });

  it("retains un-mirrored chart defaults on helmImageSlots when layers rewrite them", () => {
    const slots = helmImageSlots({
      defaults:
        "image:\n  repository: docker.io/lmsysorg/sglang\n  tag: v1\nhangWatcher:\n  image:\n    repository: ghcr.io/org/hang-watcher\n    tag: 0.1.0\nsidecar:\n  image: docker.io/curlimages/curl:8\n",
      overrides:
        "image:\n  repository: mirror.example.com/team/sglang\nhangWatcher:\n  image:\n    repository: mirror.example.com/team/hang-watcher\n",
    });
    expect(slots).toEqual([
      {
        path: "image",
        kind: "map",
        value: "mirror.example.com/team/sglang:v1",
        defaultValue: "docker.io/lmsysorg/sglang:v1",
      },
      {
        path: "hangWatcher.image",
        kind: "map",
        value: "mirror.example.com/team/hang-watcher:0.1.0",
        defaultValue: "ghcr.io/org/hang-watcher:0.1.0",
      },
      { path: "sidecar.image", kind: "string", value: "docker.io/curlimages/curl:8" },
    ]);
  });

  it("gives every slot site mirror and default/catalog choices when a mirror differs", () => {
    const engine = { catalog: "docker.io/lmsysorg/sglang:v1", site: "mirror.example.com/team/sglang:v1" };
    expect(slotImageChoices({ path: "image", kind: "map", value: engine.site }, engine, "mirror.example.com/team")).toEqual([
      { key: "site", ref: "mirror.example.com/team/sglang:v1" },
      { key: "catalog", ref: "docker.io/lmsysorg/sglang:v1" },
    ]);
    expect(slotImageChoices({ path: "hangWatcher.image", kind: "map", value: "ghcr.io/org/hang-watcher:0.1.0" }, engine, "mirror.example.com/team")).toEqual([
      { key: "site", ref: "mirror.example.com/team/hang-watcher:0.1.0" },
      { key: "default", ref: "ghcr.io/org/hang-watcher:0.1.0" },
    ]);
    expect(slotImageChoices({ path: "sidecar.image", kind: "string", value: "curl:8" }, engine, "mirror.example.com/team")).toEqual([
      { key: "site", ref: "mirror.example.com/team/curl:8" },
      { key: "default", ref: "curl:8" },
    ]);
    // Already-mirrored layer still pairs site mirror with un-mirrored chart default.
    expect(
      slotImageChoices(
        {
          path: "hangWatcher.image",
          kind: "map",
          value: "mirror.example.com/team/hang-watcher:0.1.0",
          defaultValue: "ghcr.io/org/hang-watcher:0.1.0",
        },
        engine,
        "mirror.example.com/team",
      ),
    ).toEqual([
      { key: "site", ref: "mirror.example.com/team/hang-watcher:0.1.0" },
      { key: "default", ref: "ghcr.io/org/hang-watcher:0.1.0" },
    ]);
    // Without a mirror, offers no duplicate choices.
    expect(slotImageChoices({ path: "hangWatcher.image", kind: "map", value: "ghcr.io/org/hang-watcher:0.1.0" }, undefined, "")).toEqual([]);
  });
});
