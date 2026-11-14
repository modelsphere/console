# Deployment configuration on the existing API

Console synchronizes form controls and YAML while retaining the deployment service's existing form/edit ownership.

| Input | Existing behavior |
|---|---|
| `overrides` | Structured form values; upgrades merge these into the saved form layer |
| `editsYAML` | YAML override layer; a form submission replaces the previous edit layer |
| Omitted YAML field | The form or target baseline remains effective; omission does not erase saved form settings |
| Explicit YAML `null` | Existing Helm deletion semantics |
| `fromRelease` | Validate the release/source and carry the settings and system state supported by the existing service |

```text
stored form + target baseline -> form projection <-> YAML draft
                                      |
                        overrides + editsYAML + fromRelease
                                      |
                              compose -> diff -> apply
```

- The editor initially presents the stored form and edit values together. Structured edits patch only their owned paths and preserve other YAML and comments.
- Form projection includes retained saved form values beneath the draft, so pasting partial YAML does not reset the omitted controls.
- Keep the existing guarded recovery-timeout and adaptive-parameter cleanup flows for explicit form actions. Their source/layer checks still reject an unsafe recomposition.
- Effective preview reuses the final request selected by composition, including whether an existing cleanup flow removed `fromRelease`. It uses the same resolved target/chart and form/edit payload.
- Build the read-only baseline from chart defaults and the validated plan's non-user layers, preserving required answers during validation. Obtain effective values through the server's full layer order.
- GPU changes resolve against the validated target, preserve unrelated required/preferred affinity, and use an explicit deletion when clearing a retained selector. Empty automatic choices use the target's resolved selector rather than restoring the saved selection. Where the chart exposes a GPU resource, write the actual resolved resource back to the shared document; older charts may legitimately omit that key.
- There is no new request field, capability, backend upgrade requirement or autoscaling runtime change.

The earlier complete-`userValues` proposal was withdrawn after review. [Swiss PR #52](https://github.com/modelsphere/swiss/pull/52) is no longer a dependency of [Console PR #81](https://github.com/modelsphere/console/pull/81).
