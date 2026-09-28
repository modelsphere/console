# console — design

## What this is

The ModelSphere community portal. A full-stack BFF that **owns identity** and
**federates everything else**. It exists because the open-source inference stack
(swiss and friends) has no user management, login, or unified entry point.

## Why a separate service (not part of swiss)

swiss is a deploy control plane: near-stateless, "the cluster is the only source
of truth." Identity is the opposite — users, roles and sessions are data the
portal owns. Keeping them apart lets swiss stay a backend and lets the portal be
the front door for many backends, mirroring Rise Global's apiserver/console
split.

## Wire-compatibility with Rise Global (the upgrade path)

The identity layer is deliberately a subset of Global's, kept compatible so a
community install can be upgraded to the commercial Global without a migration:

| Surface        | Kept identical to Global                                   |
|----------------|------------------------------------------------------------|
| User/role data | `iam.theriseunion.io/v1alpha1` User, IAMRole, IAMRoleBinding CRDs |
| Tokens         | OAuth2 password grant, HS256 JWT, same claim set           |
| Authorization  | K8s-RBAC-shaped, `system:masters` short-circuit, platform scope only |

Upgrade = share the JWT secret and point the identity endpoints at Global's
apiserver. The console frontend contract does not change.

**Decision (2026-09-26): the API group stays `iam.theriseunion.io`.** A separate
group (`iam.modelsphere.dev` was considered) would isolate the two products but
turn the upgrade into a data migration. Consequences of sharing it:

- On a cluster where Global runs (e.g. a member cluster), console and Global read
  and write the **same** users, roles and bindings. That is the upgraded state,
  not a conflict; the helm chart leaves existing CRDs untouched.
- Those CRDs hold roles for every Global scope (platform, workspace, cluster,
  namespace, nodegroup) side by side. Console guards only platform-level things,
  so its authorizer honours only bindings labelled `scope=platform`,
  `scope-value=global` -- Global's own selector at that level. Anything else
  would let a namespace admin act as a console admin.
- The seeded `admin` matches Global's (group `system:masters`, same default hash).

## Architecture

```
browser ─▶ web (Vite / React 19 / Tailwind 4 / @riseaicloud/ui)
             shell: login, layout, sidebar, route guards
             modules: iam, swiss, playground, router, … (src/modules/*)
                     │  same-origin /oauth, /api/iam, /api/deploy, /api/llm…
                     ▼
             console (Go BFF)
               internal/iam      identity kernel: CRD types + OAuth2 (HS256) + RBAC
               internal/gateway  resolves the inference entrypoint from the cluster
               internal/server   mux + auth middleware + static SPA
                                 + backend proxy (proxy.go)
                     │
                     ▼  HTTP: X-Remote-User / X-Remote-Group + Bearer JWT,
                        or the backend's own key (apiKeyEnv, or the gateway's
                        Secret read at runtime)
             swissd, llm-openresty, and other backends
```

Users and roles are read/written as **CRDs via the dynamic client** — no scheme,
no generated clients, one less thing to keep in sync with Global.

The web stack pins the same versions as `swiss/web`, so swiss pages compile here
unchanged. Moving either one moves both.

## Modules

The console is a shell plus compile-time modules. A module is a feature area
(iam, swiss, playground, router, later container management); the shell owns everything
around it.

| Owned by | What |
|---|---|
| shell (`web/src/shell/`) | login, password reset, layout, sidebar, route guards, query client, session on every request |
| module (`web/src/modules/<id>/`) | its pages, its API client, its overview cards |
| `web/src/modules/index.ts` | which modules are installed, in sidebar order — plug in/out = one line |

A module exports one declaration (`ConsoleModule`, `web/src/shell/module.tsx`):

```ts
export const swissModule: ConsoleModule = {
  id: "swiss",
  title: "模型部署",            // sidebar group
  basePath: "/swiss",          // every page mounts below it
  overview: SwissOverview,     // optional cards on the home page
  pages: [
    { path: "", element: <Deployments />, permission: "swiss.view", menu: { label: "部署", icon: Rocket } },
    { path: "catalog/:name", element: <Model />, permission: "swiss.view" },
  ],
};
```

Rules:

