# Plugin architecture

A plugin adds pages and a backend API to Console without rebuilding it. It ships
as a Helm chart that contains `plugin.yaml`, a built frontend bundle and the
templates for its own workloads. Installing the chart and registering it are two
separate operations: Helm creates the runtime, and a `Plugin` custom resource
tells Console which installed release is a plugin. Console only observes. It
does not install, upgrade or uninstall anything.

## Three artifacts

```
<chart>/
  Chart.yaml             chart name and SemVer version
  plugin.yaml            product identity and integration contract
  frontend/
    index.umd.js         the module Console loads (required)
    index.css            optional; every .css under frontend/ is linked first
  templates/             Deployment, Service, ReverseProxy, IAMRole, ...
  values.yaml
```

| Artifact | Declares | Read by |
| --- | --- | --- |
| `Chart.yaml` | chart name, SemVer version, `type: application` | Helm; the registry matches it against the CR |
| `plugin.yaml` | identity, product version, frontend entry, capabilities, optional policy | `plugin validate/package`, the registry |
| `frontend/` | the module and its styles | the registry and the asset handler |
| `templates/` | runtime and the `ReverseProxy` | Kubernetes |

`plugin.yaml` is strict. Unknown top-level fields are rejected, so a typo fails
validation instead of being ignored. The package validator also requires
`frontend/<entry>` to exist inside the chart; a package that Console could never
load is refused before Helm runs.

## Components

```
plugin repository          cluster                                browser
-----------------          -------                                -------
chart + plugin.yaml  --helm--> Helm release (runtime workloads)
                                        |
                                        | Plugin CR (group--name)
                                        v
                                  Console registry              /plugins/index.json
                                  informer, read-only    ----->  /plugins/<cr-name>/*
                                        |                       |
                                        |                       v
                                        |                 SPA loader -> SDK -> module
                                        |
                                        +--ReverseProxy--> plugin backend (/api/...)
```

| Component | Responsibility |
| --- | --- |
| Plugin CR | names the installed chart, version, namespace and release; carries `enabled` |
| Console registry | watches CRs, reads the Helm release and its chart files, keeps an immutable snapshot |
| Asset handler | serves the chart's `frontend/` files at `/plugins/<cr-name>/` |
| SPA loader | fetches the index once, loads each bundle, registers its module and extensions |
| Backend proxy | forwards declared `/api/` prefixes after Console authentication and IAM authorization |
| Plugin chart | owns Deployments, Services, the `ReverseProxy` and the IAM roles |

## Identity

`plugin.yaml` defines the identity as `group/name`; both are DNS-1123
subdomains. The CR name is that identity with `--` between the two parts, so a
plugin `modelsphere.dev/canary` registers as `modelsphere.dev--canary`. If a part
itself contains `--` or starts with `x-`, it is base32-escaped with an `x-` prefix
so the split stays unambiguous. Console parses the CR name back and rejects one
that does not round-trip.

The same identity appears in three places and must agree:

| Place | Field |
| --- | --- |
| CR | `metadata.name` (encoded identity) |
| `plugin.yaml` | `group`, `name`, `apiVersion: v1` |
| API authorization | backend resource name, equal to `plugin.yaml` `name` |

`plugin.yaml` `version` is the product version. It is independent of the Helm
chart version and appears in `plugin list` and the plugin index. The chart
version is what `spec.version` pins.

## Registration contract

`Plugin` is cluster-scoped (`modelsphere.dev/v1alpha1`).

```yaml
apiVersion: modelsphere.dev/v1alpha1
kind: Plugin
metadata:
  name: modelsphere.dev--canary
spec:
  type: helm
  scope: platform
  enabled: true
  version: 0.4.0
  chart:
    name: canary
    namespace: canary-modelsphere-system
    releaseName: canary
```

| Field | Meaning |
| --- | --- |
| `type` | `helm` only. `in-process` and other types are rejected on this path |
| `scope` | `platform` only. Workspace-scoped registrations are rejected |
| `enabled` | `false` removes the entry, its menus and its routes; the release and IAM stay |
| `version` | optional; when set, the installed chart version must match it |
| `chart.name` | chart name, not the product name |
| `chart.namespace` | namespace of the release; required |
| `chart.releaseName` | release name; defaults to the CR name |
| `chart.timeout` | Go duration for installer/controller Helm operations; omitted or non-positive means 5 minutes |
| `values` | Helm value overrides, used by an installer; Console ignores them |

The registry loads an entry only when every check passes.

