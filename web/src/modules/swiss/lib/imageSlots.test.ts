import { describe, expect, it } from "vitest";
import { EMPTY, formFromPlan, planRequest } from "@swiss/components/DeploySettings";
import type { Plan } from "@swiss/lib/api";
import {
  applyImageEdits,
  discoverImageSlots,
  dropClearedImages,
  dropImage,
  imageEditsFromLayer,
  joinImage,
  mergedHelmValues,
  provenanceLayers,
  splitImage,
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

  it("lists map and string slots, hides disabled sections, and skips metricsMock", () => {
    const slots = discoverImageSlots(values);
    expect(slots.map((s) => [s.path, s.kind, s.value])).toEqual([
      ["image", "map", "quay.io/ascend/vllm-ascend:pinned@sha256:abc"],
      ["hangWatcher.image", "map", "example.com/hang-watcher:0.1.27"],
      ["sidecar.image", "string", "example.com/echo:1"],
      ["other.image", "map", "example.com/other:9"],
    ]);
  });

  it("hides a slot under a disabled ancestor even when a nearer map is enabled", () => {
    const slots = discoverImageSlots({
      pd: { enabled: false, prefill: { enabled: true, image: { repository: "example.com/engine", tag: "1" } } },
    });
    expect(slots).toEqual([]);
  });

  it("names the last layer that set the slot, and the chart when none did", () => {
    const layers = {
      catalog: { image: { repository: "quay.io/ascend/vllm-ascend", tag: "pinned@sha256:abc" } },
      site: { image: { repository: "mirror.example/vllm-ascend" } },
      form: { hangWatcher: { image: { repository: "example.com/custom", tag: "9" } } },
    };
    const merged = {
      ...values,
      image: { repository: "mirror.example/vllm-ascend", tag: "pinned@sha256:abc" },
      hangWatcher: { enabled: true, image: { repository: "example.com/custom", tag: "9" } },
    };
    const byPath = Object.fromEntries(discoverImageSlots(merged, layers).map((s) => [s.path, s.layer]));
    expect(byPath.image).toBe("site");
    expect(byPath["hangWatcher.image"]).toBe("form");
    expect(byPath["sidecar.image"]).toBe("chart");
    expect(byPath["other.image"]).toBe("chart");
  });

  it("lets an edit layer win over the form", () => {
    const slots = discoverImageSlots(
      { image: { repository: "example.com/edited", tag: "1" } },
      { form: { image: { repository: "example.com/form", tag: "1" } }, edit: { image: { repository: "example.com/edited" } } },
    );
    expect(slots[0]?.layer).toBe("edit");
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

describe("provenanceLayers", () => {
  it("builds catalog and site from the variant when no plan layers exist", () => {
    const layers = provenanceLayers({
      variantValues: { hangWatcher: { image: { repository: "example.com/hang", tag: "1" } } },
      variantImage: { repository: "lmsysorg/sglang", tag: "v0.5.4" },
      mirroredRepository: "mirror.example/sglang",
      formLayer: { image: { repository: "example.com/mine", tag: "rc1" } },
    });
    const slots = discoverImageSlots(
      {
        image: { repository: "example.com/mine", tag: "rc1" },
        hangWatcher: { enabled: true, image: { repository: "example.com/hang", tag: "1" } },
      },
      layers,
    );
    expect(Object.fromEntries(slots.map((s) => [s.path, s.layer]))).toEqual({
      image: "form",
      "hangWatcher.image": "catalog",
    });
  });

  it("prefers a composed plan's layers, then the form and edit this page would send", () => {
    const layers = provenanceLayers({
      planLayers: { catalog: { image: { repository: "old", tag: "1" } }, site: { image: { repository: "mirror/old" } } },
      variantImage: { repository: "ignored", tag: "ignored" },
      formLayer: { replicaCount: 1 },
      edits: "image:\n  tag: from-edit\n",
    });
    expect(layers.catalog).toEqual({ image: { repository: "old", tag: "1" } });
    expect(layers.site).toEqual({ image: { repository: "mirror/old" } });
    expect(layers.form).toEqual({ replicaCount: 1 });
    expect(layers.edit).toEqual({ image: { tag: "from-edit" } });
  });
});

describe("image edits on the form layer", () => {
  it("writes a map slot as repository and tag, and a string slot as the string", () => {
    const overrides: Record<string, unknown> = {};
    applyImageEdits(
      overrides,
      { image: "quay.io/ascend/vllm-ascend:pinned@sha256:abc", images: { "sidecar.image": "example.com/echo:2" } },
      [{ path: "sidecar.image", kind: "string" }],
    );
    expect(overrides).toEqual({
      image: { repository: "quay.io/ascend/vllm-ascend", tag: "pinned@sha256:abc" },
      sidecar: { image: "example.com/echo:2" },
    });
    expect(planRequest({ ...EMPTY, image: "host:5000/repo:tag" }, { model: "m" }).overrides?.image).toEqual({
      repository: "host:5000/repo",
      tag: "tag",
    });
  });

  it("seeds upgrades from the form layer and drops a cleared override without touching other keys", () => {
    const layer = {
      image: { repository: "example.com/engine", tag: "custom", pullPolicy: "Always" },
      extraArgs: ["--x"],
      hangWatcher: { image: { repository: "example.com/hang", tag: "1" } },
      sidecar: { image: "example.com/echo:1" },
    };
    const form = formFromPlan(plan(layer));
    expect(form.image).toBe("example.com/engine:custom");
    expect(form.images).toEqual({ "hangWatcher.image": "example.com/hang:1", "sidecar.image": "example.com/echo:1" });
    expect(imageEditsFromLayer(layer).image).toBe("example.com/engine:custom");

    const kept = planRequest(form, { model: "m", formLayer: layer, imageSlots: [{ path: "sidecar.image", kind: "string" }] }).overrides!;
    expect(kept.image).toEqual({ repository: "example.com/engine", tag: "custom", pullPolicy: "Always" });
    expect(kept.hangWatcher).toEqual({ image: { repository: "example.com/hang", tag: "1" } });
    expect(kept.sidecar).toEqual({ image: "example.com/echo:1" });
    expect(kept.extraArgs).toEqual(["--x"]);

    const cleared = planRequest(
      { ...form, image: "", images: { ...form.images, image: "", "hangWatcher.image": "", "sidecar.image": "" } },
      { model: "m", formLayer: layer, imageSlots: [{ path: "sidecar.image", kind: "string" }] },
    ).overrides!;
    expect(cleared.image).toEqual({ pullPolicy: "Always" });
    expect(cleared).not.toHaveProperty("hangWatcher");
    expect(cleared).not.toHaveProperty("sidecar");
    expect(cleared.extraArgs).toEqual(["--x"]);
  });

  it("leaves a form-layer image in place when the field was never cleared", () => {
    const layer = { image: { repository: "example.com/engine", tag: "custom" }, note: true };
    const base = structuredClone(layer);
    dropClearedImages(base, "", {});
    expect(base).toEqual(layer);
    dropImage(base, "image");
    expect(base).toEqual({ note: true });
  });
});
