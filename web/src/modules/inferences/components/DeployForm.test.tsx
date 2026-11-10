import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployForm } from "./DeployForm";
import { EMPTY, planRequest, type Form } from "@swiss/components/DeploySettings";
import type { CacheCard } from "@swiss/lib/cache";
import type { InputRow } from "@swiss/lib/inputs";
import type { RouteOptions } from "@/modules/inferences/routeOptions";
import en from "@/modules/inferences/locales/en-US.json";
import zh from "@/modules/inferences/locales/zh-CN.json";

const catalog: RouteOptions = {
  route: "model",
  directives: [],
  advanced: [{ key: "rt_limit_factor", label: "Runtime limit factor", group: "Capacity & failover", kind: "number", fallback: "7.25", detail: "Scales the pool limit.", needsAdaptive: false, value: 9, set: true }],
};

function render(routeOptions?: RouteOptions | null, upgrade = false, form: Form = { ...EMPTY, serviceId: "model", nginxExtras: [{ key: "rt_limit_factor", value: "" }] }, catalogRoute?: string) {
  const props = {
    form, upgrade,
    onChange: () => {}, submitted: false, target: null, defaults: {}, gpuOptions: [],
    expanded: { basic: false, resources: false, routing: true, advanced: false },
    onExpand: () => {}, idPrefix: "test-", routeOptions, catalogRoute,
  };
  return renderToStaticMarkup(<DeployForm {...props} />);
}

describe("deploy route catalog", () => {
  it("shows the running engine's default instead of the bundled default", () => {
    expect(render(catalog).includes('placeholder="7.25"')).toBe(true);
  });

  it("shows bundled controls only for an explicit legacy catalog result", () => {
    const form = { ...EMPTY, serviceId: "model" };
    expect(render(undefined, false, form).includes("adaptive_cc_init")).toBe(false);
    expect(render(null, false, form).includes("adaptive_cc_init")).toBe(true);
  });

  it.each([undefined, null])("preserves arbitrary rows and named overrides when catalog data is %s", (options) => {
    const form = { ...EMPTY, serviceId: "model", adaptiveCc: true, adaptiveCcMinFrac: "0.73", tpsLimitTps: "97", ttftLimitMs: "123", nginxExtras: [{ key: "future_knob", value: "keep-me" }, { key: "rt_limit_factor", value: "2" }] };
    const before = planRequest(form, { model: "model" });
    const html = render(options, true, form);
    for (const value of ["keep-me", "2", "0.73"]) expect(html).toContain(`value="${value}"`);
    for (const value of ["97", "123"]) expect(html).not.toContain(`value="${value}"`);
    expect(html).toContain("future_knob");
    expect(planRequest(form, { model: "model" })).toEqual(before);
  });

  it("does not show stale bundled defaults without a live catalog", () => {
    expect(render(null).includes('placeholder="1"')).toBe(false);
    expect(render(null).includes("0.4")).toBe(false);
  });

  it("does not show another route's runtime values on a new deployment or an unmatched upgrade", () => {
    expect(render(catalog).includes("当前：9")).toBe(false);
    expect(render({ ...catalog, route: "another" }, true).includes("当前：9")).toBe(false);
    expect(render(catalog, true).includes("当前：9")).toBe(true);
    expect(render(catalog, true).includes("路由配置")).toBe(true);
  });

  it("shows runtime state for a release fallback when the old plan has no explicit route identity", () => {
    const legacyForm = { ...EMPTY, nginxExtras: [{ key: "rt_limit_factor", value: "" }] };
    expect(render(catalog, true, legacyForm, "model").includes("当前：9")).toBe(true);
    expect(render(catalog, true, legacyForm, "another").includes("当前：9")).toBe(false);
    expect(render(catalog, false, legacyForm, "model").includes("当前：9")).toBe(false);
  });

  it("renders new engine directives without a console release and leaves advanced defaults out of the default view", () => {
    const live: RouteOptions = { ...catalog, directives: [{ key: "future_knob", label: "New engine knob", group: "New engine group", kind: "text", fallback: "dynamic default", detail: "New engine help", value: "current", set: false }] };
    const html = render(live);
    expect(html.includes("New engine knob")).toBe(true);
    expect(html.includes("New engine help")).toBe(true);
    expect(html.includes('placeholder="dynamic default"')).toBe(true);
    expect(html.includes("New engine group")).toBe(true);
    const emptyForm = { ...EMPTY, serviceId: "model" };
    expect(render(live, false, emptyForm).includes('placeholder="7.25"')).toBe(false);
  });

  it("uses host defaults for named fields and does not mutate stored overrides when showing runtime state", () => {
    const form = { ...EMPTY, serviceId: "model", route: "model", nginxExtras: [{ key: "rt_limit_factor", value: "2" }] };
    const before = planRequest(form, { model: "model" });
    const live: RouteOptions = { ...catalog, directives: [
      { key: "expose_routed_peer", label: "Expose routed peer", group: "Observability", kind: "boolean", fallback: "", detail: "Engine peer help", value: true, set: true },
      { key: "adaptive_cc_min_frac", label: "Floor fraction", group: "Adaptive concurrency", kind: "number", fallback: "0.61", detail: "Engine fraction help", value: 0.61, set: false },
    ] };
    const html = render(live, true, form);
    expect(html.includes('placeholder="0.61"')).toBe(true);
    expect(html.includes('value="2"')).toBe(true);
    expect(html.includes("当前：on")).toBe(true);
    expect(html.includes("引擎默认值或派生值")).toBe(true);
    expect(planRequest(form, { model: "model" })).toEqual(before);
  });
});

