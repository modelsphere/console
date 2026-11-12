import { describe, expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
import { EMPTY, formFromPlan, planRequest, type Form } from "@swiss/components/DeploySettings";
import { affinityInvalid, affinityRules, editRule, setAffinity } from "./affinity";
import { editsWithEnv, envBase, mergeEnv, overlay, withEnv, withPreset } from "./formLayer";

const storageNet = { key: "ebof.modelsphere.io/storage-net", operator: "In", values: ["true"] };
const gpuTerm = { matchExpressions: [{ key: "nvidia.com/gpu.product", operator: "In", values: ["B300"] }] };
const plan = (form: Record<string, unknown>) => ({ release: { name: "r", namespace: "n" }, layers: { form } }) as unknown as Plan;
// What an upgrade of a release with this form layer sends, after edit.
const upgrade = (layer: Record<string, unknown>, edit: (f: Form) => Form = (f) => f) => planRequest(edit(formFromPlan(plan(layer))), { model: "m", formLayer: layer }).overrides!;

describe("withPreset", () => {
  it("keeps both sides' list items once, and the form's scalars", () => {
    const preset = { tolerations: [{ key: "ebof-test", operator: "Exists" }], nodeSelector: { a: "1" }, priorityClassName: "low" };
    const got = withPreset({ tolerations: [{ operator: "Exists", key: "ebof-test" }, { key: "gpu", operator: "Exists" }], nodeSelector: { b: "2" }, priorityClassName: "high" }, preset);
    expect(got).toEqual({
      tolerations: [{ key: "ebof-test", operator: "Exists" }, { key: "gpu", operator: "Exists" }],
      nodeSelector: { a: "1", b: "2" },
      priorityClassName: "high",
    });
    expect(preset.tolerations).toHaveLength(1);
  });

  it("is the form's values without a preset", () => {
    const o = { a: 1 };
    expect(withPreset(o, undefined)).toBe(o);
  });
});

describe("overlay", () => {
  it("puts the form's values over the layer, a list replacing", () => {
    const layer = { pd: { prefill: { x: 1 } }, tolerations: [{ key: "a" }], extraArgs: ["--a"] };
    expect(overlay(layer, { pd: { decode: { y: 2 } }, tolerations: [{ key: "b" }] })).toEqual({ pd: { prefill: { x: 1 }, decode: { y: 2 } }, tolerations: [{ key: "b" }], extraArgs: ["--a"] });
    expect(layer.tolerations).toEqual([{ key: "a" }]);
  });
});

describe("affinity rules", () => {
  const layer = {
    affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [gpuTerm] } } },
    pd: {
      prefill: { affinityReplace: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [storageNet] }] } } } },
      decode: {
        affinityReplace: {
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100, preference: { matchExpressions: [{ ...storageNet, operator: "NotIn" }] } }],
            requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [gpuTerm] },
          },
        },
      },
    },
  };
  const drop = (pick: (r: ReturnType<typeof affinityRules>[number]) => boolean) => affinityRules(layer).map((r) => (pick(r) ? { ...r, drop: true } : r));

  it("lists every rule, in order", () => {
    expect(affinityRules(layer).map((r) => r.scope)).toEqual(["affinity", "pd.prefill.affinityReplace", "pd.decode.affinityReplace", "pd.decode.affinityReplace"]);
  });

  it("writes each list back as it stands", () => {
    const o = {};
    setAffinity(o, affinityRules(layer), false);
    expect(o).toEqual(layer);
  });

  it("sends a role with no rule left as null, which the chart reads as inherit", () => {
    const o = {};
    setAffinity(o, drop((r) => r.scope === "pd.prefill.affinityReplace"), false);
    expect((o as typeof layer).pd.prefill).toEqual({ affinityReplace: null });
  });

  it("sends an emptied list as [], and emptied required terms as a null block", () => {
    const o = {};
    setAffinity(o, drop((r) => r.scope === "pd.decode.affinityReplace" && r.list.includes("required")), false);
    expect((o as typeof layer).pd.decode.affinityReplace.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution).toBeNull();
    const p = {};
    setAffinity(p, drop((r) => r.list.includes("preferred")), false);
    expect((p as typeof layer).pd.decode.affinityReplace.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution).toEqual([]);
  });

  it("sends emptied top-level required terms as [] when products are picked, for swissd to fill", () => {
    const o = {};
    setAffinity(o, drop((r) => r.scope === "affinity"), true);
    expect((o as typeof layer).affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms).toEqual([]);
  });

  it("edits a rule as YAML, keeping a string a string", () => {
    const [, prefill] = affinityRules(layer);
    const edited = editRule(prefill, prefill.text.replace("storage-net", "storage-nvme"));
    expect(edited.rule).toEqual({ matchExpressions: [{ ...storageNet, key: "ebof.modelsphere.io/storage-nvme" }] });
    expect(affinityInvalid([edited])).toBe(false);
    const broken = editRule(prefill, "matchExpressions: [");
    expect(broken.error).toBeTruthy();
    expect(broken.rule).toEqual(prefill.rule);
    expect(affinityInvalid([broken])).toBe(true);
    expect(affinityInvalid([{ ...broken, drop: true }])).toBe(false);
  });
});

