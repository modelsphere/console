# Route Options Catalog

Design agreed from console issue #52 on 2026-10-12.

```text
DeploySheet -> GET /api/llm/route-options[?route=<existing>]
            -> configured gateway -> /<route>/_route_opts
            -> common grouped rows + advanced picker + runtime state
```

| Concern | Decision |
|---|---|
| API | Each configured backend exposes GET `<prefix>/route-options`; gateway backends select resolved ConfigMap routes, while static URLs already name a route |
| Authorization | Console login and `get backends` on the configured backend name |
| Request | Optional existing route; reject invalid names and unknown routes; without one try available routes until a catalog answers |
| Credentials | Do not forward the browser session, cookies or gateway API key to the public engine endpoint |
| Compatibility | 404 for an unsupported engine, missing backend, empty gateway or unavailable route; bundled metadata has no fallback values |
| Failures | Permission, transport and malformed response failures are surfaced, not silently treated as legacy engines |
| Form state | Fetching metadata never changes stored overrides; `value` and `set` describe the current runtime separately |
| Runtime identity | Only show runtime values for the canonical requested upgrade route, including the release-name fallback for older plans |
| Named controls | Preserve chart and SLO semantics, use live placeholders, and avoid duplicate rows |
| Advanced | Engine internals remain behind the add-setting picker, which respects available viewport height |
| i18n | Translate known keys; unknown keys use engine text |
| Swiss | Adapt bundled metadata in inferences without editing the copied Swiss module |

No CRD, chart value or configuration schema changes. Validation remains in the engine.

## Regression Coverage

| Scenario | Signal |
|---|---|
| SPA with no gateway backend | Catalog API returns 404 JSON instead of 200 HTML |
| Host defaults differ from bundled values | Render the live defaults, never copied placeholders |
| Existing route differs from a new deployment | Do not leak the probed route's runtime state into a new form |
| Upgrade without explicit route/serviceId overrides | Use the same canonical route for fetching and display |
| Unknown engine option | Render engine metadata without a console release |
| Optional boolean override | Preserve unset, true and false distinctly |
| Empty advanced setting | Omit the setting rather than sending its displayed default |
| Catalog response | Bound response size, reject malformed data and do not follow redirects |

## Real Engine Verification

Verification used a released `4pdosc/llm-openresty:0.1.26` image with an isolated catalog-only route and the existing preview application services. The route is not a working inference pool or a business deployment.

| Check | Result |
|---|---|
| Engine catalog | 16 common directives and 24 advanced directives |
| Different host defaults | TPS fallback 73 and floor fraction 0.61 appear as placeholders |
| Separate route state | TPS value 81 with set=true is distinct from fallback 73 |
| Proxy | Preserves the engine response; known routes return 200 and unknown routes 404 |
| Browser compose | Returns 200; live defaults and empty advanced settings remain omitted |
| Native mouse interaction | Advanced option is pointer-reachable; selection keeps the form open and the value unset |
| Local checks | Go suite, frontend suite, typecheck and production build pass |

The standalone browser check requires an auth-disabled preview, a real configured engine and the GLM sample model:

```sh
CONSOLE_URL=http://127.0.0.1:8080 node hack/check-route-catalog-live.mjs
```

It checks live placeholders, viewport containment, pointer hit testing and native selection. Acceptance is desktop-only. No install/apply operation was performed, and existing stored release history was not rewritten.