describe("compile cache card", () => {
  const defaults = { hostPath: "/mnt/disk0/sglang-cache", historyLimit: 2, maxSlotsPerNode: 4 };
  const renderAdvanced = (cache?: CacheCard, form: Form = { ...EMPTY, serviceId: "model" }) =>
    renderToStaticMarkup(
      <DeployForm
        form={form} onChange={() => {}} submitted={false} target={null} defaults={{ cache }} gpuOptions={[]}
        expanded={{ basic: false, resources: false, routing: false, advanced: true }}
        onExpand={() => {}} idPrefix="test-"
      />,
    );

  it("greys out for a chart that cannot take it, and says why", () => {
    const on = { ...EMPTY, serviceId: "model", cache: true };
    const none = renderAdvanced({ defaults, siteOn: false, unsupported: { chart: "vllm" } }, on);
    expect(none).toContain("编译缓存");
    expect(none).toContain("vllm chart 不支持");
    expect(none).not.toContain('placeholder="/mnt/disk0/sglang-cache"');
    expect(none).not.toContain("站点默认开启缓存");
    expect(renderAdvanced({ defaults, siteOn: false, unsupported: { chart: "sglang", since: "0.9.1" } })).toContain("sglang chart 0.9.1 以下不支持");
  });

  it("stays editable with the site's cache on, where nothing denies it", () => {
    const switchOf = (html: string) => /<span[^>]*role="switch"[^>]*aria-label="编译缓存"[^>]*>/.exec(html)?.[0] ?? "";
    const off = switchOf(renderAdvanced({ defaults, siteOn: true }, { ...EMPTY, serviceId: "model", cache: false }));
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('data-disabled=""');
    const on = renderAdvanced({ defaults, siteOn: true }, { ...EMPTY, serviceId: "model", cache: true });
    expect(switchOf(on)).toContain('aria-checked="true"');
    expect(on).toContain('placeholder="/mnt/disk0/sglang-cache"');
    expect(on).not.toContain("站点默认开启缓存");
  });

  it("offers what an empty field keeps, and flags a slot count the chart refuses", () => {
    const html = renderAdvanced({ defaults, siteOn: false }, { ...EMPTY, serviceId: "model", cache: true, cacheMaxSlots: "65" });
    expect(html).toContain('placeholder="/mnt/disk0/sglang-cache"');
    expect(html).toContain('placeholder="2"');
    expect(html).toContain("取值 1 到 64");
  });
});

describe("skip values schema switch", () => {
  it("sits in the advanced section and shows the form's value", () => {
    const render = (form: Form) =>
      renderToStaticMarkup(
        <DeployForm
          form={form} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]}
          expanded={{ basic: false, resources: false, routing: false, advanced: true }}
          onExpand={() => {}} idPrefix="test-"
        />,
      );
    const switchOf = (html: string) => /<span[^>]*role="switch"[^>]*aria-label="跳过 values schema 校验"[^>]*>/.exec(html)?.[0] ?? "";
    expect(switchOf(render({ ...EMPTY, serviceId: "model" }))).toContain('aria-checked="false"');
    expect(switchOf(render({ ...EMPTY, serviceId: "model", skipSchemaValidation: true }))).toContain('aria-checked="true"');
  });
});