- A module imports from `@/shell` only, never from a file under it or from another module.
- `permission` is a UI permission (a Role's `uiPermissions`); it guards the route and hides the menu entry.
- Links go through `useModulePath()`: `p("catalog")` → `/swiss/catalog`. A leading `/` is still relative to the module.
- API calls go through `apiFetch` (drop-in `fetch` with the session) or `request<T>` (JSON helper).
- `validateModules` rejects duplicate ids/basePaths, shell-reserved paths and pages declared twice at startup.

Deliberately not built: runtime loading, micro-frontends, cross-module slots. The
earlier Cordis design (branch `docs/console-plugin-design`) is parked; revisit it
when one of those is actually needed.

## Backends

Each module's backend is a `backends` entry; console proxies it after login.

```
browser  /api/deploy/catalog  ──▶ console
   authenticate (token) ─▶ password-reset guard ─▶ RBAC: verb on backends/<name>
   strip client X-Remote-*, Cookie; set X-Remote-User, X-Remote-Group, Bearer
                             ──▶ swissd  /api/catalog
```

| Aspect | Behaviour |
|---|---|
| Path | prefix replaced by the url's path (`/api/deploy` + `http://swissd/api`) |
| Prefix | must be under `/api/` (that is what puts it behind login), not `/api/iam` or `/api/me` |
| Authorization | resource `backends`, resourceName = backend name; GET/HEAD/OPTIONS `get`, POST `create`, PUT/PATCH `update`, DELETE `delete` |
| Identity | `X-Remote-User` / `X-Remote-Group`, as Rise Global's apiserver sets for a ReverseProxy — a backend runs unchanged behind either |
| Credential | `apiKeyEnv` names an environment variable console sends as `Authorization: Bearer <value>`, replacing the caller's token. The browser never sees it. Empty means the token is forwarded unchanged. swissd does not read console's JWT: behind console it runs with `server.auth.disabled` and trusts console's RBAC |
| Streaming | flushed as it arrives (SSE, chunked progress) |
| Backend down | JSON `502` |

A backend must trust `X-Remote-*` only from console (network policy / mTLS),
never from browsers.

In-cluster, a static backend's credential comes from a Secret rather than the
chart's values: `helm/console` renders an env entry per `backendSecrets` key. A
variable that is named but unset is logged at startup and the request goes without
it — console starts, and the backend answers `401`, rather than the pod refusing
to boot.

### A backend that resolves itself (`gateway`)

Naming an inference gateway in a values file means copying three things that all
move: the Service address, which route serves every deployed model, and the key.
The first goes stale when the gateway is reinstalled, the second lies about what
is deployed the moment a model is added, and the third ends up in release history
or in a second copy that nobody rotates.

So the `llm` backend names *where the truth is* instead:

```yaml
backends:
  - name: llm
    prefix: /api/llm
    gateway:
      profile: llm/site-profile          # swiss's site profile, "namespace/name"
      # ...or, with no swissd:
      # configMap: llm/openresty-conf    # route keys: session_route_<route>.conf
      # service: llm/openresty           # the entrypoint
      # route: llm-gateway               # optional: pin one route
      # secretRef: llm/openresty-keys    # optional: override where the key lives
```

| Step | Where it comes from |
|---|---|
| Entrypoint | profile `route.nginxService` + `route.nginxPort` (default 8080) → `http://<name>.<ns>.svc:<port>` |
| Routes | every `session_route_<route>.conf` in the ConfigMap, aggregate ones (`peers_by_model`, serving several models) first; `route:` pins one. Which route serves which model is not in the ConfigMap -- see "Models across routes" |
| Key | profile `route.auth.secretRef`/`secretKey` (default entry `keys`, format `key1:owner1,…`; the first key is used), sent as `Authorization: Bearer <key>` — llm-openresty accepts nothing else. A bare Secret name means the entrypoint's namespace |
| Overrides | `apiKeyEnv` (a copied key in the console's namespace), and `route` |

Resolution is cached for 30s and re-read after that, so a model deployed later
appears without redeploying the console; a refresh that fails keeps the last good
answer and logs it, because a transient API error should not take inference down.
An entrypoint that has *never* resolved answers `502` with the reason
(`backend llm: site profile llm/absent: not found`) instead of a confusing 404.

RBAC follows the references: `helm/console` renders one read-only Role and binding
per namespace they name, on `configmaps` and `secrets`. No `resourceNames`,
because the profile is what names the route ConfigMap and the key Secret, and a
chart cannot know at render time what a ConfigMap will say later. Nothing reads
the Service: the address is assembled from the reference.

## Playground

The Playground is chat against the inference gateway, for the question a
deployment page cannot answer: does this model actually generate? swissd's own
chat probe is one prompt, 32 tokens, non-streaming, and it lives on a release;
the Playground is a conversation, streaming, for anyone with the permission.

| Concern | Decision |
|---|---|
| Where it runs | `web/src/modules/playground/`, mounted at `/playground`; both pages are lazy-loaded (Markdown and highlighting are most of the weight) |
| Pages | `/playground` — one conversation; `/playground/compare` — 2–4 columns, one prompt sent to every column, shared parameters in a dialog |
| Which backend | `llm` → the gateway, resolved from the cluster; one picker lists every model on every route (see "Models across routes") |
| Gateway key | read by console from the Secret the site profile names (or `apiKeyEnv`). Never in a values file, never in a chart value, never in the browser |
| Conversation identity | each conversation (each column, in compare) sends its own `X-Session-Id`; the gateway pins it to one engine, so its prefix cache stays warm across turns |
| Parameters | system prompt, temperature, top_p, max_tokens, seed, stop (one per line), frequency/presence penalty, reasoning_effort; an empty field is left out of the request, so the engine's default applies |
| Token counts | the page sends `stream_options.include_usage`: openresty injects it only on aggregate routes, and autoconfig's per-model routes are not |
| Stats per answer | TTFT, total time, input/output tokens, tok/s over the decoding window (after TTFT), and cache hit rate = `prompt_tokens_details.cached_tokens / prompt_tokens`, shown only when the engine reports it |
| Reasoning models | `delta.reasoning_content`, or a leading `<think>…</think>` in content, is shown in a collapsible block above the answer |
| Reasoning in history | never sent back: the next turn's history carries only the answer, as the OpenAI-style APIs expect |
| View code | cURL / Python / Node.js reproducing the current request against `<origin>/v1`, key read from `$MODELSPHERE_API_KEY` — an API key an admin issued (see Router) |
| Access | UI permission `playground.use` guards the pages; the backend needs `get` **and** `create` on `backends/llm` (models are a GET, completions a POST) |

A user therefore needs a role carrying both:

```json
{"uiPermissions": ["playground.use"],
 "rules": [{"apiGroups": ["iam.theriseunion.io"], "resources": ["backends"],
            "resourceNames": ["llm"], "verbs": ["get", "create"]}]}
```

### Models across routes

The modelsphere stack's gateway is fed by autoconfig: one plain route per model
(`session_route_<model>.conf`, `peers` only), and no route that lists them all.
Console makes one model list and one endpoint out of it:

```
resolve (30 s): ConfigMap keys -> routes [aggregate..., plain...]
index (per backend): GET <gateway>/<route>/v1/models for every route, in parallel
                     model -> first route listing it
request: GET /v1/models          -> answered from the index
         anything with "model"   -> <gateway>/<route of that model>/...
```

| Concern | Decision |
|---|---|
| Freshness | the index is kept 30 s and refreshed behind a stale answer; an unknown model re-asks at once (at most every 2 s), so a model deployed a moment ago works on its first request |
| A route that does not answer | left out, not fatal. openresty loads a route up to a minute after autoconfig writes it and answers 502 until then, so a list missing a route is re-asked after 2 s instead of 30 s |
| Same model on two routes | the first wins; aggregate routes come first, so a hand-written aggregate route beside autoconfig's is preferred |
| No model in the request | fine with one route, 400 with several |
| Unknown model | `/api/llm`: 400 listing what is served; `/v1`: 404 `model_not_found`, as OpenAI answers |
| Scoped keys | `/v1/models` and `/v1/models/<id>` are answered by the router from the index, filtered by the key; nothing is rewritten on the way back |
| Replicas | each keeps its own index; a route added or removed is seen by all within one resolve (≤ 30 s) |

Pointing an install at the stack's gateway:

```yaml
playground:
  gateway:
    configMap: llm-route/openresty-conf
    service: llm-route/openresty
    secretRef: llm-route/openresty      # the openresty chart's key Secret, if auth is on
```

Verified on daocloud-ce against the stack's own charts (helm-charts openresty
0.1.20 + autoconfig 0.4.0, ModelRoute `routing.modelsphere.dev`): two llama.cpp
engines, two ModelRoutes, two plain routes. The Playground lists and chats with
both, with token stats; `/v1` routes each model to its engine through the OpenAI
SDK; a key scoped to one model sees and uses only it; deleting and recreating a
ModelRoute is followed by both replicas.

## Router

The router is how programs reach the models: `/v1`, opened by API keys admins
issue. It is its own domain -- `internal/router`, the `router` web module,
`/api/router` -- not part of iam: a key authorizes inference, not a console
user. console owns the keys; the gateway keeps its single key and is not
changed.

```
client --Bearer ms_…--> console /v1 --gateway key--> llm-openresty
                         verify key (hash, expiry)
                         read body (capped) -> check `model` against the key
```

| Concern | Decision |
|---|---|
| Endpoint | `/v1/*` → the backend `router.backend` names (`llm`), resolved like it; `Authorization`, `Cookie`, `X-Remote-*` stripped, the backend's credential added; `X-Session-Id` passes unchanged; streams as it arrives |
| Errors | OpenAI envelope (`{"error":{"message","type","code"}}`): 401 `invalid_api_key` / `expired_api_key`, 403 `model_not_allowed`, 413 `request_too_large`, 502/503 when the gateway or the key store is unavailable |
| Format | `ms_<16 hex id>_<32 hex secret>`; the list shows `ms_<first 4 of id>***` |
| Hashing | salted SHA-256 of the secret. The secret is 128 random bits, so a slow hash buys nothing and would cost CPU on every inference call |
| Issuing | `/api/router/apikeys` list/create/delete, RBAC resource `apikeys` — system:masters unless a role grants it; the page (路由 → API 密钥) needs UI permission `apikeys.view`. The plaintext is in the create response only |
| Expiry | 7, 30 or 180 days, or never; nothing else is accepted |
| Model scope | none = every model. A scoped key: JSON bodies must name an allowed `model`; a request naming none (multipart, files) is refused; `GET /v1/models` is filtered to the allowed ones |
| Body cap | `router.maxBodyBytes`, default 16 MiB — the body is read whole to find `model` |
| Storage | one Secret `<release>-api-keys` in console's namespace, one entry per key id holding its JSON. console creates it; the chart never owns it, so upgrade/rollback/uninstall leave issued keys alone. No CRD in the shared `iam.theriseunion.io` group |
| Replicas | each replica caches the keys: re-read every 10 s, and at most once a second for an unknown key. A key deleted elsewhere keeps working here for up to 10 s; a failed re-read keeps the last good set |
| Writes | create and delete only, each a read-modify-write retried on resourceVersion conflicts. Usage is never written back: see Router metrics |
| Availability | console is now on the inference path: 2 replicas by default, spread across nodes, PDB `maxUnavailable: 1`; on SIGTERM `/readyz` fails, 5 s for endpoints to catch up, then up to 60 s for in-flight generations (`terminationGracePeriodSeconds: 75`) |

### Router metrics

Usage is observed, not stored: writing "last used" to the keys' Secret would put
an apiserver write on the inference path. Served on `server.metricsAddr`
(`:9090`), a listener of its own so metrics are not reachable wherever the UI is,
behind a ClusterIP Service of its own (`<release>-metrics`) whatever type the UI's
Service is; the chart adds `prometheus.io/*` pod annotations and an optional ServiceMonitor.

| Metric | Labels | Meaning |
|---|---|---|
| `router_requests_total` | `key_id`, `key_name`, `model`, `code` | requests forwarded, by the status the gateway answered. `model` is empty unless that status was 2xx, so a caller cannot mint series by naming models that do not exist |
| `router_key_last_request_timestamp_seconds` | `key_id`, `key_name` | last request that passed the key check -- "last used", per replica: take `max` across pods |
| `router_rejected_total` | `reason` | answered by the router itself: `invalid_key`, `expired`, `model_not_allowed`, `too_large`, `unreadable`, `keys_unavailable`, `no_backend` |

A deleted key's series are dropped on the replica that deleted it; elsewhere
they stay until that pod restarts. Go runtime and process metrics are exported
beside them.

## One-command install

`helm install modelsphere ./helm/console` on an empty cluster, with no values,
has to end with a working Playground and `/v1`. So the chart carries the whole
inference path, not just the portal:

```
browser ─► console ─/api/llm─┐
program ─► console ─/v1──────┴─► gateway (llm-openresty) ─► demo model (llama.cpp)
                                  route "llm": peers_by_model  └─ gateway.models …
```

| Concern | Decision |
|---|---|
| Gateway | built in unless `playground.gateway` names an existing one. llm-openresty `4pdosc/llm-openresty` plus the `autoconfig-reload` sidecar, one replica, in the release namespace |
| Route | one aggregate route `llm` rendered by the chart: `peers_by_model` over the demo model and `gateway.models`. Peers must be IP literals, so each model gets a relay `server` on loopback that `proxy_pass`es to its URL, resolved once at load. No models is valid: `/v1/models` lists none, chat answers 400 |
| Gateway key | generated at first install, kept across upgrades (`lookup`), in `<release>-gateway-keys`; console reads it like any gateway's |
| Console wiring | the `llm` backend points at the built-in route ConfigMap, Service and Secret; the router turns on with it. No profile, no swiss |
| Demo model | on by default: llama.cpp `server-b11206` serving Qwen2.5-0.5B-Instruct Q4_K_M on CPU, fetched once into a PVC (kept on uninstall) from ModelScope, then hf-mirror. `-t` matches the CPU limit (unpinned it ran 6 tok/s under throttling, pinned ~30). It reports `cached_tokens`, so the Playground's cache hit rate shows |
| Selectors | the gateway and demo pods carry their own `app.kubernetes.io/name`: console's Service, PDB and metrics select on name+instance, which cannot change on an existing release |
| Access | Service type NodePort by default, so the address works when the install returns; `NOTES` prints it |

Verified on daocloud-ce (single node, 12 CPU, no GPU, local-path): install in
2m12s including the model download; login and first password change, Playground
chat with stats, API key issued, `/v1` with the official OpenAI SDK (list,
stream, 401 on a bad key), `cached_tokens` 28/29 on a repeated prompt.

### Still missing for a public one-command install

| Gap | Why it matters | Where it is fixed |
|---|---|---|
| console image is not public | `swr…/risecloud/console` needs credentials; the verification loaded the image onto the node | publish `console:<appVersion>` anonymously (e.g. Docker Hub `4pdosc/console`) and default the chart to it |
| llama.cpp comes from ghcr.io | slow or blocked in some networks | a mirror value, or a copy under the same public org |
| models deployed through swiss reach console only via the stack's gateway | the built-in gateway's route is rendered by the chart; autoconfig writes per-model routes into the stack's own `llm-route/openresty-conf` | point `playground.gateway` at the stack's gateway (see "Models across routes"); a built-in gateway fed by autoconfig is a later step |
| swiss is off by default | its catalog URL is a placeholder, its engines need GPUs and hostPath weights, and routing needs autoconfig with the ModelRoute and LLMSLORequirement CRDs | `swiss.enabled`, see "swissd in the chart" |
| swiss and console read the gateway key differently | swiss sends the Secret value verbatim (default entry `apiKey`), console takes the first key of `key:owner,…` (default entry `keys`); a bare secretRef is swissd's namespace to swiss, the entrypoint's to console | one format, in swiss. Until then the profile names `secretRef` as `namespace/name` and `secretKey` explicitly, on an entry holding one bare key |

### swissd in the chart

`charts/swiss` is modelsphere/swiss's chart, copied verbatim (the commit names the
swiss revision); `swiss.enabled` installs it. Everything under `swiss:` is that
chart's values, plus `networkPolicy`.

