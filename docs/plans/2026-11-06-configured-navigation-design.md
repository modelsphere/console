# Configured plugins and navigation folders

Console reads the enabled frontend tree from YAML at startup; sibling order is display order.

```yaml
plugins:
  - folder: workloads
    title: 模型与实验
    children:
      - id: inferences
        source: builtin
      - id: canary
        source: remote
        url: http://canary-frontend:8080
        entry: index.umd.js
        styles: [index.css]
        menu:
          title: 北极星
          label: 实验
          path: /canary
          component: Canary
  - id: playground
    source: builtin
```

| Concern | Decision |
| --- | --- |
| Empty configuration | Omitted/null uses defaults; explicit [] disables every module |
| Default installation | Embed `internal/config/default-plugins.yaml`; it declares the current built-in order |
| Sources | Built-ins resolve against the compiled module registry; remote entries use the existing SDK loader |
| Folders | `folder`, `title`, `children`; nested folders carry no resource URL, page route, or permission grant |
| Ordering | Walk the YAML tree in order; the compiled registry describes availability only |
| Selection | An explicit tree installs only listed modules; omitted built-ins do not mount routes |
| Existing remote-only config | Entries without `source` retain legacy behavior: default built-ins followed by remotes |
| Discovery | Extend `/plugins/index.json` with explicit source and folder nodes; keep upstream URLs server-side |
| Resource proxy | Resolve only remote leaves; reject assets for folders and built-ins |
| Permissions | Filter existing page permissions before grouping; hide folders with no visible descendants |
| Navigation | Expand ancestors of an active route, including hidden detail routes; collapsed sidebar keeps descendant links reachable |
| Validation | Reject duplicate folder/plugin IDs, unknown sources/built-ins, empty folders and mixed node shapes |
| Lifecycle | Restart existing backend and refresh browser after configuration changes |
| Failure | Report invalid node shapes at startup; check compiled/remote mount collisions before executing entries; discovery failure keeps only the shell; remote failures preserve other configured modules |

```text
YAML -> validate/resolve defaults -> same-origin discovery tree
                                         |
compiled registry + SDK registration -> ordered modules + folder ancestry
                                         |
permissions -> visible navigation tree -> sidebar
```

Validation covers configuration parsing/defaults, folder discovery and remote resource delivery, mixed module ordering, nested active routes, permission pruning, duplicate labels, browser collapse/expand, and restart/refresh behavior.