describe("image override", () => {
  const image = { catalog: "docker.io/lmsysorg/sglang:v0.5.4", site: "mirror.example.com/lmsysorg/sglang:v0.5.4" };
  const render = (form: Form, img = image) =>
    renderToStaticMarkup(
      <DeployForm
        form={form} onChange={() => {}} submitted={false} target={null} defaults={{ image: img }} gpuOptions={[]}
        expanded={{ basic: false, resources: true, routing: false, advanced: false }}
        onExpand={() => {}} idPrefix="test-"
      />,
    );
  const pressed = (html: string, label: string) => new RegExp(`<button[^>]*aria-pressed="true"[^>]*>${label}<`).test(html);

  it("offers both the site's mirror and the catalog's own image, marking the one in the field", () => {
    const mirrored = render({ ...EMPTY, serviceId: "model", image: image.site });
    expect(mirrored).toContain("站点镜像仓库");
    expect(mirrored).toContain("目录原始镜像");
    expect(pressed(mirrored, "站点镜像仓库")).toBe(true);
    expect(pressed(render({ ...EMPTY, serviceId: "model", image: image.catalog }), "目录原始镜像")).toBe(true);
    const typed = render({ ...EMPTY, serviceId: "model", image: "ghcr.io/me/sglang:rc1" });
    expect(pressed(typed, "站点镜像仓库") || pressed(typed, "目录原始镜像")).toBe(false);
  });

  it("offers nothing to pick between without a mirror", () => {
    const html = render({ ...EMPTY, serviceId: "model", image: image.catalog }, { catalog: image.catalog, site: image.catalog });
    expect(html).not.toContain("目录原始镜像");
  });
});

describe("GPU products", () => {
  it("says a product the variant does not list deploys as forced", () => {
    const props = {
      form: { ...EMPTY, gpuProducts: ["NVIDIA-H20"] }, onChange: () => {}, submitted: false, target: null, defaults: {},
      gpuOptions: ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H20"], gpuListed: ["NVIDIA-H100-80GB-HBM3"],
      expanded: { basic: false, resources: true, routing: false, advanced: false }, onExpand: () => {}, idPrefix: "test-",
    };
    const notice = (html: string) => [en, zh].some((l) => html.includes(l.deploy.fields.gpuForced.replace("{products}", "NVIDIA-H20")));
    expect(notice(renderToStaticMarkup(<DeployForm {...props} />))).toBe(true);
    expect(notice(renderToStaticMarkup(<DeployForm {...props} form={{ ...EMPTY, gpuProducts: ["NVIDIA-H100-80GB-HBM3"] }} />))).toBe(false);
  });
});

describe("GPU resource", () => {
  const props = {
    form: EMPTY, onChange: () => {}, submitted: false, target: null, defaults: {}, gpuOptions: [],
    expanded: { basic: false, resources: true, routing: false, advanced: false }, onExpand: () => {}, idPrefix: "test-",
  };
  it("is a choice, auto first, where the vendor has several", () => {
    const html = renderToStaticMarkup(<DeployForm {...props} gpuResources={["huawei.com/Ascend910", "volcano.sh/Ascend910B4-1"]} />);
    expect([en, zh].some((l) => html.includes(l.deploy.fields.gpuResourceAuto.replace("{resource}", "huawei.com/Ascend910")))).toBe(true);
  });
  it("is read-only where it has one, and absent without GPUs", () => {
    expect(renderToStaticMarkup(<DeployForm {...props} gpuResources={["huawei.com/Ascend910"]} />)).toMatch(/value="huawei.com\/Ascend910"[^>]*readOnly|readOnly[^>]*value="huawei.com\/Ascend910"/i);
    expect(renderToStaticMarkup(<DeployForm {...props} />)).not.toContain("huawei.com/Ascend910");
  });
});

describe("GPU capacity", () => {
  const props = {
    form: EMPTY, onChange: () => {}, submitted: false, target: null, defaults: {}, gpuOptions: [],
    expanded: { basic: false, resources: true, routing: false, advanced: false }, onExpand: () => {}, idPrefix: "test-",
  };
  const hint = { perPod: 8, needNodes: 1, refreshing: false, onRefresh: () => {} };
  const has = (html: string, key: "gpuCapacityNone" | "gpuCapacityUsageUnknown") => [en, zh].some((l) => html.includes(l.deploy.fields[key]));
  it("says when no node has the resource and product", () => {
    expect(has(renderToStaticMarkup(<DeployForm {...props} capacity={{ ...hint, value: { nodes: 0, gpus: 0, free: { gpus: 0, nodes: 0 } } }} />), "gpuCapacityNone")).toBe(true);
  });
  it("counts nodes and GPUs, and says when free is unknown", () => {
    const html = renderToStaticMarkup(<DeployForm {...props} capacity={{ ...hint, value: { nodes: 3, gpus: 24 } }} />);
    expect(has(html, "gpuCapacityNone")).toBe(false);
    expect(has(html, "gpuCapacityUsageUnknown")).toBe(true);
    expect(html).toContain("24");
  });
});