| Concern | Decision |
|---|---|
| Login | `swiss.auth.disabled`: console authenticates and authorises (`backends/swiss`) |
| Who reaches swissd | a NetworkPolicy admits console's pods only. Inert on a CNI that does not enforce policy (flannel) |
| Backend | `swiss` added to `backends` at `/api/deploy` → `http://<release>-swiss.<ns>.svc:<port>/api`, unless `backends` names one already. The old default (`swissd.swiss.svc:8080`) matched no Service the swiss chart renders |
| Gateway | with no `playground.gateway.profile`/`configMap`, `fromSwiss` points the `llm` backend at swissd's site profile, so the Playground serves what swiss deploys. The built-in gateway and demo model are then not installed |
| Gateway RBAC | the profile names its route ConfigMap and key Secret only once saved, so the chart cannot know their namespace: `playground.gateway.namespaces` lists it |
| Image | `swr…/risecloud/swissd:<swiss appVersion>` |

```
helm install → setup page writes the site profile → 模型目录 → 部署 → release Ready
            → autoconfig writes the model's route → console re-reads the profile (30s) → Playground
```

## Bringing swiss in

swiss's frontend is copied into `web/src/modules/swiss/` without changes on the
swiss side yet. The copy is two commits: a verbatim one naming the swiss commit,
then the edits that mount it, so a resync is "copy again, replay the edits".

