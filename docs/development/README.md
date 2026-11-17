# Developer guide

Everything about working on console. The short version is [CONTRIBUTING.md](../../CONTRIBUTING.md).

```
local-development ──▶ development-workflow ──▶ pull-requests ──▶ code-review
        │                      │
 coding-conventions        issues · design-proposals
```

| Document | What is in it |
|---|---|
| [local-development.md](local-development.md) | toolchain, a dev cluster, running the server and the UI, reaching in-cluster backends, Telepresence debugging, images |
| [development-workflow.md](development-workflow.md) | fork or branch, sync, Conventional Commits, push, open a PR, releases |
| [coding-conventions.md](coding-conventions.md) | Go, logging, web, the swiss copy, the chart, tests, file naming |
| [issues.md](issues.md) | before filing, templates, a good issue, labels, triage, lifecycle |
| [pull-requests.md](pull-requests.md) | before you open one, small PRs, the description, release notes, review and merge, backports |
| [code-review.md](code-review.md) | the standard, what to look for, writing comments |
| [design-proposals.md](design-proposals.md) | when a change needs one, the process, the template |
| [plugin-architecture.md](plugin-architecture.md) | plugin package, registration contract, loader, serving, backend proxy, capabilities, failure isolation |
| [plugins.md](plugins.md) | build a plugin: chart, `plugin.yaml`, SDK bundle, ReverseProxy and IAM, package, install, register |
| [plugin-cli.md](plugin-cli.md) | the `modelsphere plugin` command reference |
| [plugin-platform-config.md](plugin-platform-config.md) | capability providers, bindings and shadowing |

Also: [console-design.md](../console-design.md) for why console is built the way it is, and [SECURITY.md](../../SECURITY.md) for reporting vulnerabilities.
