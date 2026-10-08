# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is the
chart's `appVersion`; the image and chart are released together under it.

## [Unreleased]

## [0.1.2] - 2026-10-08

### Added
- Chinese and English, switchable at runtime from the top bar, the preferences panel or the login page; the choice is stored as Rise Global stores it.
- `@modelsphere/ui` (`web/packages/ui`): an open UI kit forked from Rise Global's design system, with its own zh-CN/en-US component strings.
- Apache-2.0 `LICENSE` and a `NOTICE` listing third-party components.
- CI on every pull request: `go vet`/`go test`, web typecheck and tests, and a gate for the license text and committed credentials.
- Dependabot for Go modules, npm, GitHub Actions and the Dockerfile.
- English install guide for the chart; the Chinese one is kept as `helm/console/README.zh-CN.md`.
- Contributor guide, issue and PR templates, security policy (#12).
- Inference services (`/inferences`): every swiss page in Rise Global's model service layout, beside `/swiss` -- services list and tabbed detail, model library and model detail, nodes, activity, site profile and setup. Deploy, upgrade and roll back in right-side sheets that compose, dry-run and show what moves and the diff before confirming.
- `@modelsphere/ui`: a second batch forked from Rise Global's design system -- sheet, floating fields, form sections, detail header, panel tabs, section cards, property lists, status indicator, filter chips, code views.
- Workload reads served by console itself: a release's events, its pods and their containers, and a container's log (`/api/k8s/namespaces/{ns}/...`), authorized as `events`, `pods` and `pods/log`. The inference service page shows them as logs and events tabs. action required for custom RBAC: the chart's ClusterRole now grants console's ServiceAccount `events` list/watch, `pods` get/list and `pods/log` get.

### Changed
- Shell, access control, Playground and router pages use `@modelsphere/ui` in Rise Global's current look: page banner, resource tables with search and pagination, deletes confirmed by typing the name. The swiss module's components follow.
- The first password change may keep the current password, with a warning (#11).
- The swiss subchart dependency points at a published swiss chart, pinned to a stable version (#17, #18).
- The swiss subchart is 0.6.3 (was 0.6.1); its values are unchanged.
- Deployment status and detail pages reworked (#16).
- GitHub Actions in `publish.yml` pinned to commit SHAs.

### Removed
- The Playground's compare page (`/playground/compare`); the Playground is one conversation, Chat.
- Model Deployment (`/swiss`, swiss's own pages mounted as a module): Model Serving (`/inferences`) covers every page. Old `/swiss` links land on the home page.
- The chart's CPU demo model (`demo.enabled`, llama.cpp serving Qwen2.5-0.5B): the Playground lists Model Serving's deployments, so it never showed there. Models come from Swiss. action required if you set `demo.enabled`: the value is now ignored; delete the weights PVC the chart kept (`console-console-demo` for a release named `console`).
- The proprietary `@riseaicloud/ui` and `@riseaicloud/tokens` (`web/vendor/`). The image now ships no closed code.

### Fixed
- An empty Playground chat names the selected model (#13).
- The sidebar keeps a module's group open on its pages without a menu entry, such as a deployment's detail page.

### Security
- `golang.org/x/crypto` 0.47.0 → 0.57.0 and `golang.org/x/net` 0.49.0 → 0.59.0, for the advisories Dependabot reported against them. Console uses only `bcrypt` from `x/crypto`; most of the advisories are in `ssh`.
- Removing `@riseaicloud/*` also removes the packages it pulled in, among them vulnerable `dompurify`, `esbuild` and `uuid`. `npm audit` reports nothing.

## [0.1.1] - 2026-10-01

First tagged release.

### Added
- Identity: users, roles and login history as Kubernetes CRDs; OAuth2 password login with HS256 tokens; RBAC-style roles that gate pages and APIs; password policy and a forced change on first login; login audit records.
- Module shell with a backend proxy, per-backend RBAC and the Rise Global look.
- Model deployment (模型部署) over swissd, from the swiss UI mounted as a module.
- Playground: streaming chat, a 2–4 column compare view, full sampling parameters, TTFT, tokens/s and cache hit rate, reasoning output, Markdown, and "view code" for cURL, Python and Node.js.
- OpenAI-compatible `/v1` router with administrator-issued API keys (expiry, optional per-model scope, stored hashed) and usage as Prometheus metrics.
- Gateway discovery from the swiss site profile or the route ConfigMap, including one model list across autoconfig's per-model routes.
- One-command Helm install, with a built-in gateway and an optional CPU demo model; image and chart published to GHCR at one version.

[Unreleased]: https://github.com/modelsphere/console/compare/0.1.2...HEAD
[0.1.2]: https://github.com/modelsphere/console/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/modelsphere/console/releases/tag/0.1.1
