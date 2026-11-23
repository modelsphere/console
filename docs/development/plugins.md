# Plugin development guide

A plugin is a Helm chart that adds pages and an API to Console. Console loads
the chart's frontend bundle from the installed release and proxies its declared
`/api/` prefix; it never runs Helm itself. This guide builds one end to end. For
the model behind it — identity, the registration contract, the loader and the
failure model — see [plugin-architecture.md](plugin-architecture.md).

## What you produce

```
my-plugin/
  Chart.yaml               chart name, SemVer version, type: application
  plugin.yaml              identity, product version, capabilities, frontend entry
  values.yaml
  package.json             frontend build dependencies
  tsup.config.ts
  .helmignore              excludes sources and node_modules from the package
  templates/
    deployment.yaml
    service.yaml
    reverseproxy.yaml      only when the plugin has an API
    iam.yaml               roles that grant backends access
  frontend/
    src/
      runtime.tsx          createPlugin(...)
      pages/
    index.umd.js           build output, git-ignored
    my-plugin.css          build output when the plugin has styles, git-ignored
```

The packaged chart must contain `frontend/<entry>` as a real file. Installation
and registration are separate steps: `helm` (through the CLI) creates the
release, and a `Plugin` CR tells Console to serve it.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node 22 and `pnpm` | the frontend build |
| `helm` 3.8+ and `kubectl` | install and registration |
| a cluster running Console | Console discovers its own release with `modelsphere plugin install` |
| Console source checkout | the SDK is built from it; it is not published to a registry |

## 1. Chart metadata

```yaml
apiVersion: v2
name: my-plugin
description: My Plugin Console extension
version: 0.1.0
appVersion: "0.1.0"
type: application
```

- `Chart.yaml` `name` must be lowercase kebab-case. It is the chart name, which
  may differ from the plugin name in `plugin.yaml`.
- `version` must be strict SemVer. It is the version Helm installs and the
  version a Plugin CR pin checks.
- `type` must be `application` (or omitted).

## 2. `plugin.yaml`

```yaml
apiVersion: v1
group: modelsphere.dev
name: my-plugin
version: 0.1.0
displayName: My Plugin
description: Adds My Plugin pages and API to Console.
provides:
  - capability: my-plugin.modelsphere.dev/reports
    version: v1
    values:
      endpoint: .gateway.url
consumes:
  - capability: platform.modelsphere.dev/image-pull-secrets
    version: v1
frontend:
  type: component
  runtime: remote
  entry: index.umd.js
```

| Field | Rule |
| --- | --- |
| `apiVersion` | `v1`, exact |
| `group` | DNS-1123 subdomain, e.g. `modelsphere.dev` |
| `name` | DNS-1123 label; also the module id and the backend resource name |
| `version` | product version, strict SemVer, independent of the chart version |
| `displayName`, `description` | human-readable metadata copied into `status.pluginMeta` |
| `frontend` | must be `type: component`, `runtime: remote`; `entry` is a relative path inside `frontend/` |
| `provides`, `consumes` | capabilities; see [plugin-platform-config.md](plugin-platform-config.md) |

`plugin.yaml` is parsed strictly: an unknown top-level key fails validation.
Navigation does not belong here. Menus, pages and extension placements are
registered by the bundle at runtime.

`group` and `name` encode into the CR name `<group>--<name>`. A component that
itself contains `--` or starts with `x-` is base32-escaped with an `x-` prefix to
keep the split unambiguous; use a plain name unless you need otherwise.

## 3. Prepare the SDK

The SDK lives in the Console checkout at `web/packages/plugin-sdk`. Build it
once, then depend on the built package from the plugin:

```sh
export CONSOLE_SOURCE_DIR=/path/to/console
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" install --frozen-lockfile
pnpm --dir "$CONSOLE_SOURCE_DIR/web/packages/plugin-sdk" run build
```

In the plugin's `frontend/package.json`, point at the built SDK with a `file:`
dependency and keep the generated `dist` out of Git. Record the Console revision
used to build the release alongside the package.

Available exports:

