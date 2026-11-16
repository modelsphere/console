# Plugin Platform Configuration

ModelSphere owns cluster-specific service endpoints, credential references and
resource scopes. Providers — the platform itself or another plugin — publish
those values as capabilities; a plugin declares which capabilities it consumes,
and the CLI binds them when it installs the plugin Helm release.

```text
Console Helm values / registered plugins
  provides: capability -> value paths
              |
              v
plugin.yaml consumes
              |
              v
modelsphere plugin install
  -> resolve each binding (preflight)
  -> temporary values file: consumed.<provider group>/<name>.<key>
  -> plugin Helm release
```

Registration is separate. The Plugin CR references the installed release by Chart
name, version, namespace and release name; it carries no host credentials and
does not duplicate the platform values.

## Host Configuration

The Console release is the source of truth for the built-in providers:

```yaml
externalSwiss:
  url: http://swissd.swiss-system.svc:80/api
  proxyKey:
    secretName: swiss-proxy-key
    key: proxyKey
platform:
  inferenceNamespaces: [swiss-deploy]
```

`externalSwiss` already configures the Console Swiss backend. The platform
scope adds the production namespaces that a plugin may inspect. These are
host-level values, not values that an installer should repeat for each plugin.
The Secret value is never copied into the plugin package or the generated
values file.

## Built-in Providers

| Provider | Capability | Published keys | Source |
| --- | --- | --- | --- |
| `modelsphere.dev/platform` | `platform.modelsphere.dev/image-pull-secrets` | `imagePullSecrets` | Console values `imagePullSecrets`; same-namespace only |
| `modelsphere.dev/platform` | `platform.modelsphere.dev/inference-namespaces` | `inferenceNamespaces` | Console values `platform.inferenceNamespaces`; absent when empty |
| `modelsphere.dev/swiss` | `swiss.modelsphere.dev/gateway` | `endpoint`, `apiKeyRef`, `apiKeyKey` | Console values `externalSwiss.url` / `externalSwiss.proxyKey`, endpoint trimmed of `/api` |

A registered Plugin CR whose `plugin.yaml` declares the same capability shadows
the built-in provider for that capability, so a real Swiss plugin replaces
`modelsphere.dev/swiss` without any change to the consumer.

## Plugin Declaration

A provider declares what it offers; a consumer declares what it needs. Nothing
in a consumer turns a provider on.

```yaml
# provider
provides:
  - capability: swiss.modelsphere.dev/gateway
    version: v1
    values:
      endpoint: .gateway.url
      apiKeyRef: .gateway.auth.secretRef
# consumer
consumes:
  - capability: platform.modelsphere.dev/image-pull-secrets
    version: v1
  - capability: swiss.modelsphere.dev/gateway
    version: v1
```

`values` maps each published key to a dotted path in the provider's rendered
Helm values. The consumer never sees the provider's chart layout.

`from` pins a provider when the default choice is wrong or ambiguous:

```yaml
consumes:
  - capability: swiss.modelsphere.dev/gateway
    version: v1
    from:
      kind: Plugin          # Plugin | Platform
      group: modelsphere.dev
      name: swiss
      version: ">=0.4.0"    # SemVer constraint on the provider's product version
```

The Canary chart receives the following values during CLI installation:

```yaml
consumed:
  modelsphere.dev/platform:
    imagePullSecrets: []
    inferenceNamespaces: [swiss-deploy]
  modelsphere.dev/swiss:
    endpoint: http://swissd.swiss-system.svc:80
    apiKeyRef: swiss-proxy-key
    apiKeyKey: proxyKey
```

Plugins without `consumes` receive no generated values. Direct Helm installs
may still use the chart's `consumed` defaults, but those defaults are only a
standalone-chart fallback. The CLI path always uses the resolved provider
values for every declared binding.

Resolution is preflight and fails the install when:

| Failure | Message shape |
| --- | --- |
| no installed provider offers the capability | `no installed provider offers capability …` |
| a provider exists but not for the pinned `from` | `capability … is not available: installed providers offer …` |
| several providers compete without `from` | `capability … is offered by multiple providers (…); pin one with from` |
| the provider is outside the requested SemVer range | `capability … is not available: installed providers offer …` |
| a same-namespace capability is installed elsewhere | `capability … is namespace-scoped to "…"; install this plugin in "…"` |
| the provider declares a key with no value behind it | `capability …: … publishes no value at … for "…"` |

This keeps the host API generic while allowing a plugin's backend chart to use
its own configuration names. A consumer cannot widen the host scope by shipping
its own `consumed` defaults, because the CLI writes the resolved values over
them.

## Security

- The plugin receives a Secret reference, not the Secret value.
- The temporary values file is created with mode `0600` and removed after install.
- `imagePullSecrets` is same-namespace scoped by declaration, not by a hardcoded
  CLI check, so any provider can publish the same rule.
- A capability that cannot be resolved fails before the plugin Helm release runs.
