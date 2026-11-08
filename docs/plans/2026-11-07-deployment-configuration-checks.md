# Deployment configuration check log

This records the current Console-only implementation, verification evidence and review history for [PR #81](https://github.com/modelsphere/console/pull/81), related to [issue #66](https://github.com/modelsphere/console/issues/66).

## Scope after review — 2026-11-08

| Concern | Current decision |
|---|---|
| Backend | Use the existing form/edit API; withdraw the complete-user-values proposal in [Swiss PR #52](https://github.com/modelsphere/swiss/pull/52) |
| Shared editing | Keep the approved three-pane UI and bidirectional form/YAML updates |
| Saving partial YAML | Preserve omitted saved form settings; YAML remains an override layer |
| Explicit cleanup | Retain the existing guarded timeout/adaptive cleanup flows; preview reuses their final request |
| System layers | Show the actual server result; no new canary lifecycle or autoscaling runtime behavior |
| Identity | Keep the actual service identity locked; reject conflicting YAML before composition |
| Compatibility | No new request field, capability or backend release dependency |

- Design: [deployment configuration](2026-11-07-deployment-configuration.md).
- Request semantics: [existing API contract](2026-11-07-deployment-values-contract.md).
- Browser scenarios: [fixture guide](../../web/test/README.md).
- Release notes: `CHANGELOG.md`.

```text
form <-> shared YAML draft
              |
   existing overrides + editsYAML -> compose -> diff -> apply
                                      |
                            same final request -> effective preview
```

## Regression checks

| Behavior | Evidence |
|---|---|
| Partial YAML | Missing replica/image/form-only keys retain the saved form; only supplied YAML keys override them |
| YAML-only clear | A form submission with empty edit YAML clears the prior edit layer while retaining saved form settings |
| Bare upgrade | Existing requests without form overrides retain their previous edit layer |
| Structured changes | Owned paths update the YAML; unknown keys and comments survive |
| Timeout/adaptive reset | Combined cleanup preserves unrelated values; dry-run uses the final pinned request and does not resurrect removed fields |
| GPU clearing | Distinguish omission from an explicit selector clear; remove the whole required rule when no constraints remain |
| GPU automatic selection | Read target defaults/catalog/site/derived constraints and the supported server-resolved resource; do not revive a saved selector/resource |
| Older GPU charts | Continue selecting products when the chart intentionally omits the default GPU resource field |
| GPU constraints | Preserve unrelated zones, matchFields, preferred affinity and selector grouping |
| Revision checks | Check the live revision around snapshot/planning and before apply; keep drafts after stale-result rejection |
| Identity | Reject a changed or null YAML serviceId while retaining the locked actual identity |

## Current automated verification

| Check | Result |
|---|---|
| Frontend suite | 65 files / 605 tests passed (`pnpm --dir web test`) |
| Both TypeScript configurations | Passed (`pnpm --dir web run typecheck`) |
| Console production build | Passed (`pnpm --dir web run build`) |
| Standalone frontend build | Passed (`pnpm --dir web run build:swiss`) |
| Console Go checks | `go vet ./...` and `go test ./...` passed |
| Review | React, TypeScript and legacy API-contract review completed; reported regressions fixed and rechecked |
| Whitespace | `git diff --check` passed |

Both builds retain the existing chunk-size advisories. No chart or backend source was changed.

## Browser verification — existing API fixture

- All scenarios omit the new capability field and use `overrides` plus `editsYAML`.
- Upgrade baseline/effective panes load through the existing plan/dry-run endpoints.
- Pasting only `image.tag` leaves the form's stored replica count at 2.
- Changing the form replica count to 3 inserts `replicaCount: 3` into that partial YAML and preserves the image tag.
- Changing YAML to `replicaCount: 4` updates the form to 4 and reaches deployment review.
- Clearing the saved H100 selection resolves to the target default H100/H800 set and preserves preferred affinity.
- Autoscale shows the configured count 2 alongside the server-effective count 4.
- The 390px layout has no document overflow; desktop and mobile layouts were inspected.
- The fixture blocks live install/apply and unexpected network access.

Browser checks use fixture API data; no live model deployment or crash-recovery validation was performed.

## Production integration

| Entry | Shared implementation |
|---|---|
| Model library deployment | `components/DeploySheet.tsx` |
| Model detail deployment | `components/DeploySheet.tsx` |
| Service list upgrade | `components/DeploySheet.tsx` |
| Service detail upgrade | `components/DeploySheet.tsx` |

```text
production page -> DeploySheet -> shared draft / three-pane editor
                         |
             /api/deploy/plans -> authenticated Console proxy -> existing deployment API
```

The production app enters through `web/index.html` and `src/main.tsx`; the fixture is isolated under `web/test`.

## Review history

- Console baseline: `bac3654b249cc67f3ed03e3807ff0bc51de9f8a6`.
- The original paired backend commit `9a0cd9e` introduced complete replacement and a capability requirement. Its local/CI tests passed, but review identified an ownership/compatibility design blocker. That implementation is withdrawn and its tests are not evidence for the current Console-only solution.
- Review corrections restore existing persistence semantics, retain explicit cleanup, and cover stored GPU affinity/resource and service identity at the Console boundary.

## Repository artifacts

- Verification screenshots are kept outside the repository; the PR contains text verification records only.
- Binary files must not be committed to this repository.

## Main branch integration

- Rebased onto `2ae2cab` and resolved conflicts in the deploy form, shared editor, settings adapter and translations.
- Preserved multi-image controls, container/per-role resources, model inputs and remembered site answers, presets, node-taint tolerations and affinity editing.
- Passed the current serializer/profile/GPU context into the shared draft. Image, resource, input and scheduling changes retain their YAML bindings.
- Presets remain selection metadata: repeated changes and cancellation use the new preset while preserving explicit user overrides.
- Keep explicit nulls for affinity/PD clearing separate from omitted YAML fields.
- Baseline and effective preview share the validated plan so required input answers are retained; baseline includes cluster defaults, catalog, site and derived layers.
- Full frontend suite: 78 files / 726 tests passed. Both type configurations, Console/standalone production builds, Console Go vet/tests and whitespace checks passed.
- Added regressions for the new form fields, repeated preset selection, temporary resource-input clearing, and required-input/cluster-default preview behavior.
- Browser inspection used the production editor with fixture API responses. No binary verification artifacts were added.