describe("an upgrade rebuilds the form layer", () => {
  it("carries every key the form has no field for", () => {
    const got = upgrade({ extraArgs: ["--x"], pd: { prefill: { replicas: 2 } } });
    expect(got.extraArgs).toEqual(["--x"]);
    expect(got.pd).toEqual({ prefill: { replicas: 2 } });
  });

  it("sends an edited affinity rule in its list", () => {
    const layer = { pd: { prefill: { affinityReplace: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [storageNet] }, gpuTerm] } } } } } };
    const got = upgrade(layer, (f) => ({ ...f, affinity: f.affinity.map((r, i) => (i === 0 ? editRule(r, r.text.replace('"true"', '"yes"')) : r)) }));
    expect(got.pd).toEqual({ prefill: { affinityReplace: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ ...storageNet, values: ["yes"] }] }, gpuTerm] } } } } });
  });
});

describe("tolerations on an upgrade", () => {
  const deployed = [{ operator: "Exists" }, { key: "ebof-test", operator: "Exists", effect: "NoExecute", tolerationSeconds: 300 }, { key: "x", value: "y" }];

  it("sends each one back exactly as deployed", () => {
    const f = formFromPlan(plan({ tolerations: deployed }));
    expect(f.tolerations.map((t) => t.operator)).toEqual(["Exists", "Exists", "Equal"]);
    expect(upgrade({ tolerations: deployed }).tolerations).toEqual(deployed);
  });

  it("keeps the keys no field shows on an edited row", () => {
    const got = upgrade({ tolerations: deployed }, (f) => ({ ...f, tolerations: f.tolerations.map((t, i) => (i === 1 ? { ...t, effect: "NoSchedule" } : t)) }));
    expect((got.tolerations as unknown[])[1]).toEqual({ key: "ebof-test", operator: "Exists", effect: "NoSchedule", tolerationSeconds: 300 });
  });

  it("sends an empty list once every row is removed", () => {
    expect(upgrade({ tolerations: deployed }, (f) => ({ ...f, tolerations: [] })).tolerations).toEqual([]);
    expect(planRequest(EMPTY, { model: "m" }).overrides!).not.toHaveProperty("tolerations");
  });

  it("drops a new row with no key", () => {
    const f = { ...EMPTY, tolerations: [{ key: "", operator: "Exists" as const, value: "", effect: "" }] };
    expect(planRequest(f, { model: "m" }).overrides!).not.toHaveProperty("tolerations");
  });
});

describe("planRequest with a preset", () => {
  it("merges the preset's tolerations with the rows", () => {
    const f = { ...EMPTY, preset: "storage-net", tolerations: [{ key: "gpu", operator: "Exists" as const, value: "", effect: "" }] };
    const got = planRequest(f, { model: "m", preset: { tolerations: [{ key: "ebof-test", operator: "Exists" }], nodeSelector: { "ebof.modelsphere.io/storage-net": "true" } } }).overrides!;
    expect(got.tolerations).toEqual([{ key: "ebof-test", operator: "Exists" }, { key: "gpu", operator: "Exists" }]);
    expect(got.nodeSelector).toEqual({ "ebof.modelsphere.io/storage-net": "true" });
  });
});