describe("variant inputs", () => {
  const master = { key: "storageKVOffload.mooncake.master", title: "Mooncake master", description: "host:port of the master", pattern: "[^\\s:/]+:[0-9]+", example: "mooncake-master.example:50051" };
  const render = (form: Form, inputs: InputRow[]) =>
    renderToStaticMarkup(
      <DeployForm
        form={form} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} inputs={inputs}
        expanded={{ basic: false, resources: true, routing: false, advanced: false }}
        onExpand={() => {}} idPrefix="test-"
      />,
    );
  it("renders each input as its variant declares it", () => {
    const html = render({ ...EMPTY, serviceId: "model" }, [{ input: master }]);
    expect(html).toContain("Mooncake master");
    expect([en, zh].some((l) => html.includes(l.deploy.fields.inputExample.replace("{example}", master.example)))).toBe(true);
    expect(html).not.toContain(`placeholder="${master.example}"`);
    expect(html).not.toMatch(/placeholder="[^"]*mooncake-master\.example/);
    expect([en, zh].some((l) => html.includes(l.deploy.fields.inputRequired))).toBe(true);
    expect(html).toContain('aria-invalid="true"');
  });
  it("shows the answer that applies when the field is left empty", () => {
    const html = render({ ...EMPTY, serviceId: "model" }, [{ input: master, answer: "site.svc:50051", from: "site" }]);
    expect(html).toContain('placeholder="site.svc:50051"');
    expect(html).not.toContain('aria-invalid="true"');
  });
  it("says when a typed answer does not match the pattern", () => {
    const html = render({ ...EMPTY, serviceId: "model", inputs: { [master.key]: "no-port" } }, [{ input: master }]);
    expect(html).toContain('value="no-port"');
    expect([en, zh].some((l) => html.includes(l.deploy.fields.inputProblem.string.replace(" {pattern}", "")))).toBe(true);
  });
  it("offers a pick between the answers when more than one is found, the applying one shown", () => {
    const choices = [{ answer: "site.svc:50051", from: "site" as const }, { answer: "tuned.svc:50051", from: "variant" as const }];
    const html = render({ ...EMPTY, serviceId: "model" }, [{ input: master, answer: "site.svc:50051", from: "site", choices }]);
    const single = render({ ...EMPTY, serviceId: "model" }, [{ input: master, answer: "site.svc:50051", from: "site" }]);
    // The list opens on a click; closed, the field is the plain one.
    expect(html).not.toContain('role="listbox"');
    expect(html).toBe(single);
    expect(html).toContain('placeholder="site.svc:50051"');
  });
  it("offers to save a typed answer to the site profile, naming the one it replaces", () => {
    const row: InputRow = { input: master, answer: "mc-m.svc:50051", from: "site", site: { answer: "mc-m.svc:50051", written: "mc-{{model}}.svc:50051" } };
    const remember = (form: Form, on?: Record<string, boolean>) =>
      renderToStaticMarkup(
        <DeployForm
          form={form} onChange={() => {}} submitted={false} target={null} defaults={{}} gpuOptions={[]} inputs={[row]} remember={on} onRemember={() => {}}
          expanded={{ basic: false, resources: true, routing: false, advanced: false }}
          onExpand={() => {}} idPrefix="test-"
        />,
      );
    const offers = (h: string) => [en, zh].some((l) => h.includes(l.deploy.fields.inputRemember));
    const typed = remember({ ...EMPTY, serviceId: "model", inputs: { [master.key]: "mine.svc:50051" } }, {});
    expect(offers(typed)).toBe(true);
    expect(typed).toContain("mc-{{model}}.svc:50051");
    expect(offers(remember({ ...EMPTY, serviceId: "model", inputs: { [master.key]: "mc-m.svc:50051" } }, {}))).toBe(false);
    expect(offers(remember({ ...EMPTY, serviceId: "model", inputs: { [master.key]: "no-port" } }, {}))).toBe(false);
    expect(offers(remember({ ...EMPTY, serviceId: "model" }, {}))).toBe(false);
    expect(offers(remember({ ...EMPTY, serviceId: "model", inputs: { [master.key]: "mine.svc:50051" } }))).toBe(false);
  });
  it("sends a typed answer at the input's key", () => {
    const form = { ...EMPTY, serviceId: "model", inputs: { [master.key]: "mine.svc:50051" } };
    expect(planRequest(form, { model: "model", inputs: [master] }).overrides).toMatchObject({ storageKVOffload: { mooncake: { master: "mine.svc:50051" } } });
  });
});