| Concern | In the copy |
|---|---|
| Left out | `main.tsx`, `index.css`, `vite-env.d.ts`, `components/Layout.tsx`, `routes/Login.tsx`, `routes/PreviewDeploySettings.tsx` |
| Imports | `@/…` → `@swiss/…` (alias to `src/modules/swiss`) |
| Links | `Link`, `NavLink`, `Navigate`, `useNavigate` come from `lib/host.ts`, which prefixes absolute paths with `/swiss` |
| API | `lib/api.ts` fetches through `hostFetch(apiPath(…))`: `/api/x` → `/api/deploy/x`, with the console session |
| Login | console's. `components/Session.tsx`'s gate shows an error instead of swiss's login, and still sends an uninitialised site to setup |
| Layout | console's. `index.tsx` keeps swiss's cluster warnings above each page; the site switcher is not carried over |
| Theme | Rise tokens; `warning` and `success` added in `src/index.css` |
| Access | every page needs UI permission `swiss.view`; calls need the verb on `backends/swiss` |

What swiss could still take on so the copy needs configuration, not page edits:

| # | Today in `swiss/web` | Change in swiss | Why |
|---|---|---|---|
| 1 | imports use `@/…` | use `@swiss/…` | `@/` is the console's root; console adds one alias `@swiss` → `src/modules/swiss` |
| 2 | absolute links `to="/catalog"`, `navigate("/")` | one `swissPath()` helper (console binds it to `useModulePath`) | pages mount under `/swiss` |
| 3 | `fetch("/api/...")` | one client with a configurable base and fetch | console sets base `/api/deploy` and `apiFetch` |
| 4 | `main.tsx` holds routes, router, query client, layout | `module.tsx` exports pages + menu; `main.tsx` keeps the standalone shell | console mounts the pages, not the app |
| 5 | `index.css` declares the theme variables | move them to a standalone-only file | the Rise tokens provide the theme here |