describe("env and pd.<role>.env merging", () => {
  const catalogValues = {
    env: [
      { name: "NCCL_IB_QPS_PER_CONNECTION", value: "8" },
      { name: "SGLANG_HOST_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
    ],
    pd: {
      prefill: {
        env: [{ name: "PYTORCH_CUDA_ALLOC_CONF", value: "expandable_segments:True" }],
      },
      decode: {
        env: [
          { name: "PYTORCH_CUDA_ALLOC_CONF", value: "expandable_segments:True" },
          { name: "SGLANG_DISAGGREGATION_WAITING_TIMEOUT", value: "3600" },
        ],
      },
    },
  };

  it("mergeEnv replaces matching names in place and appends new ones", () => {
    const base = [
      { name: "A", value: "1" },
      { name: "B", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
    ];
    const over = [
      { name: "B", value: "10.0.0.1" },
      { name: "C", value: null, valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
    ];
    expect(mergeEnv(base, over)).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "10.0.0.1" },
      { name: "C", valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
    ]);
    expect(base[1]).toEqual({ name: "B", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } });
  });

  it("withEnv leaves env paths unset when the layer does not touch them", () => {
    const layer = { replicaCount: 2, pd: { decode: { replicas: 1 } } };
    expect(withEnv(catalogValues, layer)).toBe(layer);
  });

  it("planRequest merges preset env and pd.<role>.env over catalog and site extra env", () => {
    const preset = {
      env: [
        { name: "NCCL_IB_QPS_PER_CONNECTION", value: "16" },
        { name: "NCCL_DEBUG", value: "INFO" },
      ],
      pd: {
        decode: {
          env: [{ name: "DECODE_EXTRA", value: "1" }],
        },
      },
    };
    const siteExtra = {
      env: [{ name: "SITE_VAR", value: "site" }],
    };
    const req = planRequest(
      { ...EMPTY, preset: "roce" },
      { model: "m", preset, values: envBase(catalogValues, siteExtra) },
    );
    expect(req.overrides!.env).toEqual([
      { name: "NCCL_IB_QPS_PER_CONNECTION", value: "16" },
      { name: "SGLANG_HOST_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
      { name: "SITE_VAR", value: "site" },
      { name: "NCCL_DEBUG", value: "INFO" },
    ]);
    expect(req.overrides!.pd).toEqual({
      decode: {
        env: [
          { name: "PYTORCH_CUDA_ALLOC_CONF", value: "expandable_segments:True" },
          { name: "SGLANG_DISAGGREGATION_WAITING_TIMEOUT", value: "3600" },
          { name: "DECODE_EXTRA", value: "1" },
        ],
      },
    });
  });

  it("planRequest merges edit layer env and pd.<role>.env over catalog and form env", () => {
    const f: Form = {
      ...EMPTY,
      preset: "roce",
      edits: [
        "env:",
        "  - name: NCCL_DEBUG",
        "    value: WARN",
        "  - name: EDIT_ONLY",
        '    value: "1"',
        "pd:",
        "  decode:",
        "    env:",
        "      - name: PYTORCH_CUDA_ALLOC_CONF",
        "        value: expandable_segments:False",
      ].join("\n"),
    };
    const preset = {
      env: [{ name: "NCCL_DEBUG", value: "INFO" }],
    };
    const req = planRequest(f, { model: "m", preset, values: catalogValues });
    expect(editsWithEnv(f.edits, envBase(catalogValues, req.overrides))).toBe(req.editsYAML);
    expect(req.editsYAML).toContain("name: NCCL_IB_QPS_PER_CONNECTION");
    expect(req.editsYAML).toContain("name: SGLANG_HOST_IP");
    expect(req.editsYAML).toContain("value: WARN");
    expect(req.editsYAML).toContain('value: "1"');
    expect(req.editsYAML).toContain("name: SGLANG_DISAGGREGATION_WAITING_TIMEOUT");
    expect(req.editsYAML).toContain("value: expandable_segments:False");
  });

  it("formFromPlan preserves quoted numeric string env values in edit layer on upgrade", () => {
    const p = {
      release: { name: "r", namespace: "n" },
      layers: {
        form: {},
        edit: {
          env: [
            { name: "NCCL_IB_QPS_PER_CONNECTION", value: "8" },
            { name: "SGLANG_ENABLE_JIT_DEEPGEMM", value: "false" },
          ],
        },
      },
    } as unknown as Plan;
    const f = formFromPlan(p);
    expect(f.edits).toContain('value: "8"');
    expect(f.edits).toContain('value: "false"');
  });
});
