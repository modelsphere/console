# Frontend plugins

Console loads trusted, separately maintained frontend plugins through `@modelsphere/plugin-sdk`.

## Prepare the SDK

SDK source lives in `web/packages/plugin-sdk`. The package is currently built from a pinned Console checkout; it has not been published to a registry.

```sh
export CONSOLE_SOURCE_DIR=/path/to/console
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" install --frozen-lockfile
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" run typecheck
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" test
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" run build
```

A consuming repository can prepare a generated local `file:` dependency from the built SDK. Keep generated package files out of Git; prepare them before dependency installation and record the Console revision with the build. Available exports are the runtime, `/build`, `/react-shim` and `/testing`.

## Register pages

```tsx
import { createPlugin } from "@modelsphere/plugin-sdk";
import { ExamplePage, ItemPage } from "./pages";
declare const __PLUGIN_VERSION__: string;
createPlugin({
  name: "example",
  version: __PLUGIN_VERSION__,
  components: { ExamplePage },
  routes: { "items/[id]": ItemPage },
});
```

The presets inject `__PLUGIN_VERSION__` from the frontend's `Chart.yaml`. The runtime registers its
own menus and root components; the Console plugin index supplies only the file locations and the
API prefix. `[id]` routes become `:id`; `[...name]` becomes a catch-all. Use named imports for shared `react-router`, `@tanstack/react-query` and `@modelsphere/ui` modules. React and these imports use actual host instances. Authenticated `apiFetch` and i18n are exposed through `getBusiness<ConsoleServices>().console`. Optional auth metadata creates no new menu/page policy.

## Build the frontend bundle

Production `tsup.config.mjs`:

```js
import { definePluginConfig } from "@modelsphere/plugin-sdk/build";
export default definePluginConfig({ name: "example", entry: "src/runtime.tsx", outDir: "dist" });
```

Run `pnpm exec tsup --config tsup.config.mjs`. It emits `index.umd.js` and Tailwind `candidates.json`. The build must compile CSS from those candidates and the pinned Console theme. Console loads every `.css` file under the release's `frontend/` before the entry; Tailwind's ordering guarantee does not extend across plugins' stylesheets.

Console serves the built files from the installed release's `frontend/` directory. Put `frontend/<entry>` in the Chart; the Plugin CR makes the release addressable at `/plugins/<group--name>/<entry>`. Deployment loads the classic bundle.

## Verify and recover

| Check | Observable result |
| --- | --- |
| `GET /plugins/index.json` | Identity, same-origin entry/style URLs and backend prefix; no upstream URL. |
| Entry and stylesheet requests | HTTP 200 under `/plugins/<group--name>/`. |
| `Object.keys(window.__MODELSPHERE_SDK__.getPluginComponents("example"))` | Contains `ExamplePage`. |
| Menu/root and `items/<id>` | Render under host Router/Query/UI providers. |
| CR disabled or deleted | Menu/routes and assets disappear; no Console restart needed. |
| Backend upstream unavailable | API requests fail with 502; built-ins remain usable. |

Console watches Plugin CRs through an informer. Open tabs retain their registry until refreshed. Plugin JavaScript runs with Console frontend privileges, so operators must register trusted releases. Backend requests pass through Console IAM authorization before reaching the plugin.

## Package and install with ModelSphere CLI

For a complete install/uninstall walkthrough using the CPU16 cluster, see
[`plugin-cli.md`](plugin-cli.md).

`cmd/modelsphere` provides the local lifecycle adapter:

| Command | Scope |
| --- | --- |
| `validate` / `package` | Validate `Chart.yaml` and `plugin.yaml`; build a `.tgz` |
| `install` | Install or upgrade the plugin Helm release, resolving the package's `consumes` bindings |
| `registration` | Print a `modelsphere.dev/v1alpha1` Plugin CR for a separate apply |
| `list` | Read Plugin CRs and their phases |
| `uninstall` | Delete the Plugin CR, then uninstall the plugin release |

