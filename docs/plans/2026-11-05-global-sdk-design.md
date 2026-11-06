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

Concrete SDK preparation, authoring, configuration, development, deployment, disable and recovery commands are in the [plugin guide](../development/plugins.md). Source origin is recorded in [UPSTREAM.md](../../web/packages/plugin-sdk/UPSTREAM.md).

| Scenario | Completion |
| --- | --- |
| Deploy plugin | Assets 200; root component appears in configured menu. |
| Edit component | Automatic update with document identity and local state retained. |
| Add shared import | Generated exports update without development-server restart. |
| Service fails/recovers | Error visible; built-ins usable; refresh registers recovered plugin. |
| Remove configuration | After restart/refresh, optional menu/routes disappear; business records remain. |
