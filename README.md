# ModelSphere Console

<p align="center">
  <a href="https://github.com/modelsphere/console/actions/workflows/publish.yml"><img alt="publish" src="https://github.com/modelsphere/console/actions/workflows/publish.yml/badge.svg"></a>
  <a href="https://github.com/modelsphere/console/pkgs/container/console"><img alt="Image" src="https://img.shields.io/badge/image-ghcr.io%2Fmodelsphere%2Fconsole-2496ED?logo=docker&logoColor=white"></a>
  <a href="https://hub.docker.com/r/4pdosc/console"><img alt="Docker Hub" src="https://img.shields.io/badge/docker%20hub-4pdosc%2Fconsole-2496ED?logo=docker&logoColor=white"></a>
  <a href="https://github.com/modelsphere/console/pkgs/container/charts%2Fconsole"><img alt="Chart" src="https://img.shields.io/badge/chart-oci%3A%2F%2Fghcr.io%2Fmodelsphere%2Fcharts%2Fconsole-0F1689?logo=helm&logoColor=white"></a>
  <a href="go.mod"><img alt="Go" src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white"></a>
  <a href="web/package.json"><img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black"></a>
  <a href="helm/console/README.md"><img alt="Docs" src="https://img.shields.io/badge/docs-install%20guide-blue"></a>
  <a href="helm/console/Chart.yaml"><img alt="Version" src="https://img.shields.io/badge/dynamic/yaml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmodelsphere%2Fconsole%2Fmain%2Fhelm%2Fconsole%2FChart.yaml&query=%24.appVersion&label=version&color=blue"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/modelsphere/console"></a>
  <a href="https://github.com/modelsphere/console/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/modelsphere/console?style=flat&logo=github"></a>
</p>

## Overview