| Check | Failure |
| --- | --- |
| CR name parses to an identity | `invalid ModelSphere plugin identity` |
| scope is empty or `platform` | `workspace-scoped registrations are not supported by this Console` |
| type is `helm` | `only installed Helm registrations are supported` |
| `chart.namespace` is set | `spec.chart.namespace is required` |
| the Helm release can be read | `read installed plugin release: ...` |
| release status is `deployed` | `plugin release is not deployed` |
| chart name matches, and version when pinned | `installed Chart does not match registration` |
| `plugin.yaml` parses as v1 | `parse Global plugin metadata: ...` |
| identity and `apiVersion` match the CR | `Chart plugin metadata does not match registration identity` |
| frontend is `component` + `remote` | `plugin requires a remote component frontend` |
| the declared entry exists in the chart | `frontend entry missing from installed Chart` |
| every `frontend/` asset path is valid | `invalid frontend asset "..."` |
| every `ReverseProxy` matches the backend rule | `plugin ReverseProxy must authenticate an /api/ prefix` |
| every `ReverseProxy` upstream is valid | `invalid plugin ReverseProxy upstream` |

A failure writes `status.phase: Degraded` with the message and removes the
entry. The plugin's assets and API disappear; the release keeps running.

## Status

Console writes `Installed` (with `releaseName`, `releaseVersion`, the parsed
`pluginMeta` and `frontendStatus`) or `Degraded` (with `message` and
`frontendStatus.distributed: false`). `Pending`, `Installing`, `Upgrading`,
`Failed` and `Uninstalling` belong to an installer or controller that performs
Helm operations; Console does not write them.

Status is diagnostic. Each Console replica keeps its own in-memory snapshot and
serves from it; a status write does not change what another replica serves.
`/readyz` returns 503 until the first informer sync completes, so a pod does not
receive traffic before it knows the registered plugins.

Disabling or deleting the CR removes the entry on the next watch event. No
Console restart is needed. Open tabs keep what they loaded until refreshed.

## Serving the frontend

The SPA fetches `/plugins/index.json` once at boot with `cache: no-store` and a
15-second timeout. Each descriptor points at files Console serves from the
installed chart.

```json
[
  {
    "id": "canary",
    "group": "modelsphere.dev",
    "version": "0.4.0",
    "entry": "/plugins/modelsphere.dev--canary/index.umd.js",
    "styles": ["/plugins/modelsphere.dev--canary/index.css"],
    "backend": {
      "name": "canary",
      "prefix": "/api/canary",
      "writePermission": "canary.write"
    }
  }
]
```

| Field | Source |
| --- | --- |
| `id`, `group`, `version` | `plugin.yaml` `name`, `group`, `version` |
| `entry`, `styles` | files under the chart's `frontend/`; every `.css` is listed, sorted |
| `backend` | the first `ReverseProxy`; prefix is its matcher path without `/*` |

The loader loads descriptors in order. For each one it appends the stylesheets,
then the entry script, waits for each request, and lets the entry register
through the SDK. A registration error or a failed request rolls back that
plugin's extensions and removes its elements; the remaining plugins still load,
and the error is reported in the browser console.

Assets are served only from the chart's `frontend/` directory. Names must be
valid relative paths without `\?#%:`, responses carry `Cache-Control: no-store`,
and the handler is reachable without a Console session: only `/api/` and
`/oauth/` require authentication. The bundle is public code, never a place for
secrets.

## Frontend contract

The entry is a UMD/IIFE bundle. Before loading it, the host sets
`window.__MODELSPHERE_SDK__` (also `__GLOBAL_SDK__` and `__RISE_SDK__`) to the
same object. The bundle registers with `createPlugin()` and nothing else; the
host supplies React, `react-dom`, `react-router`, `@tanstack/react-query` and
`@modelsphere/ui`, so the bundle must not carry its own copies.

The SDK and host agree on a major version. The host reports `VERSION: "1.0.1"`;
a bundle built for another major is refused with a message naming both versions.

Navigation comes from the registration, not from `plugin.yaml`:

| Rule | Behavior |
| --- | --- |
| one visible menu | the first menu without `hidden: true` becomes the module: title, base path, icon, sidebar entry |
| all other menus | ignored for navigation; they do not create sidebar entries |
| `routes` | every pattern becomes a page under the module base path; the menu path is not duplicated |
| route patterns | literal segments, `[param]` → `:param`, `[...rest]` → `*`; anything else throws |
| icons | `boxes`, `flask-conical`, `puzzle`; any other name fails the plugin |
| one module per plugin | the module id is `plugin.yaml` `name`; a duplicate id or base path fails `validateModules` |

