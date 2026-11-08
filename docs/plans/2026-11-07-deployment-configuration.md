# Unified deployment configuration

The approved prototype uses one user draft for structured controls and YAML. The implementation decisions and verification are recorded in this document and its check log.

| Surface | Data |
|---|---|
| Target baseline, read-only | Chart values and non-user layers from the validated target plan |
| User configuration, editable | Shared YAML draft projected over retained form settings; invalid text remains editable |
| Effective configuration, read-only | Swiss's complete composition including system layers |
| Current deployment comparison | The current Helm revision's actual values, independent of target defaults |

```text
form <-> user draft <-> YAML
              |
       Swiss compose -> diff -> apply
              ^                  |
              +--- re-preview <--+ (revision changed)
```

## Data and compatibility

- Reuse the existing form serializer/deserializer to project structured controls; preserve unknown YAML keys.
- Keep release identity and apply flags separate from chart values.
- Seed upgrades from explicit form/edit layers; never seed user overrides from Helm's merged defaults.
- Present stored form/edit settings in one draft, then submit the existing `overrides` and `editsYAML` fields. A partial YAML document retains omitted form settings.
- Keep the existing guarded timeout/adaptive cleanup paths for explicit form actions; reuse their final request for the effective preview.
- Use the same composition path for the editor's effective values and deploy review. The UI never appends user YAML after system layers.
- Read and verify the current Helm revision before composing/applying an upgrade. On a mismatch, retain the draft and allow an explicit refresh and new preview.
- Reuse authenticated plan, dry-run Helm values, status and revision-values endpoints. No backend API or capability change is required. See [existing API contract](2026-11-07-deployment-values-contract.md).
- Invalid YAML disables structured changes and composition; source/read failures never become empty successful previews.

## Delivery

1. Test the shared draft and version/compose boundaries.
2. Replace the multi-tab editor with read-only baseline, editable user YAML and read-only effective panes.
3. Integrate the draft, current-revision comparison and preflight checks into deploy/upgrade.
4. Record validation in `2026-11-07-deployment-configuration-checks.md` and user-visible changes in CHANGELOG.

## Interaction decisions

- Structured controls and YAML share one editing model; persisted form and YAML layers retain their existing ownership.
- Project fields from YAML over retained form settings and the selected target baseline. YAML omission preserves the saved form value.
- Patch only the paths owned by changed controls; retain unknown keys and comments.
- Disabling a feature preserves its configuration for re-enabling. Enabling a scaler removes the conflicting fixed replica override.
- Resolve GPU product/resource changes through the deployment service before committing its generated terms to the document. Preserve other required/preferred affinity and original selector groups.
- Bind model paths/resources to their YAML paths; keep release identity and apply flags separate.
- Keep the baseline and final panes read-only; obtain the final configuration through the deployment composition path.