ModelSphere Console is the web portal and API entry point of [ModelSphere](https://github.com/modelsphere/modelsphere). It adds what the open-source inference stack does not have on its own: users, roles and login; a single UI for deploying models, chatting with them and managing API keys; and an OpenAI-compatible endpoint that programs call with those keys.

Console is a Go backend-for-frontend with a React UI compiled into the same binary. It owns identity and federates everything else — model deployment to [Swiss](https://github.com/modelsphere/swiss), inference to the [llm-openresty](https://github.com/modelsphere/llm-openresty) gateway — behind one login.

## Highlights

- **Identity and access control.** Users, roles and login history stored as Kubernetes CRDs; OAuth2 password login with HS256 tokens; Kubernetes-RBAC-style roles that gate both pages and backend APIs. The seeded administrator is asked to set a password on first login.
- **Model deployment.** With [Swiss](https://github.com/modelsphere/swiss) on the cluster, browse the model catalog and deploy, upgrade and uninstall models, with a diff before every change and the GPU nodes they run on.
- **Playground.** Streaming chat with the models deployed in Model Serving, full sampling parameters, per-answer TTFT, tokens/s and cache hit rate, reasoning output, and "view code" for cURL, Python and Node.js.
- **OpenAI-compatible router.** Programs call `/v1` with API keys that administrators issue — with expiry and optional per-model scope. Keys are stored hashed; usage is exported as Prometheus metrics.
- **Gateway discovery.** The inference entrypoint, routes and gateway key are read from the cluster (Swiss's site profile or the route ConfigMap) and followed as they change — no URLs or keys copied into configuration.
- **One `helm install`.** The image and chart are published together to GHCR; point Console at Swiss and the models deployed there are in the Playground and `/v1`.
- **Upgrade path to Rise Global.** Identity is wire-compatible with Rise Global (same CRDs, same token claims), so upgrading is a configuration change, not a data migration.

## Quick start

**Prerequisites**

1. a Kubernetes cluster with linux/amd64 nodes that can reach `ghcr.io`, and `kubectl` pointing at it with cluster-admin rights;
2. `helm` 3.8 or later (Helm 4 works too).

**Step 1: install**

```bash
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace \
  --wait --timeout 20m
```

This installs Console on its own. Models come from [Swiss](https://github.com/modelsphere/swiss): to connect to a cluster that already runs it, or to pick a version, see the [install guide](helm/console/README.md).

**Step 2: log in**

```bash
kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

Open <http://127.0.0.1:8080> and sign in as `admin` / `P@88w0rd`.

> **The first login asks you to set a password.** Keeping the initial one is allowed, with a warning; choose your own.

**Step 3: call a model**

Deploy a model under **模型服务** (Model Serving). Once it is ready, go to **路由 → API 密钥** (Router → API keys) and create a key, then call it by its served name:

```bash
export MODELSPHERE_API_KEY=<the key you created>
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $MODELSPHERE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"<served model name>",
       "messages":[{"role":"user","content":"hello"}],"max_tokens":32}'
```

Any OpenAI SDK works the same way, with `base_url` set to `http://<console address>/v1`.

## Architecture

```
browser ──▶ web UI (shell + modules)          program ──▶ /v1 (API key)
                  │ /oauth, /api/*                              │
                  ▼                                             ▼
            ┌──────────────────────── console (Go) ────────────────────────┐
            │ identity: iam CRDs, OAuth2 (HS256), RBAC                      │
            │ backend proxy: per-backend RBAC, X-Remote-User/Group headers  │
            │ router: API keys, model scope, metrics                        │
            │ gateway resolver: site profile / route ConfigMap → entrypoint │
            └──────────────┬───────────────────────────────┬────────────────┘
                           ▼                               ▼
                   swissd (deploy, catalog)        llm-openresty gateway → models
```

The design, with the reasoning behind each decision, is in [`docs/console-design.md`](docs/console-design.md).

## Repository layout

| Path | What it contains |
|---|---|
| `cmd/console` | the server binary |
| `internal/iam` | identity: CRD types, password login, authorization |
| `internal/server` | HTTP server: OAuth2, auth middleware, backend proxy, embedded UI |
| `internal/router` | `/v1`: API keys, model scope, metrics |
| `internal/gateway` | resolves the inference entrypoint from the cluster |
| `internal/config` | configuration schema and validation |
| `web/src/shell` | UI shell: login, layout, navigation, route guards |
| `web/src/modules` | UI modules: `inferences` (模型服务), `playground`, `router` (API 密钥), `iam` (users and roles), `docs` (user guide); `swiss` is the swiss UI copy `inferences` builds on |
| `helm/console` | the Helm chart and its [install guide](helm/console/README.md) |
| `examples/console.yaml` | an annotated configuration file |

## Development

Requirements: Go 1.26, Node.js 24.

```bash
# backend
go build -o console ./cmd/console
go test ./...

# frontend
cd web
npm ci
npm run typecheck && npm test
npm run build            # writes web/dist, which the Go binary embeds
npm run build:swiss      # the standalone Swiss UI variant, into web/dist-swiss
```

To run against a cluster from a workstation, copy `examples/console.yaml` to `console.yaml`, set `cluster.kubeconfig`, and start `./console --config console.yaml`. `npm run dev` in `web/` serves the UI with hot reload and proxies `/api` and `/oauth` to it on port 8080.

`web/dist` is committed empty, so `go build` works without Node but serves no UI until `npm run build` has run. The image build (`Dockerfile`) does both.

Images and charts. CI (`.github/workflows/publish.yml`) publishes both on every push to main and every tag: the image to `ghcr.io/modelsphere/console` and `4pdosc/console` on Docker Hub, the chart to `oci://ghcr.io/modelsphere/charts/console`. The OCI chart pulls the GHCR image; charts in the [modelsphere helm repo](https://github.com/modelsphere/helm-charts) are the other channel and pull from Docker Hub.

`hack/bump.sh patch --tag` bumps the version and tags it; pushing the tag publishes a release. The older install, image and chart scripts are kept, unmaintained, in `hack/legacy/`.

Before contributing, read [`CONTRIBUTING.md`](CONTRIBUTING.md): issues, branches, Conventional Commits, pull requests and review. The full developer guide is in [`docs/development/`](docs/development/README.md); comment and doc style in [`AGENTS.md`](AGENTS.md).

## Documentation

| Document | What is in it |
|---|---|
| [`helm/console/README.md`](helm/console/README.md) | the complete install: prerequisites, versions, existing-Swiss mode, uninstall, publishing |
| [`docs/console-design.md`](docs/console-design.md) | design and decisions: identity and Rise Global compatibility, modules, backends, Playground, router |
| [`helm/console/values.yaml`](helm/console/values.yaml) | every chart setting, with comments |
| [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/development/`](docs/development/README.md) | how to contribute: local development, workflow, conventions, issues, pull requests, review, design proposals |
| [`SECURITY.md`](SECURITY.md) | reporting a vulnerability privately |
| [`CHANGELOG.md`](CHANGELOG.md) | what changed in each release |

## License

[Apache License 2.0](LICENSE), including the UI kit `@modelsphere/ui` (`web/packages/ui`). Third-party components are listed in [NOTICE](NOTICE).
