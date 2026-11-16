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

A consuming repository can prepare a generated local `file:` dependency from the built SDK. Keep generated package files out of Git; prepare them before dependency installation and record the Console revision with the build. Available exports are the runtime, `/build`, `/dev`, `/react-shim` and `/testing`.

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

The presets inject `__PLUGIN_VERSION__` from the frontend's `Chart.yaml`. Configuration selects the menu and root component. `[id]` routes become `:id`; `[...name]` becomes a catch-all. Use named imports for shared `react-router`, `@tanstack/react-query` and `@modelsphere/ui` modules. React and these imports use actual host instances. Authenticated `apiFetch` and i18n are exposed through `getBusiness<ConsoleServices>().console`. Optional auth metadata creates no new menu/page policy.

## Develop with Fast Refresh

Create `vite.config.mjs` in the plugin frontend:

```js
import { definePluginDevConfig } from "@modelsphere/plugin-sdk/dev";
export default definePluginDevConfig({
  name: "example", entry: "src/runtime.tsx",
  hostSource: process.env.CONSOLE_SOURCE_DIR,
  hostOrigin: process.env.CONSOLE_ORIGIN,
});
```

Run one Console frontend and Go backend using the normal development instructions. Preserve existing cluster/auth/backend settings and add:

```yaml
plugins:
  - id: example
    url: http://127.0.0.1:4181
    development: true
    entry: __modelsphere_entry.ts
    menu:
      title: Example
      label: Example
      path: /example
      component: ExamplePage
      icon: puzzle
```

Restart the existing backend. From the plugin frontend directory:

```sh
export CONSOLE_SOURCE_DIR=/path/to/console
export CONSOLE_ORIGIN=http://127.0.0.1:5173
pnpm exec vite --config vite.config.mjs
```

Refresh Console once to discover the development entry. Compatible React component edits then update automatically and preserve local state. Entry/registration changes reload the page. New shared named imports regenerate their exports while Vite runs. The SDK compiles styles against the host theme and plugin source.

HTTP and WebSocket requests use `/plugins/<id>/` through both Console proxies. The plugin reuses the host Vite server's `/@react-refresh` runtime. This development mode requires the Console Vite frontend; a production frontend does not provide that runtime.

## Deploy a static-resource image

This URL-based descriptor remains for development and existing deployments. Installed plugins
publish their frontend files through the Plugin CR instead of a Console values entry.

Production `tsup.config.mjs`:

```js
import { definePluginConfig } from "@modelsphere/plugin-sdk/build";
export default definePluginConfig({ name: "example", entry: "src/runtime.tsx", outDir: "dist" });
```

Run `pnpm exec tsup --config tsup.config.mjs`. It emits `index.umd.js` and Tailwind `candidates.json`. The image build must compile CSS using those candidates and the pinned Console theme. Current stylesheet integration supports one optional frontend; arbitrary multi-plugin runtime CSS merging is outside its scope.

Serve the built files with a static-resource image. Change the descriptor to `url: http://example-frontend:8080`, `entry: index.umd.js`, `styles: [index.css]` and omit `development`. Keep the menu declaration, restart the existing backend and refresh Console. Deployment loads the classic built bundle and rejects WebSocket upgrades.

## Verify and recover

| Check | Observable result |
| --- | --- |
| `GET /plugins/index.json` | Identity, same-origin URLs and menu; no upstream URL. |
| Entry and stylesheet requests | HTTP 200. |
| `Object.keys(window.__MODELSPHERE_SDK__.getPluginComponents("example"))` | Contains `ExamplePage`. |
| Menu/root and `items/<id>` | Render under host Router/Query/UI providers. |
| Compatible component edit | Text changes with unchanged document and local state. |
| Service unavailable | Visible plugin loading error; built-ins remain usable. Restore the service and refresh. |
| Set `plugins: []`, restart and refresh | Optional menu/routes disappear; backend business records remain. |

Configuration is read at backend startup. Open tabs retain their registry until refreshed. Plugin JavaScript runs with Console frontend privileges, so operators must select trusted services. The resource proxy strips Cookie/Authorization and upstream Set-Cookie; existing business API authentication/authorization still applies.

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

`web/test/plugin-runtime.html` is a development browser test fixture using configured plugins and actual host providers. It is excluded from the production entry and does not disable application authentication.
