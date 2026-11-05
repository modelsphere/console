# Global SDK frontend plugins

Console loads trusted frontend bundles with the Global SDK registration contract; operators declare navigation and asset services in configuration.

```text
private frontend -> Global SDK build -> static frontend image
                                            |
console.yaml -> /plugins/index.json -> same-origin asset proxy
                                            |
                         shared SDK -> components + routes -> Console shell
```

## Decisions

| Decision | Reason / tradeoff |
|---|---|
| Keep the existing SDK package and build preset | `createPlugin`, shared React and `index.umd.js` remain compatible. Do not fork the SDK just to rename it. |
| Publish `__GLOBAL_SDK__` and the compatible `__RISE_SDK__` alias | Both names reference the same host. Existing bundles need no rename. |
| Declare a menu in Console configuration | Installation adds one configured entry; SDK routes supply detail and create pages. |
| Serve frontend assets from an independent image | Console proxies a configured HTTP(S) service; no archive upload, Plugin CRD or installation controller. |
| Keep filesystem packages working | Existing #114 local packages can still be tested. New configured packages use the SDK contract. |
| Private frontend retains its current pages | Only runtime integration and packaging change. No private UI enters the public repository. |

## Configuration

```yaml
plugins:
  - id: example
    url: http://example-frontend:8080
    entry: index.umd.js
    styles: [index.css]
    menu:
      title: Example
      label: Example
      path: /example
      component: Example
      icon: boxes
```

- Empty `plugins` installs nothing. Configuration changes require a Console restart.
- `/plugins/index.json` returns descriptors and configured navigation, never internal service URLs.
- `/plugins/<id>/...` proxies static assets; it strips cookies and authorization and never permits writes.
- Invalid IDs, paths, URLs, duplicate packages and missing menu fields fail configuration validation.
- Components and routes register transactionally while their script loads. Failure removes the plugin and its assets; built-ins remain available.
- SDK API calls use the existing Console transport. This change adds no menu/page permission policy. A platform scope is exposed; cluster/workspace management is outside this change.
- SDK UI/business surfaces expose the actual Console services. Unsupported slots and namespaces fail explicitly.
- Global's optional `authKey` metadata is accepted for compatibility. It does not create menu/page permission gates in this integration.

## Compatibility boundary

| Supported here | Separate platform capabilities |
|---|---|
| Actual SDK package and standard build preset | Global extension marketplace/install APIs |
| `registerPlugin`, component and route registration | Plugin CRDs and lifecycle controllers |
| Shared React and Console Router/Query/UI transport | Global-specific business modules and hierarchical scope management |
| SDK `[id]` dynamic route patterns | Slot rendering and arbitrary multi-plugin CSS aggregation |

The private frontend's existing router/query/UI imports resolve to the Console host through the SDK business/UI surfaces. This is registration/build-protocol compatibility; it does not claim every Global business plugin can run unchanged.

## Styles

The SDK still emits `candidates.json`. The frontend image build compiles one stylesheet from its candidates and the pinned Console host candidates/theme. This preserves Tailwind rule order for the current single optional frontend. A shared runtime CSS compiler for arbitrary independently installed plugins is a separate change.

## Verification

1. Configuration -> discovery -> image asset proxy, including invalid paths, missing upstream, and credential stripping.
2. Standard SDK registration -> configured menu -> dynamic routes, shared React/query/router and language, without new page permission gates.
3. Build the current private frontend with the actual SDK preset; verify bundle loading and retained page routes.
4. Typecheck, unit tests and production builds. Keep the existing local instance unchanged until the candidate is ready.

## Alternatives

- A renamed custom loader would preserve the compatibility gap.
- Importing Global's full installation backend adds unrelated lifecycle and Kubernetes dependencies.
- Compiling private pages into Console still requires rebuilding Console to install them.
