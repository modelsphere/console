# ModelSphere Plugin SDK architecture

## Background

Optional pages need independent repositories and deployments while sharing Console's React, router, query, UI and authenticated transport. ModelSphere maintains the migrated reusable Global SDK source as `@modelsphere/plugin-sdk`.

## Goals

- Configure one menu with SDK-registered root and detail pages.
- Develop source with Vite and React Fast Refresh, preserving compatible local state.
- Deploy built JS/CSS with a static-resource image.
- Keep business UI and release history in its owning repository.

### Non-goals

- Plugin manager, uploads, marketplace, dependency resolution, CRDs or lifecycle controllers.
- Global API-server delivery or new menu/page permission management.
- Every Global business module, scope or slot, or arbitrary multi-plugin stylesheet merging.

## Architecture

### Overview

```text
configuration -> discovery -> SDK registration -> menu and routes
                   |
            same-origin proxy
              /          \
        Vite + HMR      static image
        development     deployment
```

### Design

| Decision | Reason |
| --- | --- |
| Actual SDK source under `web/packages/plugin-sdk` | ModelSphere owns package and build maintenance while preserving the reusable contract. |
| Canonical `__MODELSPHERE_SDK__` and Global/Rise aliases | Migrated and compatible existing bundles share one host. |
| Configuration owns menu/upstream | Operator selects a trusted service; no installation database. |
| Transactional registration | Invalid identity/component/routes/collisions do not enter the registry. |
| Native development import | Wait for top-level await and complete SDK registration. |
| Host React Refresh runtime | Both Vite servers update the same host React tree. |
| Source-driven shared imports | Regenerate shim exports on edits without duplicate provider contexts. |
| Static-resource image | Deployment serves built files without Vite. |

Configuration changes require backend restart and browser refresh. Compatible component edits use Fast Refresh; registration changes can reload the document. Discovery/loading is bounded to 15 seconds. HTTP proxy requests and response-header waits are bounded to 30 seconds; upgraded sockets remain long-lived. Resources use no-store responses.

Trusted JavaScript runs in the Console page. Resource proxies strip browser credentials/upstream cookies and allow GET/HEAD. Only development descriptors permit WebSocket upgrades. Existing business API authentication/authorization applies; optional SDK auth metadata adds no page/menu policy.

### Components

| Component | Responsibility | Input/output | State owner | Dependency |
| --- | --- | --- | --- | --- |
| Configuration | Service, entry, styles, menu, development flag | YAML → validated snapshot | Operator | Service URL/component name |
| Go discovery/proxy | Descriptors, HTTP and development WebSockets | `/plugins/*` → upstream | Startup config | Vite/static service |
| SDK | Registration, types, shims, build/dev presets | Source → package/plugin outputs | SDK maintainers | Pinned toolchain |
| Browser host | Validate and commit declarations | SDK calls → Console modules | Browser document | Host React/Router/Query/UI |
| Plugin repository | Business pages/tests/image | Source + SDK → image | Plugin maintainers | Compatible host theme/SDK |
| Business backend | Existing data operations | Authenticated APIs | Existing storage | Console transport |

### Data flow

1. Build/deploy the static image, or run plugin Vite for development.
2. Console validates configuration and returns same-origin descriptors.
3. Browser establishes the SDK host, loads resources and collects component/route registrations.
4. Validation commits a module and the configured menu atomically.
5. Pages use shared providers and authenticated business transport.
6. Development updates cross the proxy and refresh compatible mounted components.

## Scenarios

### Connect a deployed frontend

**Prerequisites:** A compatible SDK bundle and stylesheet are served by a trusted static-resource image. Preserve existing Console auth/backend settings.

**Operation:** Configure the service, entry, styles and menu as in the [plugin guide](../development/plugins.md#deploy-a-static-resource-image), restart the existing Console and refresh. From the Console origin, request `GET /plugins/index.json` and `GET /plugins/example/index.umd.js`.

**Visible state:** Discovery includes `example`; assets return 200; the configured menu opens its registered root page.

**Data flow:** Configuration → Go descriptor/proxy → image files → SDK registration → Console menu/routes.

**Completion:** The root and `items/<id>` page render under the actual host providers; business requests retain normal authentication.

### Edit a page with Fast Refresh

**Prerequisites:** Console Vite is running and the SDK/plugin dependencies are prepared. Enable the development descriptor from the [guide](../development/plugins.md#develop-with-fast-refresh).

**Operation:** From the plugin frontend directory:

```sh
CONSOLE_SOURCE_DIR=/path/to/console CONSOLE_ORIGIN=http://127.0.0.1:5173 pnpm exec vite --config vite.config.mjs
```

Refresh Console once, change local page state, edit a React component and save. Also add a previously unused shared named import.

**Visible state:** Source updates automatically; new shared exports resolve without restarting Vite. Compatible component state remains selected.

**Data flow:** Source edit → Vite/shared-import generation → proxy WebSocket → browser HMR → host React Refresh tree.

**Completion:** Updated content appears while `performance.timeOrigin`, a window marker and compatible local state remain unchanged. Entry/registration edits may reload the document.

### Recover an unavailable resource service

**Prerequisites:** A configured service is unavailable; Console's built-in modules remain accessible.

**Operation:** Restore the existing plugin service, confirm `GET /plugins/example/index.umd.js` returns 200, then refresh Console.

**Visible state:** A loading error is replaced by the plugin's registered page after refresh. A previously loaded tab may keep its old registry until refreshed.

**Data flow:** Restored service → Go resource proxy → browser entry execution → validated registry.

**Completion:** Plugin resources and pages load; retrying resource delivery creates no business records.

### Disable a plugin

**Prerequisites:** Operator controls the Console configuration; business records remain in the existing backend.

**Operation:** Set `plugins: []`, restart the existing Console backend, refresh, then request `GET /plugins/index.json`.

**Visible state:** Discovery returns `[]`; optional navigation and routes disappear.

**Data flow:** Updated configuration → startup snapshot → discovery → new browser registry.

**Completion:** Optional surfaces are absent and backend business data remains owned by its existing storage.

Source origin is recorded in [UPSTREAM.md](../../web/packages/plugin-sdk/UPSTREAM.md).
