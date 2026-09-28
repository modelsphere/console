# console

The ModelSphere community portal. A full-stack BFF: it owns identity (users,
roles, login) and federates everything else to backends like
[swiss](https://github.com/modelsphere/swiss).

```
browser ─▶ web (shell + modules) ─▶ console (Go BFF)
                                         identity: iam CRDs + OAuth2 (HS256)
                                         + global-scope RBAC + reverse proxy
                                                        │ HTTP (Bearer JWT)
                                            ┌───────────┴───────────┐
                                            ▼                        ▼
                                        swissd                  other backends
                                      deploy / catalog          (router, operator…)
```

Identity is kept **wire-compatible with Rise Global**: the same
`iam.theriseunion.io/v1alpha1` User/Role/RoleBinding CRDs and the same HS256
token claims. Upgrading a community install to Global is then a config change --
share the JWT secret and point console's identity endpoints at Global's
apiserver -- not a data migration.

## Status

Identity (P1–P3), the module shell with backend federation (P4), the swiss
module (P5) and the Playground and the router -- `/v1` with API keys (P6). See `docs/console-design.md` for the plan.

## Install

One command, no values:

```sh
helm install modelsphere ./helm/console -n modelsphere --create-namespace
```

What comes up, and what you can do right after:

| Piece | What it gives you |
|---|---|
| console (2 replicas, NodePort) | log in as `admin` / `P@88w0rd` (you set a new password first); `NOTES` prints the URL |
| built-in gateway (llm-openresty) | the Playground lists and chats with the models it serves |
| demo model (llama.cpp, Qwen2.5-0.5B, CPU) | something to chat with on any cluster, GPU or not; ~500 MB downloaded once |
| router | admins issue API keys under 路由 → API 密钥; programs call `http://<console>/v1` with any OpenAI SDK |

Needs a default StorageClass (for the demo model's weights) and roughly 2 CPU /
2 GiB free. Grow from there with values:

| Value | For |
|---|---|
| `gateway.models` | your own OpenAI-compatible endpoints, served next to (or instead of) the demo |
| `demo.enabled=false` | once real models are in |
| `playground.gateway.profile=<ns>/<site-profile>` | use an existing gateway (swiss's site profile) instead of the built-in one |
| `playground.gateway.{configMap,service,secretRef}` | the modelsphere stack's gateway (`llm-route/openresty-conf`, `llm-route/openresty`): every model autoconfig routes shows up in one list |
| `swiss.enabled`, `swiss.config.{catalog,cluster.name}`, `swiss.rbac.namespaces`, `playground.gateway.namespaces` | 模型部署: swissd behind console, deploying models the Playground then serves ([swissd in the chart](docs/console-design.md#swissd-in-the-chart)) |
| `service.type`, `metrics.serviceMonitor.enabled` | exposure and Prometheus Operator scraping |

See [docs/console-design.md](docs/console-design.md#one-command-install).

### Building your own image

```sh
# build + push console:<chart version>-dev.<commit>, then write console-image.yaml
CONSOLE_REGISTRY=<registry>/<org> hack/image.sh
helm upgrade --install modelsphere ./helm/console -n modelsphere --create-namespace -f console-image.yaml
```

The tag carries the commit, so an upgrade always changes the pod template and
rolls. `hack/image.sh --no-push` builds only. The chart logs in on the default
`admin` / `P@88w0rd` unless the cluster already has that user (Rise Global's,
say), in which case it is left alone and `NOTES` says so.

## Build

```sh
go build ./...
go build -o console ./cmd/console
./console --config ./console.yaml
```

`go build` works without a frontend build: `web/dist` ships a placeholder and
console serves the API regardless.
