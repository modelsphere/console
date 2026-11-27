# Canary remote-plugin integration

Requirements from [#126](https://github.com/modelsphere/console/issues/126) apply to independently delivered frontend packages.

## Requirements and implementation

| Requirement | Host implementation | Consumer responsibility and acceptance |
| --- | --- | --- |
| R1: service relationships | Resource extensions at `inference-service` / `collection.row` and `resource.header`; the host passes the resource and plugin-owned data. | Canary interprets ownership and resolves experiments by verified UID, name, and namespace. Check both actual service APIs and all unavailable/unverified cases. |
| R2: localized help | `helpChapters` registers bundled Markdown in the existing help center. Relative illustrations resolve beneath the installed plugin asset directory. | Canary ships both locales and images; registering slug `canary` preserves `/help/docs/canary`. |
| R3: routes and capabilities | Menus and direct routes use their permission guards; `/api/capabilities` supplies backend read/write access. Help uses backend read access and optional UI permission. | Map every page and operation to reader/writer/no-access behavior. Use current-resource action data from #149. The backend team completes authenticated API acceptance. |
| R4: versions and CSS | SDK protocol-major validation; explicit help capability detection; per-plugin CSS loads before its entry. | Pin Console/SDK source and package versions; test upgrades and rollback; compile and ship plugin-only styles. |

## Extension mechanism

The host owns fixed resource-aware placements; plugins own registered components and business-specific interpretation.

```text
service API -> host query -> resource context -> plugin data/presentation
                                                -> verified experiment link
                                                -> non-link fallback
```

- Missing or failed plugins leave the current service extension points empty. A generic ownership label is not provided automatically.
- Unverified, deleted, inaccessible, or unmatched experiments must not produce an experiment link.
- A failed plugin load rolls back its registrations without removing other plugins.
- #149 / #151 tracks action-policy data delivery and independent SLO/uninstall policies; this change does not duplicate it.

## Help chapter contract

This additive SDK contract uses the existing loader and help page; it does not introduce another frontend runtime, HTTP endpoint, config key, or CRD field.

```ts
createPlugin({
  // Existing plugin identity, menus, components and routes remain unchanged.
  helpChapters: [{
    slug: "canary",
    title: { "en-US": "Canary", "zh-CN": "Canary" },
    content: { "en-US": englishMarkdown, "zh-CN": chineseMarkdown },
  }],
});
```

| Field | Contract |
| --- | --- |
| `slug` | Plugin ID or its kebab-case descendant, unique across chapters; cannot replace built-in chapters |
| `title` | Non-empty labels for `en-US` and `zh-CN` |
| `content` | Non-empty Markdown for both locales, bundled into the frontend entry |
| `authKey` | Optional non-empty UI permission; backend read access is also required when the plugin declares a backend |
| images | Relative to the entry directory; copied below `frontend/` during packaging; traversal paths are rejected |
| ordering | Built-in chapters first, plugin chapters sorted by slug |

Content is part of the installed frontend entry, so no second document fetch can race a package upgrade. Raw HTML is not enabled. Plugin assets remain public code, not a place for credentials or private data.

```text
installed chart -> CSS + entry bundle -> SDK help registration
                                      -> validated chapter registry
                                      -> permitted help directory / direct URL
                                      -> localized Markdown + plugin asset images
```

- Both the directory and direct URL use the current UI permission and backend capability state; unavailable or loading backend access hides the chapter.
- A failed registration is rolled back. Disabling/removing a plugin removes its chapter after page refresh, matching the existing boot-time plugin-discovery lifecycle.
- Upgrading the plugin changes its bundled documentation on refresh. Rollback restores the documentation in the rolled-back package.
- A removed or inaccessible chapter renders the existing help not-found state. Built-in documents and neighboring chapters remain available.
- Hosts without `registerHelpChapter` reject help-bearing bundles before plugin registration with an explicit compatibility error. Matching SDK majors alone are not sufficient.

### Alternatives

| Alternative | Decision |
| --- | --- |
| Continue injecting source and documents into Console builds | Does not satisfy independent delivery |
| Independent help page only | Does not preserve the unified contents list or existing chapter URL |
| Fetch mutable external Markdown | Can drift from the installed package and adds loading/version failure modes |

## Permission matrix to verify in Canary

| Surface | Reader | Writer | No backend read access |
| --- | --- | --- | --- |
| Experiment list/details | Read | Read | Denied |
| Creation route | Must not permit creation | Create | Denied |
| Pricing | Read | Supported edits | Denied |
| Traffic controls | Read-only | Supported writes | Denied |
| Plugin help | Read when any declared UI permission is granted | Same | Hidden and not available by direct URL |

The host never infers write access from menu visibility. Missing/loading/failed capability or policy data must not enable mutations.

## Compatibility and rollout

- Source package version: `0.1.0`; runtime protocol: `1.0.1`. Record the exact Console/SDK revision, plugin chart/product version, and image digest for each release.
- Use this PR's merged revision or later for `helpChapters`; include #149 for action-data-dependent policies. Canary #11 is the companion package integration.
- Multi-plugin CSS is delivered, not merged or isolated. Scope selectors; do not depend on another plugin's utilities or stylesheet order.
- #148 remains deferred. No shared-credential field, authentication bypass, automatic permission grant, or live resource mutation is introduced.
- Before migration acceptance, verify real service metadata, backend authentication, localized assets, independent upgrades, rollback, and disable/re-enable against published packages.

## Validation

Host regressions cover localized chapters, the legacy-shaped chapter URL, release-relative images, direct-access permission checks, invalid/duplicate declarations, registration rollback, and SDK capability detection. Console and Canary package-level acceptance remains separate from these source tests.