A plugin with a backend inherits a capability check: the sidebar hides the
module unless the user has `get` on `backends/<name>`, and a direct URL shows
the forbidden state. The module's pages are never write-gated (`requiresWrite`
is always false), so a plugin that offers mutations must hide or disable them
itself with `usePermissions()`.

Styles are the plugin's responsibility. Console links every `.css` file found
under `frontend/`, in the order listed in the index; it does not merge or
compile plugin styles. Classes that also exist in Console's own stylesheet keep
working, but anything only the plugin uses needs its own compiled stylesheet.
Tailwind's ordering guarantee does not cross stylesheet boundaries, so do not
rely on another plugin's file.

## Backend contract

A plugin may declare zero or more `ReverseProxy` objects in its chart. Console
uses three parts of each: `spec.matcher`, `spec.upstream` and
`spec.directives.stripPathPrefix`. Other directive fields are ignored on this
path.

```yaml
apiVersion: iam.theriseunion.io/v1alpha1
kind: ReverseProxy
metadata:
  name: canary
  namespace: canary-system
spec:
  matcher:
    method: "*"
    path: /api/canary/*
  upstream:
    scheme: http
    host: canary-canaryd.canary-system.svc
    port: 8080
  directives:
    authProxy: true
```

Registration requires each route to satisfy all of:

- matcher path starts with `/api/` and ends with `/` before the `*`;
- `authProxy: true`;
- upstream scheme is `http` or `https`, host is non-empty, port is 1–65535.

The first matching route wins. Console trims `stripPathPrefix` from the request
path before forwarding; with no prefix the upstream sees the original path.

Requests under `/api/` are authenticated by Console first. Authorization then
checks IAM on resource `backends` with resource name equal to `plugin.yaml`
`name`:

| Method | Verb |
| --- | --- |
| `GET`, `HEAD`, `OPTIONS` | `get` |
| `POST` | `create` |
| `PUT`, `PATCH` | `update` |
| `DELETE` | `delete` |

Console strips inbound `X-Remote-*` and `Cookie`, sets `X-Remote-User` and one
`X-Remote-Group` per group, and forwards the session as `Authorization: Bearer`
when the browser only had a cookie. An unreachable upstream answers 502 and
leaves the rest of Console working. SSE and chunked responses stream as they
arrive.

The plugin's frontend uses the SDK `ApiClient`, which accepts same-origin
absolute paths only, attaches the session and throws `ApiError(status, detail)`
on a non-2xx response. A 401 is not redirected to the login page; the plugin
shows the error.

## Capabilities

`provides` and `consumes` move host-owned values into a plugin without copying
credentials into its package. A provider publishes a capability name, a schema
version (`v1`) and a map from published key to a path in its own values. A
consumer binds by name and optional version, optionally pinning a provider with
`from`.

Three capabilities are supplied by the platform before a plugin provides them:

| Capability | Provider | Published keys |
| --- | --- | --- |
| `platform.modelsphere.dev/image-pull-secrets` | `modelsphere.dev/platform` | `imagePullSecrets` |
| `platform.modelsphere.dev/inference-namespaces` | `modelsphere.dev/platform` | `inferenceNamespaces` |
| `swiss.modelsphere.dev/gateway` | `modelsphere.dev/swiss` | `endpoint`, `apiKeyRef`, `apiKeyKey` |

A registered plugin that declares the same capability shadows the built-in. The
installer resolves every binding before Helm, fails on no provider or an
ambiguous one, and writes the result under
`consumed.<provider-group>/<provider-name>.<key>` in a temporary values file with
mode `0600`. The file and the package never contain a Secret value; only a
Secret name or a URL may cross the boundary. See
[plugin-platform-config.md](plugin-platform-config.md) for the full rules.

Capability resolution happens at install time. A `Plugin` CR does not carry the
resolved values, so a plugin installed directly with Helm must receive the same
keys through its own values.

## Failure isolation

| Failure | Observable result |
| --- | --- |
| CR disabled or deleted | entry, menu, routes and assets disappear on the next watch event |
| release not deployed, or chart mismatch | `Degraded` with the message; no entry |
| invalid `plugin.yaml` or missing entry | `Degraded`; no entry |
| bundle throws during registration | that plugin is rolled back; other plugins load |
| backend unreachable | `/api/<prefix>` answers 502; built-in pages continue |
| Console replica restarts | snapshot reloads from CRs and releases; no plugin action required |

## Related documents

- [plugins.md](plugins.md) — build and deploy a plugin.
- [plugin-cli.md](plugin-cli.md) — CLI reference.
- [plugin-platform-config.md](plugin-platform-config.md) — capability bindings.
- [../console-design.md](../console-design.md) — Console's overall design.