| Import | Purpose |
| --- | --- |
| `@modelsphere/plugin-sdk` | `createPlugin`, host accessors, types |
| `@modelsphere/plugin-sdk/build` | `definePluginConfig` for `tsup` |
| `@modelsphere/plugin-sdk/react-shim` | the shared React instance |
| `@modelsphere/plugin-sdk/testing` | test helpers |

## 4. Write the entry

```tsx
import { createPlugin } from "@modelsphere/plugin-sdk";
import { OverviewPage, ReportPage } from "./pages";

declare const __PLUGIN_VERSION__: string;

createPlugin({
  name: "my-plugin",
  version: __PLUGIN_VERSION__,
  displayName: "My Plugin",
  icon: "boxes",
  menus: [
    { name: "my-plugin", title: "My Plugin", path: "/my-plugin", scope: "platform" },
  ],
  components: { OverviewPage, ReportPage },
  routes: {
    "/my-plugin": OverviewPage,
    "reports/[id]": ReportPage,
  },
});
```

`name` must equal `plugin.yaml` `name`. `__PLUGIN_VERSION__` is injected by the
build preset from the chart's `Chart.yaml` `version`, so the bundle and the
chart cannot drift.

### Menus and navigation

| Rule | Result |
| --- | --- |
| at least one menu mapping | required; hidden menu mappings are allowed and retain their routes |
| `menus[]` | all entries are registered; `hidden` and `authKey` control sidebar visibility |
| component mapping | explicit route, then `menu.name` kebab-case to PascalCase; legacy raw-key fallback remains |
| `parent`, `group`, `order` | contribute to the installed target sidebar, merge group titles, order entries with default 999 |
| `scope: "platform"` | the only scope this Console currently serves |
| `children` | retain nested navigation, sibling ordering and expandable branches; child ownership and permissions inherit unless overridden |
| unsupported declarations | non-platform scope/requiredScope and query/hash menu paths report explicit errors |
| `icon` | any name in the installed Lucide dynamic catalog; absent means `puzzle`, unknown names fail registration |
| duplicate module id or overlapping namespace | registration fails with a validation error |

Every plugin has exactly one module identity but may own multiple route namespaces.
A plugin that only contributes extensions still registers a menu mapping.
None of its namespaces may overlap a builtin or another plugin. A `parent`
contribution changes sidebar placement, not the route/component owner.
Host presentation modes share these behaviors; no mode-specific plugin bundle is needed.

`title` is the source label. Menu translations use the plugin's i18n namespace
and a camelCase key derived from `menu.name`; missing translations fall back to
the declared title. Group titles remain merge keys across contributors.

### Navigation compositions and applications

Providers own functionality; compositions own navigation. Installing a plugin does not imply a separate application.

| Declaration | Console behavior |
| --- | --- |
| `menus` | Legacy default placement inside Console, including `parent/group/order/children` |
| `entries` | Reusable business pages registered by stable provider/name identity; no automatic menu placement |
| provider `scopes` | Context/title/icon metadata; not an application declaration |
| `createPlugin({ navigationComposition })` | Named application owned by the same plugin as its business pages |
| `registerNavigationComposition` | A separate navigation-only plugin with ordered groups of provider/entry references |
| host composition | `web/src/shell/console-navigation.ts`; the same group/reference model orders Console's built-in and plugin entries |

```tsx
groups: [{
  name: "model-operations",
  title: "Model operations",
  menus: [
    { provider: "console/inferences", entry: "index" },
    { provider: "example.io/experiments", entry: "experiments" },
  ],
}],
```

A plugin that includes both Console pages and an application can place its
Console pages in `menus` and its application pages in `entries`. Declare the
application scopes and groups in `navigationComposition`, and reference the
entries by their provider and name. An application is identified as
`<plugin-name>/<scope>`. Set `launcher: false` inside the composition to keep
the application available through an account menu link or its routes while
hiding its launcher card. Shared route namespaces use the ordinary menus for
their default landing page.