API types: swissd exports `openapi.json` (committed, CI-checked), and the console
generates the TypeScript client from it, replacing the hand-written types in
`swiss/web/src/lib/api.ts`.

## Rise Global target

Not in scope now. The module contract keeps the door open: pages take no props
from the shell, links and fetches go through shell functions, and backend
requests carry the same headers Global's apiserver sets.

## Known debt

- **`@riseaicloud/ui` is a private, closed-source package.** It is used now to
  hit the deadline; the repo **cannot be made truly open-source** until this
  dependency is replaced with open components or itself open-sourced. Tracked as
  a release blocker, not a permanent state.
- **The vendored `@riseaicloud/ui` peer range was widened to React 19 by hand**
  (`web/vendor/@riseaicloud/ui/package.json`). Upstream should publish the same
  range; until then a re-vendor must keep the edit.
- **The Rise tokens are still a Tailwind 3 preset**, loaded through `@config`.
  A Tailwind 4 CSS build of the tokens would drop `tailwind.config.ts`.

## Phases

| Phase | Scope |
|-------|-------|
| P0 | Scaffold: Go BFF skeleton, config, dynamic client, Docker, helm chart. **(done)** |
| P1 | Login loop: iam CRD types, dynamic CRUD, `/oauth/token`, auth middleware, helm-seeded admin, frontend login + guard. |
| P2 | User management: user CRUD API + UI, i18n (zh-CN/en-US). |
| P3 | Full roles: authorizer + role/binding CRUD + role/permission UI. |
| P4 | Federation: module shell, stack aligned with swiss, backend proxy with identity headers and per-backend RBAC. **(done)** |
| P5 | swiss module: copy into `modules/swiss`, mounted through `lib/host.ts` (see "Bringing swiss in"). **(done)** Then: swiss prepares its frontend (table above) and exports `openapi.json`; CODEOWNERS. |
| P6 | Playground: chat module, `llm` backend resolved from the cluster (site profile or route ConfigMap) with the gateway key read from its Secret, streaming SSE end to end. **(done)** Then: Markdown, compare page, full parameters, stats, view code. **(done)** The router: `/v1`, API keys, usage metrics. **(done)** One-command install: built-in gateway and a CPU demo model. **(done)** |
| P7 | Container management modules, moved over from Rise Global. |

Each phase is independently committable and verifiable.
