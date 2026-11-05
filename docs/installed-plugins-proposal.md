# Installed Console plugins

## Background and goal

Console represents menus, routes and overview cards through `ConsoleModule`, but compiles its module list into the shell. Optional modules need installation without rebuilding Console, with no navigation, route or overview before installation.

## Proposal

The configured image-service and Global SDK loading path is specified in [Global SDK frontend plugins](plans/2026-11-05-global-sdk-design.md). The filesystem and `ConsolePluginHost` contract below remains available for existing local packages.

```text
copy <id>/plugin.json + JS/CSS to plugins directory
  -> GET /plugins/index.json discovers installed packages
  -> browser loads each package using the shared host
  -> ConsoleModule joins the existing shell registry
  -> menus + routes + overview + existing permission guards
```

| Interface | Contract |
|---|---|
| `--plugins-dir` / `CONSOLE_PLUGINS_DIR` | Optional operator-owned directory. Unset means no external plugins. |
| `<id>/plugin.json` | `{ "id": "example", "entry": "index.js", "styles": ["style.css"] }`; styles optional; paths relative to the package. |
| `GET /plugins/index.json` | Installed descriptors with same-origin entry and style URLs; no cache. |
| `GET /plugins/<id>/<asset>` | Static package assets; missing assets return 404. |
| `window.ConsolePluginHost` | Version 1; host React, router, query, icons and shell exports, plus `register(ConsoleModule)`. |

The entry registers exactly one module synchronously. Its ID matches the manifest. The host validates declarations against built-ins and previously loaded plugins, including reserved IDs and mount paths. Plugins share authentication, query state, routing, permissions and translations through the existing React tree. Packages use the host React rather than bundle another copy.

## User experience and compatibility

- Existing built-ins stay installed.
- Copy an optional package into the configured directory, then refresh: its menu, routes and overview become available.
- Remove the package, then refresh: these surfaces disappear.
- No sample is installed by default.
- Startup loading errors are visible; failed plugins do not prevent built-ins from opening.
- Open tabs retain their registry until refreshed.

## Trust and scope

Installed JavaScript has Console privileges. Installation is an operator filesystem operation for trusted packages. Assets are public like shell assets; backend requests retain existing authentication and RBAC.

No management UI, marketplace, upload endpoint, dependency resolver, version migration or backend process installation. This follows Global's shared host and installed frontend bundle approach without adopting its CRDs and lifecycle controllers.

## Validation

- Go handler tests: empty install, live discovery/removal, manifest validation, JS/CSS, missing files and paths outside a package.
- Frontend tests: empty install, successful registration, collision and loading failures.
- Typecheck, production build and relevant shell tests.
- Browser: absent package, installed menu/page/overview, direct link and removal after refresh.
