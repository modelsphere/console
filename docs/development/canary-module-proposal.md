# Optional Canary module

Approved implementation direction: ship the Canary UI in Console and keep canaryd independently deployable.

| Decision | Behaviour |
|---|---|
| Source | Move the UI and its tests from console-canary-plugin into web/src/modules/canary; use Console's UI package, auth, i18n and QueryClient. |
| Discovery | Authenticated GET /api/capabilities returns canary.configured, canary.canRead and canary.canWrite. No URLs, credentials or health probes. |
| Enablement | A mounted backend named canary at /api/canary enables the module. Backend configuration is loaded at startup. |
| Read access | Existing get permission on backends/canary controls navigation and direct routes. |
| Write access | Backend get/create/update and canary.write (or administrator wildcard) enable write controls. API RBAC still authorizes each request. |
| Failure | Missing configuration hides navigation; a transient upstream failure leaves navigation available and surfaces API errors. Capability loading/failure has a separate route state and retry. |
| Packaging | Lazy page imports, one official Console image, no frontend tarball or overlay image required. |
| Upgrade | Existing backend Secrets and IAM roles continue to work; canaryd API changes must remain compatible with shipped Console versions. |

```text
configure backend + Secret -> restart Console -> query capabilities -> menus/routes
deploy canaryd            -> API available   -> experiment pages
```

The browser does not probe Kubernetes services: discovery alone cannot provision proxy credentials. canaryd, SQLite, the Operator and traffic management remain separate. Login and Console readiness do not depend on the optional service.

This proposal accompanies the implementation PR and records the approved design.