- Change group/reference array order to reorder menus without changing plugin bundles or module load order.
- Unreferenced legacy menus keep their default Console placement. North Star/Canary therefore integrates into Console, not a separate application.
- References never override page components, permissions, backend checks or translation ownership. Missing providers and denied/hidden ancestors produce no menu.
- Multiple entry names may reference the same route; preserve names, render the route only once. Host references take precedence over named compositions, then legacy defaults.
- Applications without an accessible static referenced page are omitted. A denied declared landing falls back to the first accessible static reference in the same context.
- The most-specific URL selects the application, including a Console page nested under an application's route. Refresh and browser history need no saved application selection.
- Application switching is independent of minimal, classic and mixed-nav appearance layouts. Console is the return entry when a named application exists.
- Application titles use the composition's `{name}:scope.{scope}` translation; group headings use stable ids independent of their translated labels.

Cluster declarations use Console's current cluster, exposed as `cluster/current`.
Authenticated `/clusters/{value}/oapis/` aliases do not select another cluster.
`imageContract: v1` is accepted; RoleTemplate CRDs support Chart installation only,
not authorization aggregation. See the [single-cluster design](single-cluster-applications-design.md)
for the unchanged original Dashboard Charts and browser verification.

### Account menu links

Set `userMenu` on `createPlugin()` to add links to the account dropdown. Use
an entry name from your plugin or an application ID from a registered
navigation composition.

```ts
userMenu: [
  { id: "overview", title: "My Plugin", target: { kind: "entry", name: "my-plugin" } },
  { id: "settings", title: "Settings", target: { kind: "application", id: "my-settings/platform" } },
],
```

- Each `id` is unique within the plugin and uses kebab-case. Translate the
  label at `userMenu.<id>` in the plugin's namespace. The declared `title`
  serves as the fallback.
- Set `order` to place the link among other plugin links. It defaults to
  `999`, with ties sorted by plugin ID and link ID.
- An entry target resolves to a static page owned by this plugin. Console
  checks the same visibility and permission rules it uses for navigation.
- An application target opens its default page if the user can access it
  and the first accessible landing page otherwise. Console hides the link
  if the application has no accessible landing page.

Console resolves these links from the currently available plugins and pages.
Page guards and backend authorization still apply. An older Console with the
same SDK major version ignores account menu declarations.

### Routes

Menu paths and route keys are normalized before matching; a matching route
provides the menu's component without registering a duplicate page. Global paths
use `/{group}/{version}/{resource}` as their namespace; existing Console paths use
`/{id}`. Relative detail routes mount below the first top-level menu's namespace;
absolute route keys keep their own namespace. `[id]` becomes
`:id` and `[...rest]` becomes `*`; unsupported segment syntax throws. With the
example above, `reports/[id]` renders at `/my-plugin/reports/:id`.

Each namespace's missing index page redirects to its first visible, permitted,
static own menu in order. Parameterized routes are never redirect targets.
Hidden or denied ancestors hide their navigation subtree, while child routes
remain registered with their own guards. Detail routes inherit their nearest
menu's `authKey`; backend authorization remains independent.

### Data and permissions

```tsx
import { getApi, usePermissions } from "@modelsphere/plugin-sdk";

const api = getApi();

async function loadReports() {
  const { data } = await api.get("/api/my-plugin/reports");
  return data;
}

function DeleteReport({ id }: { id: string }) {
  const { hasPermission, loading } = usePermissions();
  if (loading || !hasPermission("my-plugin.write")) return null;
  return <button onClick={() => void api.delete(`/api/my-plugin/reports/${id}`)}>Delete</button>;
}
```

- `getApi()` sends same-origin requests only. A relative path that escapes the
  origin throws instead of being sent.
- A response resolves to `{ data, status }`. A non-2xx response throws an error
  carrying the status and the response body. A 401 is not redirected to the
  login page; render the error in the plugin.
- `usePermissions()` is a hook and re-renders when permissions arrive. Use it,
  not an imperative read, to gate mutating controls: plugin pages are never
  write-gated by the host.

React, `react-dom`, `react-router`, `@tanstack/react-query` and
`@modelsphere/ui` come from the host. Import them normally and use named imports;
the build aliases them to the host's single instance. Do not bundle your own
copies.

## 5. Styles

Console links every `.css` file under the release's `frontend/` directory before
loading the entry. It does not merge or compile plugin styles, and it does not
compile `candidates.json` for you.

- If the plugin uses Tailwind utilities, build a stylesheet from the
  `candidates.json` emitted by the preset (the classes your source uses) and
  ship the result under `frontend/`, e.g. `frontend/my-plugin.css`.
