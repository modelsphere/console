# Single-cluster plugin applications

Console understands plugin declarations without reproducing Global's shell or multi-cluster platform.

Design discussion: [#145](https://github.com/modelsphere/console/issues/145).

## Revision: navigation belongs to compositions

The module-per-sidebar model is replaced by a shared entry registry and navigation compositions.

```text
built-in pages ----+
SDK menus --------+-> entry registry -> navigation compositions -> authorized navigation -> three layouts
SDK entries ------+                         |
                                      Console or a named application
```

| Concept | Responsibility |
| --- | --- |
| Provider | Owns components, routes, translations, backend capability and page permissions |
| Entry | Stable provider/name reference to a registered page; not an application or sidebar group |
| Composition | Orders groups and entry references independently of provider/module order |
| Legacy menu | Contributes a default Console placement; does not implicitly create an application |
| Scope | Platform/current-cluster execution context; does not decide whether a plugin is independent |
| Application | A named composition with accessible entries; its URLs select the active navigation |

- Console has a host-owned composition in one source file. It orders built-in groups and accepts legacy plugin menus; North Star/Canary remains in Console without package-name exceptions.
- Published Global navigation-composition declarations use the same resolver. The Dashboard composition, not its provider's scopes, supplies its application and sidebar.
- References never replace page components, permissions or backend checks. Missing providers produce no dead links; denied/hidden ancestors still suppress descendants.
- Provider business entries without placement remain registered routes, not automatically visible menus. Legacy `menus` retain their default placement.
- Built-in menu declarations are normalized once into the same registry, preserving existing route URLs and translation keys.
- No new HTTP endpoint, persisted configuration key, CRD field or authorization behavior. Editable administration UI is deferred; the host composition is the central source-level ordering entry.
- This replaces the former launcher inference and module-tree filtering implementation.

### Adjusting Console navigation

Edit the ordered `groups` and `menus` arrays in `web/src/shell/console-navigation.ts`. A group can reference built-ins and installed plugins together:

```ts
{
  name: "operations", title: "Operations",
  menus: [
    { provider: "console/inferences", entry: "index" },
    { provider: "modelsphere.dev/canary", entry: "canary" },
  ],
}
```

- References move navigation links, not provider pages or permissions.
- Uninstalled providers are omitted. Legacy menus without an explicit placement keep their default Console group.
- Dashboard ordering remains owned by its installed navigation-composition plugin; do not duplicate those links in the Console composition unless deliberately moving them into Console.

## Scope and behavior

| Concern | Decision |
| --- | --- |
| Cluster | Only Console's current cluster; no directory, selector or cross-cluster gateway |
| Console composition | `web/src/shell/console-navigation.ts` orders groups and entry references; edit arrays to reorder without changing providers |
| Legacy plugins | `menus` contribute default Console placements; `parent/group/order/children` remain compatible |
| Business providers | `entries` register reusable pages; only explicit references expose them in navigation |
| Named applications | A navigation composition supplies scope-specific title/icon/landing and groups; provider scopes alone never create one |
| Route context | The most-specific registered route selects Console or a named composition, including nested Console routes under an application's path |
| Identity | Keep every provider/entry alias even when page routes share a path; render a shared route only once |
| Ordering | Explicit references follow composition order; remaining legacy additions preserve sibling/group order, including children |
| Conflicting placements | Host explicit references win, then named compositions in stable id order, then legacy defaults; one route has one navigation placement |
| Permissions | Resolve references after backend capability filtering; check page permissions and all declared menu ancestors |
| Missing providers | Omit unresolved references and empty groups; do not create dead links |
| Appearance | All three layouts consume the same resolved tree; no Global dock, viewport policy or layout-specific menu implementation |

- Include Console as a return entry only when at least one named application has an accessible static landing.
- Declared landings select an accessible referenced page in the same context; otherwise use the first accessible static reference.
- Registered but unplaced business pages remain guarded routes. They do not become default menus or independent applications.
- Never rewrite provider pages to apply a composition. Components, translations, route guards and backend ownership remain with providers.
- Group identity is stable and independent of translated titles; duplicate labels or one composition's multiple groups do not collide.
- The switcher closes on selection, outside click and Escape; its accessible name includes the current application.

## API and security

- Navigation revision adds no HTTP endpoint, CRD field, chart value, persisted configuration or SDK method.
- Continue accepting the existing SDK `registerNavigationComposition` contract and provider/name references.
- Keep current authentication, authorization, backend proxies and namespace collision validation unchanged.
- RoleTemplates are installed only; no RoleTemplate reader, aggregation or new authorization mode.

## Rollout

### Dashboard installation experiment

- Install the unmodified Global Dashboard Chart with environment-specific values; reuse its UMD entry and embedded application.
- Accept `imageContract: v1` and ship the upstream RoleTemplate CRD for Helm installation only. Do not read RoleTemplates, aggregate roles or change Console's authorizer.
- Adapt business entries into Console navigation. Support composition references without copying Global's viewport or dock.
- Expose `cluster/current` as a single-cluster SDK context. The `/clusters/{value}/oapis/` prefix is a compatibility alias: its value never selects a target cluster.
- Authenticate API proxies and retain the existing backend authorization. Use the existing administrator for this experiment; ordinary-user permission parity is out of scope.
- Allow only plugin-owned GET static proxies without authentication; never forward the caller's credentials to public assets.
- Validate installation, original page loading and actual resource API responses separately. Monitoring, GPU extensions and terminal parity are not acceptance requirements.
- No RoleTemplate controller, new authorization mode, cluster directory or cross-cluster forwarding.

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 1 | Shared entry registry and composition-driven navigation | Legacy plugins remain in Console; built-ins and plugins share ordering; only compositions create independent applications |
| 2 | Current-cluster Dashboard integration | Unmodified Chart installs; original resource lists/details display data from the current cluster with existing backend authorization |
| 3 | Dashboard optional functions | Logs, monitoring and terminal validated against actual backend dependencies and authorization boundaries |

The adapter handles these upstream differences:

- Accept the supported image contract while retaining strict metadata validation.
- Materialize provider-owned business entries; optional compositions arrange their sidebar groups.
- Supply a local cluster context and normalize cluster-prefixed API paths before route matching.
- Keep API requests behind existing authentication/authorization; public GET assets are plugin-owned and carry no caller credentials.
- Export the shared `EmptyState` UI contract used by upstream loading-failure, unavailable and forbidden branches. The component and state model are ported from `theriseunion/rise-global` design at `2be16f2c7bfa43e8dc2e5a90f936008d963888e4`; missing this export otherwise turns a recoverable plugin error into a shell-wide React render failure.
- Leave upstream dependencies unchanged. Disable environment-specific optional Chart resources through installation values, not source edits.

### Verified installation

| Artifact | Version / provenance |
| --- | --- |
| Dashboard plugin Chart | `rise-plugin-k8s-dashboard` 0.5.89 |
| Menu composition Chart | `rise-plugin-menu-k8s-cluster-management` 0.1.6 |
| Upstream source | `theriseunion/rise-global-extension` commit `51d4dceffaa1e7babc5cfa0ca30cb52f4f0b0314` |
| Dashboard backend dependency | `oci://quanzhenglong.com/helm-charts/k8s-dashboard:3.0.1-6d51bbb` |
| Embedded static image | Upstream Chart appVersion 0.5.45 |

- Both Charts and published bundles are unchanged; Console's fixtures pin the original UMDs for regression tests.
- Install the RoleTemplate CRD before Helm. No RoleTemplate reader or role aggregation runs in Console.
- On a cluster without Global's manager labels, override the dependency's node affinity in installation values. A null affinity is restored from dependency defaults during Helm coalescing; verify the rendered Deployment before installation.
- The test cluster disables `vastCA`, `serviceMonitor`, `prometheusRule`, and `k8s-dashboard.vast` through existing values. Its Prometheus URL and gateway NetworkPolicy selectors use that cluster's actual services and Console labels.
- Install with `modelsphere plugin install`; generate registrations with `modelsphere plugin registration`, then apply those declarations. Do not patch status or grant additional permissions.
- Local verification runs the current Console with `go run`, the existing IAM store and signing Secret. Standard service port-forwards plus an HTTP proxy provide cluster DNS connectivity on the laptop; these are development networking only, not product code or replacement upstreams.
- The deployed older Console is not upgraded by this test; it does not understand the new metadata and can report a degraded registration until the compatible Console is deployed.

Observed browser checks use original pages and actual API responses:

- Application launcher opens the original overview; node and Pod counts match resource lists.
- Console and Dashboard have separate sidebars; switching, refresh and back/forward preserve route-derived application ownership.
- Pod list pagination, Pod detail, detail URL refresh, and detail-to-sidebar list navigation work.
- Minimal, classic and mixed-nav layouts load the same original page at desktop and mobile widths, without document-level horizontal overflow.
- Metrics and GPU integration remain outside this acceptance scope. Pod terminal verification is recorded separately below.

### Pod terminal origin configuration

The original backend checks WebSocket origins before authentication; proxied installations must declare trusted Console origins through the existing Chart contract.

```yaml
global:
  rise:
    console:
      origins:
        - https://console.example.com
```

- Set this to the actual browser-facing scheme, host and port in installation values, then install or upgrade the unmodified plugin Chart with Helm.
- This is explicit installation configuration; Console does not currently discover or inject these origins automatically.
- Without it, the backend compares the browser Origin with its internal Service Host and rejects the terminal handshake with 403. Do not rewrite Origin, disable this check or grant permissions to work around it.
- Local verification used the existing administrator and the browser-facing local test origin. The handshake returned 101; the original Pod terminal accepted `printf` and `pwd`, displayed their output and returned to its shell prompt. Refreshing the detail URL established a new terminal session successfully.
- Negative handshake checks still returned 403 for a foreign or missing Origin and 401 for an unauthenticated caller. Console authentication, authorization, plugin sources and published bundles were unchanged.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| Copy Global's dock and scope selectors | Introduces a multi-cluster product model that Console does not need |
| Add a hard-coded Dashboard button | Does not provide a reusable plugin entry mechanism |
| Treat every cluster declaration as platform | Silently changes context while the original bundle still calls cross-cluster APIs |
| Remove permission checks to get a working page | Turns privileged Kubernetes operations into a shell authorization bypass |

## Verification

1. Registration tests for declaration validation, entry aliases, path ownership and rollback isolation.
2. Composition tests for cross-provider/built-in references, independent ordering, mixed scopes, hidden ancestors, explicit landings and nested Console routes.
3. Browser checks for opening, selection, Escape/focus, localization and mobile layout across all three shells.
4. Full web/SDK tests, typechecks and the Console production build.
