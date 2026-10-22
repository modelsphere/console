# Console Helm Chart

[中文](README.zh-CN.md)

**The package that installs ModelSphere Console into Kubernetes.** CI publishes the image and the chart to GHCR at the same version; both can be pulled without logging in:

| Artifact | Location |
|---|---|
| Chart | `oci://ghcr.io/modelsphere/charts/console` |
| Image | `ghcr.io/modelsphere/console` (linux/amd64), tagged with the chart version |

## What it does not do

- **It does not install or modify an existing Swiss or inference gateway** — it only reads their ConfigMaps and Secrets.
- **It does not need `install.sh`** — that is an optional helper in the source repository (discovers Swiss and the gateway, generates values, runs an end-to-end check after install). It is not in the chart package and this guide does not use it. See `./install.sh --help`.

## Quick start

Check the [prerequisites](#prerequisites) first. This installs Console on its own; models come from Swiss, see [Connecting to an existing Swiss](#connecting-to-an-existing-swiss):

```bash
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace \
  --wait --timeout 20m

kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

Open `http://127.0.0.1:8080` and sign in as `admin` / `P@88w0rd`.

> **The first login asks you to set a password** before you can continue. Keeping the initial one is allowed (with a warning); choose your own.

Without `--version` the latest release is installed; running the command again upgrades. See [Choosing a version](#choosing-a-version).

## Two ways to install

| Mode | For | Extra values | What you get |
|---|---|---|---|
| Console only | trying the UI, managing users | none | login, users and roles; no models, so Playground and `/v1` are unavailable |
| Existing Swiss | a cluster already running Swiss and the OpenResty gateway | `--values console-values.yaml`, see [Connecting to an existing Swiss](#connecting-to-an-existing-swiss) | the Model Serving pages; the Playground and `/v1` call the models deployed there |

## Choosing a version

| Source | Version | Usage |
|---|---|---|
| Release (a pushed `X.Y.Z` tag) | `X.Y.Z` | omit `--version` for the latest release; pin with `--version X.Y.Z` |
| Every commit on `main` | `<appVersion>-git<first 7 of the commit>`, e.g. `0.1.1-git3affbe6` | `--version 0.1.1-git3affbe6` |

Builds from `main` need the full version. **Do not use `--devel` to get the "latest" build**: those versions compare by the alphabetical order of the commit hash, so it does not pick the newest commit. Available versions are listed on [GitHub Packages](https://github.com/modelsphere/console/pkgs/container/charts%2Fconsole).

## Prerequisites

| Requirement | Applies to | Why | Check |
|---|---|---|---|
| `helm` 3.8 or later (Helm 4 works), `kubectl` | all | installing from an OCI registry needs Helm 3.8+ | `helm version` |
| Helm runs with cluster-admin rights | all | the chart creates IAM CRDs and a ClusterRole/ClusterRoleBinding (the platform-admin role has `*`, and Kubernetes only lets a user who already holds those rights create it); with Swiss it also creates Roles in other namespaces | `kubectl auth can-i '*' '*' --all-namespaces` prints `yes` |
| linux/amd64 nodes | all | the image is amd64 only | `kubectl get nodes -L kubernetes.io/arch` |
| nodes can reach `ghcr.io` | all | the Console image is on GHCR | — |
| Swiss chart 0.6.0 or later with `auth.proxyKey` on, or Swiss running with `auth.disabled=true` | existing Swiss | Console calls Swiss on behalf of the signed-in user with the proxyKey | see [Find Swiss and the gateway](#1-find-swiss-and-the-gateway) |
| a Swiss site profile exists and `cluster.profile.key` is `profile.yaml` (the default) | existing Swiss | Console reads the gateway entrypoint from the profile, and only from the `profile.yaml` key; Swiss creates the profile the first time settings are saved in its UI | same as above |

## Connecting to an existing Swiss

```text
find Swiss and the gateway -> copy the proxyKey into modelsphere -> write console-values.yaml -> helm upgrade --install
```

### 1. Find Swiss and the gateway

```bash
# The Swiss Service: note NAMESPACE, NAME and PORT
kubectl get svc -A -l app.kubernetes.io/name=swiss

# The Swiss configuration (a ConfigMap named like the Service):
#   server.auth.disabled       if true, skip step 2
#   cluster.profile.configMap  the site profile, as namespace/name
#   cluster.profile.key        must be profile.yaml
kubectl -n <swiss-namespace> get configmap <swiss-name> -o jsonpath='{.data.swiss\.yaml}'

# The site profile: note route.nginxService, route.nginxConfigMap and route.auth.secretRef
kubectl -n <profile-namespace> get configmap <profile-name> -o jsonpath='{.data.profile\.yaml}'
```

### 2. Copy the proxyKey

A Secret cannot be read across namespaces, so copy Swiss's proxyKey into Console's namespace. Swiss's auth Secret is named `<swiss-name>-auth` by default:

```bash
kubectl create namespace modelsphere --dry-run=client -o yaml | kubectl apply -f -
kubectl -n <swiss-namespace> get secret <swiss-name>-auth -o jsonpath='{.data.proxyKey}' | base64 -d > proxyKey
kubectl -n modelsphere create secret generic swiss-proxy-key --from-file=proxyKey
rm proxyKey
```

If the second command prints nothing, this Swiss has no proxyKey: upgrade the Swiss chart to 0.6.0 or later, or run it with `auth.disabled=true`.

### 3. Write the values

The example values file is in the chart package. Pull it, then edit it as in the table below:

```bash
helm pull oci://ghcr.io/modelsphere/charts/console --untar --untardir /tmp/console-chart
cp /tmp/console-chart/console/values-existing-stack.example.yaml console-values.yaml
```

Write every reference as `namespace/name`.

| Value | What to put | The chart creates a read-only Role in that namespace |
|---|---|---|
| `externalSwiss.url` | `http://<swiss-name>.<swiss-namespace>.svc:<port>/api`; must end in `/api` | — |
| `externalSwiss.proxyKey.secretName` | `swiss-proxy-key` from step 2; delete the line if Swiss runs with `auth.disabled=true` | — |
| `externalSwiss.profile` | Swiss's `cluster.profile.configMap` | yes |
| `playground.gateway.service` | the profile's `route.nginxService` | yes |
| `playground.gateway.secretRef` | the profile's `route.auth.secretRef`; if it is a bare name, its namespace is **Swiss's namespace**. Delete the line if the profile has no such field | yes |
| `playground.gateway.configMap` | **leave unset**: Console refuses to start when a profile is also set | — |

The read-only Role is named `console-console-gateway` and grants only `get` on `configmaps` and `secrets`. Console also reads the profile's `route.nginxConfigMap`; if that is in a namespace not covered by the table, grant access by hand after installing:

```bash
kubectl -n <route-namespace> create role console-console-gateway --verb=get --resource=configmaps,secrets
kubectl -n <route-namespace> create rolebinding console-console-gateway \
  --role=console-console-gateway --serviceaccount=modelsphere:console-console
```

### 4. Install

```bash
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace \
  --values console-values.yaml \
  --wait --timeout 10m
```

## Check and sign in

```bash
helm -n modelsphere status console
kubectl -n modelsphere get pods,svc
kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

Open `http://127.0.0.1:8080` (the Service is a NodePort by default, so the node address printed in NOTES works too) and sign in as `admin` / `P@88w0rd`.

> **The first login asks you to set a password** before you can continue. Keeping the initial one is allowed (with a warning); choose your own.

If the cluster already has an IAM User of the same name (for example Rise Global's), the chart does not overwrite it; the NOTES printed by `helm status` say so.

## Uninstall

```bash
helm -n modelsphere uninstall console
```

These objects are not deleted with the release, and are reused on reinstall:

| Object | Why | Manual cleanup |
|---|---|---|
| router API key Secret `console-console-api-keys` | created by Console at runtime, not part of the release | `kubectl -n modelsphere delete secret console-console-api-keys` |
| the copied `swiss-proxy-key` | created by hand | `kubectl -n modelsphere delete secret swiss-proxy-key` |
| IAM data: User, IAMRole, IAMRoleBinding, LoginRecord (cluster-scoped) | created by Console at runtime (the administrator User seeded by the chart belongs to the release and is deleted) | see below |
| IAM CRDs `*.iam.theriseunion.io` | Helm does not delete resources in `crds/` | see below |

The IAM CRDs and data share one definition with Rise Global. **Do not delete them** while Rise Global or another Console still runs on the cluster. Once you are sure only this Console uses them, deleting the CRDs deletes every user, role and login record with them:

```bash
kubectl delete crd users.iam.theriseunion.io iamroles.iam.theriseunion.io \
  iamrolebindings.iam.theriseunion.io loginrecords.iam.theriseunion.io
```

## Common values

Every setting is documented in the comments of `values.yaml` (`helm show values oci://ghcr.io/modelsphere/charts/console`).

| Value | Effect |
|---|---|
| `externalSwiss.*` | connects to an existing Swiss, see above |
| `playground.gateway.*` | points at an inference gateway directly (without Swiss, use `configMap` + `service`) |
| `service.type` | how the UI is exposed; `NodePort` by default |
| `admin.encryptedPassword` | presets the administrator password as a bcrypt hash |
| `metrics.serviceMonitor.enabled` | scrapes metrics with the Prometheus Operator |
| `auth.jwtSecret` | a signing key shared with Rise Global; generated on first install when empty |
| `auth.disabled=true` | turns login off; every request runs as the local administrator, see the next section |

## Turning login off (auth.disabled)

For a laptop, a demo, or a single-tenant cluster that already has authentication in front, the login page can go:

```sh
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace --set auth.disabled=true
```

Console then neither issues nor checks tokens. Every request carries a synthetic `admin` identity (`system:masters`), which the authorizer's short-circuit lets through every check. The UI shows no login page, and "Change password" and "Sign out" are hidden from the user menu, since neither has anything to act on.

| Consequence | Detail |
|---|---|
| nothing in the chain authorizes | Console is the only layer in front of Swiss that authorizes. Turn it off here and no layer in the stack does |
| do not expose it on a shared network | anyone who can reach the address is an administrator |
| the signing key is still generated | the Secret still exists, and `auth.jwtSecret` can still be shared with Rise Global |
| the administrator User is still created | nobody signs in with it, but keeping it makes switching back to `auth.disabled=false` a one-value change; removing it from the manifest would make helm delete it |

Console logs a warning at startup, and the NOTES of `helm install` say so too. To switch back, run the same command with `--set auth.disabled=false`.

## Publishing

Two workflows, [`ci`](https://github.com/modelsphere/console/actions/workflows/ci.yml) and [`publish`](https://github.com/modelsphere/console/actions/workflows/publish.yml) (the same scheme as Swiss):

| Trigger | Version | Pushed |
|---|---|---|
| push to `main` | `<appVersion>-git<sha7>` | image and chart |
| a pushed tag `X.Y.Z` (must equal `appVersion` in `Chart.yaml`) | `X.Y.Z` | image (also tagged `latest`) and chart |
| pull request | `<appVersion>-git<sha7>` | nothing: tests, build and package only |

```text
ci:      go vet, go test, web typecheck and tests, repository gate
publish: build the image -> helm dependency build, lint --strict, package -> push image and chart
```

To release:

```bash
hack/bump.sh patch --tag     # updates Chart.yaml and internal/version, commits and tags
git push origin main --follow-tags
```

A newly created GHCR package is private by default. After the first publish, set it to Public in the package settings, or anonymous pulls fail.