- Ordering between two plugins' stylesheets is not guaranteed. Do not rely on
  another plugin's CSS, and keep selectors scoped to the plugin's own classes.
- Utility classes that Console's own stylesheet defines keep working, but treat
  that as a shared vocabulary, not a contract.

## 6. Add a backend

The backend is an ordinary Deployment and Service in the chart. What makes it a
plugin backend is the `ReverseProxy` Console reads at registration time:

```yaml
apiVersion: iam.theriseunion.io/v1alpha1
kind: ReverseProxy
metadata:
  name: my-plugin
  namespace: my-plugin-system
spec:
  matcher:
    method: "*"
    path: /api/my-plugin/*
  upstream:
    scheme: http
    host: my-plugin.my-plugin-system.svc
    port: 8080
  directives:
    authProxy: true
```

Registration requires every `ReverseProxy` in the release to satisfy:

- `matcher.path` starts with `/api/` and ends with `/` before the trailing `*`;
- `matcher.path` is neither `/api/*` nor under Console's own API (`/api/iam`, `/api/me`, `/api/router`, `/api/capabilities`), because plugin routes match before the native mux;
- `directives.authProxy: true`;
- `upstream.scheme` is `http` or `https`, `host` is non-empty, `port` is 1–65535.

Add an IAM role pair so users can reach the backend. Console authorizes each
request on resource `backends` with resource name equal to the plugin name:

```yaml
apiVersion: iam.theriseunion.io/v1alpha1
kind: IAMRole
metadata:
  name: my-plugin-reader
  labels:
    iam.theriseunion.io/scope: platform
    iam.theriseunion.io/scope-value: global
spec:
  rules:
    - apiGroups: [iam.theriseunion.io]
      resources: [backends]
      resourceNames: [my-plugin]
      verbs: [get]
---
apiVersion: iam.theriseunion.io/v1alpha1
kind: IAMRole
metadata:
  name: my-plugin-writer
  labels:
    iam.theriseunion.io/scope: platform
    iam.theriseunion.io/scope-value: global
spec:
  uiPermissions: [my-plugin.write]
  rules:
    - apiGroups: [iam.theriseunion.io]
      resources: [backends]
      resourceNames: [my-plugin]
      verbs: [get, create, update]
```

- Method to verb: `GET`/`HEAD`/`OPTIONS` → `get`, `POST` → `create`,
  `PUT`/`PATCH` → `update`, `DELETE` → `delete`.
- Without `get` on `backends/<name>`, the sidebar hides the module and a direct
  URL shows the forbidden state.
- `uiPermissions: [my-plugin.write]` is what `usePermissions()` sees as
  `my-plugin.write`; the plugin index also exposes it as `writePermission`.
- Console strips inbound `X-Remote-*` and `Cookie` and forwards
  `X-Remote-User` plus one `X-Remote-Group` per group. The backend must trust
  those headers and must not require the browser's cookie.

A frontend-only plugin needs no `ReverseProxy` and no IAM role. It appears in
the sidebar for every authenticated user who can load Console.

## 7. Capabilities

`provides` publishes values other packages can consume; `consumes` declares
what this package needs. The installer resolves bindings before Helm runs and
writes them into a temporary values file under
`consumed.<provider-group>/<provider-name>.<key>` with mode `0600`.

Read them from `values.yaml`:

```yaml
consumed:
  modelsphere.dev/platform:
    imagePullSecrets: []
  modelsphere.dev/swiss:
    endpoint: ""
    apiKeyRef: ""
    apiKeyKey: ""
```

Built-in providers:

| Capability | Keys |
| --- | --- |
| `platform.modelsphere.dev/image-pull-secrets` | `imagePullSecrets` |
| `platform.modelsphere.dev/inference-namespaces` | `inferenceNamespaces` |
| `swiss.modelsphere.dev/gateway` | `endpoint`, `apiKeyRef`, `apiKeyKey` |

A Secret value never crosses the boundary; `apiKeyRef` names a Secret and
`apiKeyKey` names its key. See
[plugin-platform-config.md](plugin-platform-config.md) for shadowing, `from`
pinning and the failure cases.

