# Installed frontend plugins

## Background and goals

Built-in Console modules remain compiled into the shell. Optional trusted modules can also be installed as independent frontend packages: before installation they have no menu, route or overview card; after installation and a browser refresh they use the same shell as built-ins.

No plugin management page, marketplace, backend installer or dependency resolver is included.

## Architecture

```text
operator-owned directory -> /plugins/index.json -> entry JS + CSS
  -> window.ConsolePluginHost.register(ConsoleModule)
  -> shared shell: navigation + routes + overview + permission guards
```

| Module | Responsibility | State |
|---|---|---|
| Go plugin handler | Discover package manifests and serve their assets | Directory is the installed-package source of truth |
| Browser loader | Load CSS and entry scripts; validate registrations | Module registry for the current page load |
| Existing Console shell | Render menus/pages/cards, authenticate and guard permissions | Existing user session and query cache |

### Package contract

```text
plugins/
  example/
    plugin.json
    index.js
    style.css
```

```json
{ "id": "example", "entry": "index.js", "styles": ["style.css"] }
```

- Directory name and `id` match, using lowercase kebab-case.
- `entry` and optional `styles` are existing package-relative files. Include nested asset paths if needed.
- Entry is a browser script (IIFE/UMD), registering exactly one `ConsoleModule` synchronously. Its ID matches the manifest.
- Each ID and base path must be unique across built-ins and installed packages. Shell and asset paths are reserved.
- Use package-scoped CSS. Assets may be served publicly, as with the shell itself.
- Installed JavaScript is trusted and has Console privileges. Backend authentication and RBAC still apply to API requests.

### Host interface

```js
const { version, React, Router, Query, shell, icons, register } = window.ConsolePluginHost;
// version === 1; icons currently exposes Boxes.
register({
  id: "my-tools",
  title: "工具",
  basePath: "/my-tools",
  pages: [{
    path: "",
    element: React.createElement(MyPage),
    menu: { label: "工具", icon: icons.Boxes },
    // permission: "my-tools.view", // optional existing UI permission
  }],
});
```

Use the host's React instance and hooks; do not bundle another React. JSX authoring must compile to the shared `React.createElement` or a compatible host runtime, and output a browser script without unresolved imports. Other package-private dependencies can be bundled. The example uses plain JavaScript and requires no build step.

`Router` shares React Router, `Query` shares TanStack Query, and `shell` exposes the same public interface as `web/src/shell/index.ts`: `useAuth`, `usePermissions`, `useModulePath`, `request`, `apiFetch`, `registerI18n`, `useT`, and the other existing exports. Components render inside the existing providers. `overview`, `frame`, page permissions and topbar placement use the existing `ConsoleModule` contract.

## Scenarios

### First installation

Prerequisites: a Console build supporting this mechanism, its existing config and cluster, and filesystem access to the Console host. From the repository root:

```sh
mkdir -p ./plugins
./console --config ./console.yaml --plugins-dir ./plugins
# Equivalent environment setting: CONSOLE_PLUGINS_DIR=/absolute/path/to/plugins
```

With the directory empty, refresh the Console URL: there is no example menu or page. The discovery response is `[]`. With no flag/environment setting, external plugins are disabled and the response is also `[]`.

In another terminal, from the repository root:

```sh
cp -R examples/plugins/example ./plugins/example
```

Refresh the same Console URL. The sidebar contains the example tools group; the overview links to the workspace. Open it and click its action button: the count increases. Opening `/example` directly also renders the workspace after refresh.

Data: package files -> discovery response -> browser assets -> module registration -> existing shell. No Console rebuild or server restart is required to copy/remove packages after the directory has been configured. Install complete packages before refreshing clients.

### Removal

Move the package outside the installed directory to retain a backup:

```sh
# Verify both paths before executing in a real installation.
mv ./plugins/example ./example-uninstalled
```

Refresh: the menu and overview disappear, and `/example` follows Console's existing unknown-route behavior. Already-open tabs retain their loaded modules until refreshed.

### Failure and recovery

A malformed manifest makes discovery fail, with details in server logs and a visible plugin-loading notice in Console. Built-ins remain usable. Missing scripts/styles, missing registration, ID mismatch and route collisions are reported by the browser loader. A failed package does not enter the module list; later valid packages can still load. Discovery and each asset load have a 15-second timeout.

Correct the package files and refresh to retry. Package code must avoid startup side effects outside its own namespace; removing a failed script cannot roll back arbitrary JavaScript side effects. No package data or installation state is written by discovery.

### Development and containers

`npm run dev` proxies `/plugins` to the same Console target as `/api` and `/oauth`; set `CONSOLE` as documented for local development. Container operators mount their package directory read-only and set `CONSOLE_PLUGINS_DIR` to that path. The default image and chart install no optional package.
