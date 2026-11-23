# ModelSphere plugin CLI

`modelsphere plugin` installs, registers, inspects and removes Console plugins.
Installing creates the Helm release that runs a plugin; registering creates the
`Plugin` custom resource Console reads. This guide covers both steps and the
checks between them. For the model behind it, see
[plugin-architecture.md](plugin-architecture.md); for building a plugin, see
[plugins.md](plugins.md).

## 1. Two steps, one plugin

```text
plugin package/validate
          |
          v
   Helm plugin release              Plugin CR (modelsphere.dev/v1alpha1)
   Deployments / Services / PVC                |
   ReverseProxy / IAM                          |
          |                                     |
          +------------------+------------------+
                             v
                   Console plugin registry
         /plugins/index.json, /plugins/<cr-name>/..., /api/<plugin>/*
```

| Actor | Does | Does not |
| --- | --- | --- |
| `plugin install` | validates the package, resolves `consumes` bindings, installs or upgrades the plugin release | change Console's Helm values, upgrade Console |
| `plugin registration` | writes the `Plugin` CR for a package and a release | run `kubectl apply` |
| user / GitOps | owns a CR that the Chart does not ship, and disables a plugin through the Chart value | hand-edit resources inside an installed release |
| Console | watches CRs, reads the installed release's `plugin.yaml` and `frontend/`, serves assets and backend routes | install or modify a plugin release |

Console only observes installed releases, so installing and registering are
independent choices: the CR can live in GitOps, and different people can
install the release and approve the registration.

The Console chart carries the `modelsphere.dev_plugins` CRD under `crds/`. Helm
installs `crds/` only on the first `helm install` of a chart; a `helm upgrade`
of an existing release does not add it. After upgrading to a Console version
with plugin support, apply it once:

```sh
kubectl apply -f "$CONSOLE_REPO/helm/console/crds/"
```

Without the CRD the informer keeps reporting `the server could not find the
requested resource` and `/readyz` stays 503.

Console's ServiceAccount has `get/list/watch` on `plugins` and write access to
`plugins/status`. It also needs a namespaced Role that reads Helm release
Secrets in the Console namespace; a plugin release in another namespace needs
the same Secret read permission there, or its CR stays `Degraded`.

## 2. Prerequisites

| Requirement | Notes |
| --- | --- |
| `modelsphere` CLI | `go build ./cmd/modelsphere`, or a binary from a release |
| Helm 3.8+ and `kubectl` | install and registration |
| a cluster running Console | the plugin CRD must be present |
| Go 1.26+ | only when building the CLI from source |

The CLI takes cluster settings from flags, environment or a config file. Flags
win over the file; `KUBECONFIG` is read when no path is configured. The file is
`$XDG_CONFIG_HOME/modelsphere/config.yaml` or, when that is unset,
`~/Library/Application Support/modelsphere/config.yaml` on macOS and
`~/.config/modelsphere/config.yaml` on Linux:

```yaml
kubeconfig: ~/.kube/config
context: my-context
console:
  release: console
  namespace: console-system
```

The examples below use:

```sh
export KUBECONFIG="$HOME/.kube/config"
export KUBE_CONTEXT=my-context
export CONSOLE_RELEASE=console
export CONSOLE_NAMESPACE=console-system
export CONSOLE_URL=https://console.example.com
```

## 3. Commands

```text
modelsphere plugin validate <chart-or-package>
modelsphere plugin package <chart-directory> --destination <directory>
modelsphere plugin list
modelsphere plugin install <chart-or-package> [flags]
modelsphere plugin registration <chart-or-package> [flags]
modelsphere plugin uninstall [group/name] [flags]
```

`modelsphere --version` prints the release version, the same value as the
Console Chart's `appVersion`.