## 8. Build the frontend

```ts
// tsup.config.ts, next to Chart.yaml
import { definePluginConfig } from "@modelsphere/plugin-sdk/build";

export default definePluginConfig({
  name: "my-plugin",
  entry: "frontend/src/runtime.tsx",
  outDir: "frontend",
  cssSource: "frontend/src",
});
```

```sh
pnpm install
pnpm exec tsup --config tsup.config.ts
```

The preset emits `frontend/index.umd.js` (IIFE, React taken from the host) and
`frontend/candidates.json`. It reads `Chart.yaml` from the working directory to
inject `__PLUGIN_VERSION__`, so run it from the chart root. `cssSource` controls
which sources the class scanner reads; set it to `false` only for a plugin with
no JSX.

Keep the generated files out of Git and out of the package:

```gitignore
frontend/index.umd.js
frontend/*.css
frontend/candidates.json
```

```gitignore
# .helmignore
frontend/src
node_modules
.git
package.json
pnpm-lock.yaml
tsup.config.ts
```

If the chart lives in a subdirectory instead, build from a directory that has
the matching `Chart.yaml`, or stage the built files into the chart's `frontend/`
before packaging.

## 9. Validate, package, install

```sh
modelsphere plugin validate ./my-plugin
modelsphere plugin package ./my-plugin --destination ./dist
modelsphere plugin install ./dist/my-plugin-0.1.0.tgz --wait
```

`validate` accepts a chart directory or a `.tgz` and rejects a package without
`frontend/<entry>`, a chart name that is not kebab-case, a non-SemVer version,
an unknown `plugin.yaml` field, or an invalid `ReverseProxy`. `package` wraps
`helm package` and validates the generated archive; it does not build the
frontend, so build and copy first.

`install` runs `helm upgrade --install --atomic --wait` with every `consumes`
binding resolved, then reads the registrations and reports what it found:

```
Installed runtime: modelsphere.dev/my-plugin 0.1.0
Registered: Console serves the plugin.
```

