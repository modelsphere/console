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

Run `pnpm exec tsup --config tsup.config.mjs`. It emits `index.umd.js` and Tailwind `candidates.json`. The build must compile CSS using those candidates and the pinned Console theme. Current stylesheet integration supports one optional frontend; multi-plugin runtime CSS merging is outside its scope.

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
| `install` | Install or upgrade the plugin Helm release, with a host-capability overlay |
| `registration` | Print a `modelsphere.dev/v1alpha1` Plugin CR for a separate apply |
| `list` | Read Plugin CRs and their phases |
| `uninstall` | Delete the Plugin CR, then uninstall the plugin release |

`install` never writes Console Helm values and never upgrades Console. Registration is a
separate CR; Console watches it and reads the installed release's `plugin.yaml` and
`frontend/` files. See [`plugin-cli.md`](plugin-cli.md) for the full walkthrough.

The packaged Chart must contain `Chart.yaml`, `plugin.yaml`, and the frontend files under
`frontend/`. The v1 manifest carries identity, product version, host requirements, and the
frontend entry:

```yaml
apiVersion: v1
group: modelsphere.dev
name: example
version: 0.1.0
requires:
  imagePullSecrets: true
  swiss: true
  inferenceNamespaces: true
frontend:
  type: component
  runtime: remote
  entry: index.umd.js
```

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
modelsphere plugin validate ./helm/canaryd
modelsphere plugin package ./helm/canaryd --destination ./dist
modelsphere plugin install ./dist/canaryd-0.3.0.tgz --wait
modelsphere plugin registration ./dist/canaryd-0.3.0.tgz | kubectl apply -f -
modelsphere plugin list
modelsphere plugin uninstall modelsphere.dev/canary --yes --wait
```

Install discovers the unique Console release when no Console flags are provided, reads its
`externalSwiss`, `platform.inferenceNamespaces` and `imagePullSecrets`, and turns only the
requirements declared by the package into a temporary overlay. A declared capability that the
host cannot supply fails before Helm runs. Uninstall without an argument lists registrations
and asks for a selection; automation can pass the full `group/name` with `--yes`. Uninstall
deletes the CR first, then the release.

`web/test/plugin-runtime.html` is a development browser test fixture that loads the plugins Console serves, with actual host providers. It is excluded from the production entry and does not disable application authentication.