| Command | Purpose |
| --- | --- |
| `validate` | checks `Chart.yaml`, `plugin.yaml` and the declared `frontend/<entry>` in a chart directory or `.tgz` |
| `package` | validates, runs `helm lint`, and writes a `.tgz`; it does not inject frontend output, so the chart must already contain `frontend/<entry>` |
| `list` | reads `Plugin` CRs and prints identity, version, kind, release and status |
| `install` | installs or upgrades the plugin Helm release, injecting the `consumed` values resolved from `consumes`; rolls back on failure and leaves no pending release |
| `registration` | prints a `Plugin` CR ready for `kubectl apply` |
| `uninstall` | deletes the CR first, then uninstalls the plugin release |

Diagnostics use kubectl-style numeric verbosity and go to stderr, so stdout
stays clean for piping:

| Flag | Output |
| --- | --- |
| default / `-v=0` | command results and errors only |
| `-v=1` | phase progress and a heartbeat during long waits |
| `-v=2` | Helm and kubectl commands with their duration |
| `-v=4` | forwarded subprocess stderr, with credentials redacted |
| `-v=6` | diagnostic summary such as stdout/stderr byte counts |

## 4. Build a release package

`modelsphere plugin package` wraps `helm package`. It validates the chart, runs
`helm lint` and writes the archive; it does not build the frontend, copy files
into `frontend/`, or choose an image version. A release pipeline that builds
the plugin image pushes the image tag first, stamps the chart's image
repository and tag, copies the built `frontend/` output into the chart, and
only then packages.

An installable package must contain `Chart.yaml`, `plugin.yaml` with
`apiVersion: v1`, and `frontend/<entry>`. `validate`, `package` and `install`
all enforce that rule and fail before Helm runs, so a package Console could
never load is never installed.

An archive of the same name is not overwritten by default. `--force` validates
the new archive first and then replaces the old one atomically.

## 5. Install the runtime

`install` runs in this order:

1. validates the package;
2. discovers the single Console Helm release (`--console-release` and
   `--console-namespace` disambiguate); `--plugin-namespace` defaults to the
   Console namespace—when it differs, grant Console's ServiceAccount Secret
   read access in that namespace first;
3. collects providers: Console's built-in platform capabilities
   (`modelsphere.dev/platform`, `modelsphere.dev/swiss`) and the `provides`
   declared by registered `Plugin` CRs;
4. resolves every `consumes` binding and writes
   `consumed.<provider-group>/<provider-name>.<key>` into a temporary values
   file;
5. runs Helm `upgrade --install --wait --atomic`. A timeout or failed install
   rolls back: an upgrade returns to the previous revision and a first install
   is removed, leaving no pending release to block the next attempt.

```sh
modelsphere -v=2 --timeout 10m plugin install ./dist/my-plugin-0.1.0.tgz
```

Expected output when the Chart ships the `Plugin` CR:

```text
Installed runtime: modelsphere.dev/my-plugin 0.1.0
Registered: Console serves the plugin.
```

A Chart without the CR prints the follow-up step instead:

```text
Installed runtime: modelsphere.dev/my-plugin 0.1.0
Registration is separate: create a Plugin CR to load it in Console.
```

The temporary values file is created with mode `0600` and deleted when the
install finishes. Neither the package nor that file ever carries a Secret
value.

Capability resolution is covered in
[plugin-platform-config.md](plugin-platform-config.md). In short:

| Provider | Capability | Value source | Result |
| --- | --- | --- | --- |
| `modelsphere.dev/platform` | `platform.modelsphere.dev/image-pull-secrets` | Console values `imagePullSecrets` | written to `consumed.modelsphere.dev/platform.imagePullSecrets`; same-namespace only, so a plugin outside the Console namespace fails before Helm |
| `modelsphere.dev/platform` | `platform.modelsphere.dev/inference-namespaces` | Console values `platform.inferenceNamespaces` | written to `consumed.modelsphere.dev/platform.inferenceNamespaces`; missing means failure before Helm |
| `modelsphere.dev/swiss` | `swiss.modelsphere.dev/gateway` | Console values `externalSwiss.url` / `externalSwiss.proxyKey` | written to `consumed.modelsphere.dev/swiss.endpoint` / `apiKeyRef` / `apiKeyKey`, with a trailing `/api` removed; missing config fails before Helm |

