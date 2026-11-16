# Plugin Platform Configuration

ModelSphere owns cluster-specific service endpoints, credential references and
resource scopes. A plugin declares which host capabilities it needs; the CLI
supplies the values when it installs the plugin Helm release.

```text
Console Helm values
  externalSwiss + platform.inferenceNamespaces
              |
              v
plugin.yaml requires
              |
              v
modelsphere plugin install
  -> temporary platform values overlay
  -> plugin Helm release
```

Registration is separate. The Plugin CR references the installed release by Chart
name, version, namespace and release name; it carries no host credentials and
does not duplicate the platform values.

## Host Configuration

The Console release is the source of truth:

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
overlay.

## Plugin Declaration

Only plugins that need these capabilities declare them:

```yaml
requires:
  swiss: true
  inferenceNamespaces: true
  imagePullSecrets: true
```

The current Canary chart receives the following generated values during CLI
installation:

```yaml
targetNamespaces: [swiss-deploy]
swiss:
  url: http://swissd.swiss-system.svc:80
  proxySecret: swiss-proxy-key
  proxySecretKey: proxyKey
```

Plugins without `requires` receive no platform overlay. Direct Helm installs
may still use the chart's ModelSphere standard defaults, but those defaults are
only a standalone-chart fallback. The CLI path always uses the host
configuration when the requirement is declared.

The mapping is deliberately explicit:

| Host capability | Console source | Canary chart value |
| --- | --- | --- |
| Swiss endpoint | `externalSwiss.url` | `swiss.url` without `/api` |
| Swiss credential reference | `externalSwiss.proxyKey` | `swiss.proxySecret` and `swiss.proxySecretKey` |
| Production inference scope | `platform.inferenceNamespaces` | `targetNamespaces` |
| Registry credential references | `imagePullSecrets` | `imagePullSecrets` |

Registry references are inherited only when declared. This requires installation
in the Console namespace because Kubernetes Secrets are namespace-scoped. No
registry credentials are read or embedded in the plugin package.

This keeps the host API generic while allowing a plugin's backend chart to use
its existing configuration names. A plugin cannot change the host scope by
shipping a different value in its package or by passing a second install-time
scope.

## Security

- The plugin receives a Secret reference, not the Secret value.
- The temporary overlay is created with mode `0600` and removed after install.
- `targetNamespaces` is generated from a host-controlled scope and is not
  user-supplied by a plugin package.
- A missing required host capability fails before the plugin Helm release runs.