A Chart that does not create the `Plugin` CR prints
`Registration is separate: create a Plugin CR to load it in Console.` instead;
see [Register](#10-register).

| Flag | Meaning |
| --- | --- |
| `--plugin-namespace` | release namespace; defaults to the Console namespace |
| `--console-release`, `--console-namespace` | Console release when discovery is ambiguous |
| `-f`, `--values` | extra values files |
| `--wait` | wait for the release (default `true`) |
| `--kubeconfig`, `--context` | cluster selection |
| `--timeout` | external command timeout (default `5m`) |
| `-v` | verbosity 0–10; credentials in commands and stderr are redacted |

## 10. Register

Registration belongs to the release. The Chart creates the `Plugin` CR, so
installing registers the plugin and uninstalling removes the registration with
the runtime. Add this template to the plugin's `templates/`:

```yaml
{{- $plugin := fromYaml (.Files.Get "plugin.yaml") -}}
apiVersion: modelsphere.dev/v1alpha1
kind: Plugin
metadata:
  name: {{ printf "%s--%s" $plugin.group $plugin.name | quote }}
spec:
  type: helm
  scope: platform
  enabled: true
  version: {{ .Chart.Version | quote }}
  chart:
    name: {{ .Chart.Name }}
    namespace: {{ .Release.Namespace }}
    releaseName: {{ .Release.Name }}
```

- `plugin.yaml` supplies the identity, so the CR and the Chart cannot disagree.
- `.Chart.Version` is the pinned release version. This removes the most common
  `Degraded` cause, a pin that no longer matches the installed Chart.
- The CRD comes from the Console Chart. On a cluster without it, or to keep a
  plugin out of Console on purpose, gate the template with a values key such as
  `registration.enabled` and install with it off.
- `spec.enabled` should be a Chart value too, e.g. `registration.active`. A
  `kubectl patch` would be reverted by the next upgrade; disable with
  `helm upgrade --set registration.active=false`.

Then read the status:

```sh
kubectl get plugin modelsphere.dev--my-plugin -o yaml
```

`status.phase` becomes `Installed` when the release, its chart files and its
routes all pass. Otherwise it is `Degraded` and `status.message` names the first
failed check; the plugin is not served. Console writes the status through the
CR's status subresource, so Helm upgrades do not disturb it.

A Chart that does not ship the CR—an older package, or a CR kept in Git—still
has the separate step:

```sh
modelsphere plugin registration ./dist/my-plugin-0.1.0.tgz | kubectl apply -f -
```

`enabled: false` unloads the plugin without uninstalling it. Deleting the CR
unloads it too; the release and its IAM resources stay until you uninstall.

## 11. Verify

| Check | Expected |
| --- | --- |
| `GET /plugins/index.json` | an entry with `id: my-plugin`, same-origin `entry` and `styles`, and `backend.prefix` |
| `GET /plugins/modelsphere.dev--my-plugin/index.umd.js` | 200, `Cache-Control: no-store` |
| sidebar | one entry, correct title and icon |
| module base path and each route pattern | pages render inside the host Router, Query and UI providers |
| `GET /api/my-plugin/...` as a permitted user | proxied response from the backend |
| the same request without `get` | 403 |
| backend scaled to zero | 502; the rest of Console keeps working |

The development fixture `web/test/plugin-runtime.html` loads the plugins a
running Console serves with the real host providers. It is not part of the
production entry and does not disable authentication.

## 12. Upgrade and remove

1. Bump `Chart.yaml` `version` (and `plugin.yaml` `version` if the product
   version changed), rebuild the frontend, and copy it under `frontend/`.
2. Run `modelsphere plugin install` again. The CLI upgrades the release with
   `--atomic`; a failed upgrade rolls back.
3. A Chart-managed CR follows the release, because `spec.version` is
   `.Chart.Version`; nothing else to edit. A CR managed outside the Chart pins
   the version by hand, and a pin that no longer matches leaves the plugin
   `Degraded` until it is updated.

```sh
modelsphere plugin uninstall modelsphere.dev/my-plugin --yes --wait
```

Uninstall deletes the Plugin CR first, then uninstalls the release. Without an
argument it lists registrations and asks for a selection.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Degraded`: `plugin release is not deployed` | install failed or was rolled back | `helm status <release> -n <namespace>` |
| `Degraded`: `installed Chart does not match registration` | CR `spec.version` or `chart.name` disagrees with the release | correct the CR |
| `Degraded`: `Chart plugin metadata does not match registration identity` | CR name decoded to a different `group`/`name` than `plugin.yaml` | rename the CR or fix `plugin.yaml` |
| `Degraded`: `frontend entry missing from installed Chart` | build output was never copied into `frontend/` | rebuild, copy, reinstall |
| `Degraded`: `plugin ReverseProxy must authenticate an /api/ prefix` | matcher path or `authProxy` is wrong | fix the template, upgrade |
| `Degraded`: `plugin ReverseProxy prefix … is reserved by console` | the route overlaps Console's own API | move it under the plugin's own `/api/` prefix |
| no sidebar entry, no status message | bundle threw during registration | open the browser console; the loader logs the plugin and the error |
| pages 404 but the menu exists | route pattern not registered or mistyped | check `routes` keys; `[id]`/`[...rest]` only |
| `Unsupported SDK route` | segment syntax other than `[param]`/`[...rest]` | rewrite the pattern |
| `Unsupported menu icon` | icon not in the allowlist | use `boxes`, `flask-conical` or `puzzle` |
| `Version mismatch: host … SDK …` | bundle built for another SDK major | rebuild against the Console version in use |
| API returns 403 | role lacks the verb, or the resource name differs from the plugin name | fix the `IAMRole` rules |
| API returns 502 | upstream unreachable or wrong service/host/port | check the Service and `ReverseProxy` upstream |
| styles missing | no `.css` under `frontend/` | ship a compiled stylesheet |
| module hidden for one user | that user lacks `get` on `backends/<name>` | grant the reader role |

## Related documents

- [plugin-architecture.md](plugin-architecture.md) — how Console discovers, serves and isolates plugins.
- [plugin-cli.md](plugin-cli.md) — the CLI reference.
- [plugin-platform-config.md](plugin-platform-config.md) — capability providers and bindings.
- [coding-conventions.md](coding-conventions.md) — Go, web and chart conventions.
