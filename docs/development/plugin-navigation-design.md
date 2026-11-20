# Platform plugin navigation adaptation

Complete the existing platform menu contract without changing plugin declarations or packaging.

## Design

```text
SDK menus (recursive) + routes
    -> validated pages with their own mount namespaces
    -> namespace/collision validation
    -> permission-filtered navigation tree
    -> expandable sidebar + guarded routes
```

| Concern | Decision |
| --- | --- |
| Plugin identity | One ConsoleModule per plugin; registration, capabilities and translations retain that identity |
| Host presentation modes | Layout choices change chrome only; the same compiled menu tree, routes, permissions and interactions serve every mode |
| Multiple namespaces | A page may override its module's basePath; routing and sidebar links use the same pagePath helper |
| Relative routes | Resolve under the first top-level menu's namespace, independent of other menus; absolute routes keep their namespace |
| Nested menus | Compile every node into a page and retain its immediate tree parent separately from sidebar-owner `parent` |
| Sidebar ownership | Children inherit the sidebar owner unless they explicitly contribute to another sidebar |
| Permissions | A child without authKey inherits its nearest ancestor's key; an explicit child key overrides it, as for detail routes |
| Visibility | Hidden or denied parents suppress their navigation subtree; registered child routes retain their own guards |
| Ordering | Sort siblings only, retaining zero as an explicit order; never flatten the tree |
| Icons | Lucide's official dynamic catalog and component; omitted icons use Puzzle, unknown names fail registration |
| Landing | Each namespace without an index page redirects to its first visible, permitted own static menu in that namespace |

## Security and compatibility

- Validate every nested declaration, identity and normalized route, not only roots.
- Check every mount namespace against shell reservations and other modules.
- Keep existing built-in relative pages and joinPath behavior unchanged.
- Absolute detail routes inherit the closest menu permission in their own namespace.
- Preserve hidden route mappings and reject duplicate normalized parameter patterns.
- No HTTP API, CRD, chart value or plugin SDK declaration is added.
- Non-platform scopes and viewport adaptation remain outside this change.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| Flatten children into groups | Changes menu hierarchy and expansion semantics |
| Split a plugin into synthetic modules | Splits identity, capability and translation ownership |
| Mount the entire plugin at / | Claims the shell's home and weakens namespace conflict checks |
| Import all Lucide components eagerly | Adds the full catalog to the initial shell bundle |

## Verification

1. Regression tests for recursive registration, ordering, permissions, hidden nodes and active ancestors.
2. Tests for multiple namespaces, relative/absolute detail routes, reserved paths and collisions.
3. Render tests for nested links, expansion controls and collapsed navigation.
4. Full web tests, Console/standalone typechecks and production build.