A registered plugin that declares an equally named capability shadows the
built-in provider. When several providers can answer a binding and `from` does
not pin one, `install` fails and asks for `from`; `from.version` is a SemVer
constraint on the provider's product version.

## 6. Register the plugin

A Chart that ships the `Plugin` CR registers itself: the CR is part of the
release, created on install and removed on uninstall, and `install` reports
`Registered`. This is the recommended package layout; see
[plugins.md](plugins.md#10-register) for the template.

For a Chart without the CR, `registration` writes the declaration. It does not
apply it and does not read CRs from the cluster (it does discover the Console
release):

```sh
modelsphere plugin registration ./dist/my-plugin-0.1.0.tgz \
  --console-release "$CONSOLE_RELEASE" \
  --console-namespace "$CONSOLE_NAMESPACE"
```

Example output:

```yaml
apiVersion: modelsphere.dev/v1alpha1
kind: Plugin
metadata:
  name: modelsphere.dev--my-plugin
spec:
  type: helm
  scope: platform
  enabled: true
  version: 0.1.0
  chart:
    name: my-plugin
    namespace: my-plugin-system
    releaseName: my-plugin
```

| Field | Meaning |
| --- | --- |
| `metadata.name` | the reversible `group--name` encoding of the identity; Console uses it as `/plugins/<name>/` |
| `spec.version` | installed chart version; when set, it must match the release |
| `spec.chart.name` | chart name, not the product name |
| `spec.chart.releaseName` | Helm release name; defaults to `plugin.yaml` `name` |
| `spec.chart.namespace` | namespace of the release |
| `spec.enabled` | `false` unloads the frontend and routes but keeps the release and IAM |

Apply it after review:

```sh
modelsphere plugin registration ./dist/my-plugin-0.1.0.tgz \
  --console-release "$CONSOLE_RELEASE" \
  --console-namespace "$CONSOLE_NAMESPACE" \
  | kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" apply -f -
```

Console watches CRs through an informer; it does not poll. At startup it lists
all CRs and completes an initial sync, and `/readyz` answers 503 until that
sync finishes, so a pod never takes traffic before it knows the plugins.

## 7. Verify

Read the CRs and their status:

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  plugin list
```

```text
IDENTITY                 VERSION  KIND    RELEASE    STATUS
modelsphere.dev/my-plugin 0.1.0   Plugin  my-plugin  Installed
```

`STATUS` is the CR's `status.phase`: `Installed`, `Degraded` or `Pending`;
`spec.enabled=false` shows `Disabled`. `VERSION` is the `plugin.yaml` product
version, not the chart version.

Check what Console serves:

```sh
helm --kubeconfig "$KUBECONFIG" --kube-context "$KUBE_CONTEXT" \
  status my-plugin --namespace "$CONSOLE_NAMESPACE"

curl -fsS "$CONSOLE_URL/plugins/index.json" | jq .
curl -fsS -o /dev/null -w 'entry_http=%{http_code}\n' \
  "$CONSOLE_URL/plugins/modelsphere.dev--my-plugin/index.umd.js"
```

The index should contain `id: my-plugin`,
`entry: /plugins/modelsphere.dev--my-plugin/index.umd.js` and the `backend`
declaration.

Open the module in Console. Backend requests to `/api/my-plugin/*` are proxied
to the `ReverseProxy` in the installed release. Console authorizes them first
against IAM resource `backends` with name `my-plugin`, then forwards them with
`X-Remote-User` and one `X-Remote-Group` per group; a user without the role
gets 403. A `ReverseProxy` whose matcher path does not start with `/api/`, whose
`authProxy` is not `true`, or whose upstream is invalid leaves the CR
`Degraded`, and its frontend is not loaded.

## 8. Disable and restore

Disabling keeps both the release and the CR. Flip the Chart value so the next
upgrade keeps it, then upgrade:

```sh
helm --kubeconfig "$KUBECONFIG" --kube-context "$KUBE_CONTEXT" \
  upgrade my-plugin ./dist/my-plugin-0.1.0.tgz \
  --namespace "$CONSOLE_NAMESPACE" --reuse-values \
  --set registration.active=false
```

For a CR the Chart does not own, a patch is enough:

```sh
kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" \
  patch plugins.modelsphere.dev modelsphere.dev--my-plugin \
  --type merge -p '{"spec":{"enabled":false}}'
```

Console removes the entry and its routes on the next watch event. Setting
`enabled` back to `true` restores them; neither direction needs a restart.

## 9. Uninstall

```text
select CR
   |
   v
delete Plugin CR          Console stops serving assets and routes
   |
   v
Helm uninstall release    removes Deployment / Service / PVC and other runtime objects
```

Interactive selection:

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  -v=2 --timeout 10m \
  plugin uninstall
```

In a script, pass the full identity and `--yes`:

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  --timeout 10m \
  plugin uninstall modelsphere.dev/my-plugin \
  --yes \
  --wait
```

Expected output:

```text
Uninstalled: modelsphere.dev/my-plugin
```

Check the result:

```sh
kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" \
  get plugins.modelsphere.dev

helm --kubeconfig "$KUBECONFIG" --kube-context "$KUBE_CONTEXT" \
  status my-plugin --namespace "$CONSOLE_NAMESPACE"

curl -fsS "$CONSOLE_URL/plugins/index.json"
```

The CR is gone, Helm answers `release: not found`, and the index no longer
lists `"id": "my-plugin"`.

## 10. Failures

| Stage | CLI / Console behavior | How to check |
| --- | --- | --- |
| package validation fails | no cluster change | fix `plugin.yaml`, the chart or `frontend/<entry>`, then validate again |
| declared `frontend/<entry>` missing from the package | fails before Helm | package the chart after copying the frontend output into `frontend/` |
| capability not resolved | fails before Helm: no provider, an ambiguous provider without `from`, an unsatisfied version, a same-namespace capability across namespaces, or a provider that does not publish the key | install or upgrade the provider, complete Console's values, or pin `from` in `consumes` |
| plugin install fails or the wait times out | automatic rollback: an upgrade returns to the previous revision, a first install is removed; no pending release remains | `helm status <release> -n <namespace>` |
| CR never created | runtime exists but Console does not load it | `modelsphere plugin list` |
| chart and CR disagree | CR `Degraded`; no frontend or routes | compare `spec.version`, `spec.chart.name`, `spec.chart.releaseName` |
| release not deployed | CR `Degraded` | `helm status`; status must be `deployed` |
| release outside the Console namespace | Console cannot read the release Secret; CR `Degraded` | grant Console's ServiceAccount Secret `get/list` there, or install into the Console namespace |
| Console lacks `plugins` permission | the informer reports `forbidden` and `/readyz` stays 503 | upgrade to a Console chart that ships the `plugins` ClusterRole and the release Secret Role |
| entry missing or asset path invalid | CR `Degraded`; nothing served | repackage and confirm `frontend/<entry>` is inside |
| CR deletion fails | the CLI stops and does not uninstall the release | fix API access, then uninstall again |
| backend returns 403 | Console IAM refuses the request | grant the user `get` on `backends/my-plugin` |

Do not hand-edit resources inside a plugin release. Console's plugin
registration comes only from `Plugin` CRs; the release is installed, upgraded
and uninstalled by Helm.

## Related documents

- [plugin-architecture.md](plugin-architecture.md) — how Console discovers and serves plugins.
- [plugins.md](plugins.md) — build a plugin end to end.
- [plugin-platform-config.md](plugin-platform-config.md) — capability providers and bindings.