`install` never writes Console Helm values and never upgrades Console. Registration is a
separate CR; Console watches it and reads the installed release's `plugin.yaml` and
`frontend/` files. See [`plugin-cli.md`](plugin-cli.md) for the full walkthrough.

The packaged Chart must contain `Chart.yaml`, `plugin.yaml`, and the frontend files under
`frontend/`. The v1 manifest carries identity, product version, the capabilities the package
publishes or binds to, and the frontend entry:

```yaml
apiVersion: v1
group: modelsphere.dev
name: example
version: 0.1.0
provides:
  - capability: example.modelsphere.dev/reports
    version: v1
    values:
      endpoint: .gateway.url
      apiKeyRef: .gateway.auth.secretRef
    sameNamespace: false
consumes:
  - capability: platform.modelsphere.dev/image-pull-secrets
    version: v1
  - capability: swiss.modelsphere.dev/gateway
    version: v1
    from:
      kind: Plugin
      group: modelsphere.dev
      name: swiss
      version: ">=0.4.0"
frontend:
  type: component
  runtime: remote
  entry: index.umd.js
```

A capability id is a reverse-DNS domain plus a name, versioned by schema (`v1`). `provides`
maps each published key to a dotted path inside the provider's rendered Helm values, so the
key's value is readable without knowing the provider's chart layout. `consumes` names what the
package needs; an optional `from` pins one provider (`kind`, `group`, `name`) and a SemVer
range on the provider's product version. Without `from`, the CLI accepts the first eligible
provider and refuses the install when several compete.

The platform is a provider like any other. `modelsphere.dev/platform` publishes
`image-pull-secrets` (namespace-scoped) and `inference-namespaces`, and
`modelsphere.dev/swiss` publishes `gateway`. A registered plugin declaring the same capability
shadows the corresponding built-in, so a package written against today's platform keeps working
when a real Swiss plugin takes over.

The API route is not declared in `plugin.yaml`. The Chart renders an
`iam.theriseunion.io/v1alpha1` `ReverseProxy` whose `spec.matcher.path` starts with `/api/`
and whose `spec.directives.authProxy` is `true`. Console authorizes each request against IAM
resource `backends` using the plugin name.

Non-secret defaults live in the platform config directory reported by Go
(`$XDG_CONFIG_HOME` on Linux, `~/Library/Application Support` on macOS), or can be passed
as flags:

```yaml
kubeconfig: ~/.kube/config
context: cpu16
console:
  release: modelsphere-console
  namespace: console-system
```

```sh
node hack/package-plugin.mjs --registry <registry>/<project> --tag <image-tag> --destination ./dist
modelsphere plugin validate ./dist/canaryd-0.3.0.tgz
modelsphere plugin install ./dist/canaryd-0.3.0.tgz --wait
modelsphere plugin registration ./dist/canaryd-0.3.0.tgz | kubectl apply -f -
modelsphere plugin list
modelsphere plugin uninstall modelsphere.dev/canary --yes --wait
```

A package carries `frontend/<entry>`; without it Console can never load the bundle, so
`validate`, `package` and `install` reject it before Helm runs. `modelsphere plugin package`
wraps `helm package` and does not build the frontend, which is why release packages come from
the release script or CI.

Install discovers the unique Console release when no Console flags are provided, reads the
platform's Helm values and its registered plugins, then resolves every `consumes` binding into
a temporary values file under `consumed.<providerGroup>/<providerName>.<key>`. Resolution is
preflight: a missing provider, an ambiguous choice, a provider outside the requested SemVer
range, a namespace-scoped capability in another namespace, or a declared value path that
resolves to nothing all fail before Helm runs. Uninstall without an argument lists
registrations and asks for a selection; automation can pass the full `group/name` with `--yes`.
Uninstall deletes the CR first, then the release.

`web/test/plugin-runtime.html` is a development browser test fixture that loads the plugins Console serves, with actual host providers. It is excluded from the production entry and does not disable application authentication.
