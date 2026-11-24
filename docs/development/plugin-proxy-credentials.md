## Status

Deferred at the user's request. The Secret-reference field and its proxy
implementation are not shipped by Console or Global, and plugin charts must not
declare it. Any future implementation requires a shared cross-host contract.
The sections below retain the proposal, not an installation requirement.

## Background

Installed plugins currently receive Console identity headers and the user's session token, but cannot declare the shared backend credential that configured backends already support. Plugin backends should implement a platform contract, not disable credential verification to accommodate the frontend. Canary PR modelsphere/console-canary-plugin#11 is the first consumer.

## Proposal

Add optional `spec.directives.authProxySecretRef: {name, key}` to plugin ReverseProxy routes. Console reads the named Secret in the installed plugin release namespace after user authentication and backend IAM authorization, then replaces upstream Authorization with `Bearer <secret value>`. Existing routes without the field retain their session-forwarding behavior.

## User experience

1. A plugin chart creates or references its backend proxy Secret and mounts the same key in the backend.
2. Its ReverseProxy declares only the Secret name/key, never the value.
3. Plugin frontends continue using the SDK; backend teams retain credential and identity validation.

## Design

```text
SDK request -> Console session + IAM -> release-scoped Secret lookup
                                         -> overwrite credential + identity -> backend validates both
```

### API and configuration

```yaml
spec:
  directives:
    authProxy: true
    authProxySecretRef:
      name: example-proxy
      key: proxyKey
```

- Reference requires authProxy=true and cannot coexist with skipAuthentication.
- No namespace override or inline credential; name/key syntax is validated.
- An explicit ReverseProxy namespace must match the release namespace when it references credentials.
- Lookup on each authorized request observes Secret rotation/deletion without restart or stale credential fallback.
- Missing/unreadable Secret, missing/empty key, malformed bearer token, or unavailable Kubernetes client fails closed with 502; no upstream request is sent.
- Secret lookup errors expose only an operational error category, not Kubernetes error payloads or Secret values.

### Security

- Existing per-backend IAM checks run before Secret access.
- Console strips client-supplied identity headers/Cookie and overwrites Authorization.
- Existing release-namespace Secret read permissions are reused; no automatic RBAC grants, cross-namespace lookup, or cluster-wide Secret permission.
- Plugin installation is a privileged boundary: chart authors already select upstream destinations and release resources. Operators must trust installed packages and review Secret references.
- NetworkPolicy remains defense in depth, not a replacement for backend credential validation.

### Compatibility and upgrade

- Additive opt-in field; existing routes unchanged.
- Upgrade Console and apply its updated ReverseProxy CRD before installing a plugin using this field (Helm does not upgrade CRDs automatically).
- This field is a Console extension to Global's ReverseProxy schema; other hosts must implement it before consuming such packages.

## Alternatives considered

- Skip backend shared-key checks: changes the trust model and couples frontend integration to backend internals.
- Inline headerUp credential: exposes secrets in release manifests and is not supported by the plugin route validator.
- Canary-specific proxy code: violates the reusable platform boundary.
- Cached credentials: adds stale-key/revocation semantics not needed for the first implementation; measure request volume before adding a bounded cache.

## Out of scope

Backend business logic, backend credential-validation changes, live cluster operations, automatic permissions, and PR merging.

## Rollout

1. Console contract, schema generator, validation, forwarding tests and documentation.
2. Rework Canary PR #11 to retain existing backend authentication and declare its existing Secret in the chart route.
3. Backend team verifies conformance; installed-environment acceptance follows a host/CRD upgrade.
