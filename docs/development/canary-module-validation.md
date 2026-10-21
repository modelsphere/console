# Canary module migration validation

Validated against the authorized test cluster on 2026-10-21 using a Console build based on `d01be42` and Canary UI source from `console-canary-plugin` commit `6d5a6bb`.

| Check | Result |
|---|---|
| Console web typecheck, including standalone Swiss | Passed |
| Console web tests | 51 files, 438 tests passed, including migrated Canary tests and capability navigation/route tests |
| Console production web build | Passed; Canary list/create/pricing/detail pages emitted as separate lazy chunks |
| Console Go vet and tests | Passed |
| Capability handler race tests | Passed |
| canaryd Go vet, tests and race tests | Passed |
| canaryd chart lint | Passed |
| Existing release server dry-run | Resource inventory unchanged; only the Console container image changed |
| Test deployment | Existing Console release upgraded; both replicas ready; existing canaryd, SQLite PVC and experiment workloads retained |
| Authentication | Three temporary reader/writer/no-access identities logged in through OAuth; unauthenticated capability requests returned 401 |
| Capability matrix | Live, absent-backend and unreachable-backend deployments × reader/writer/no-access all matched expected configured/read/write flags |
| Reader API writes | Experiment create, prepare and pricing update returned 403 |
| Writer invalid requests | Reached canaryd validation (missing prepare ID returned 404; invalid prepare returned 400); no experiment created |
| Live reads | Config, catalog, deployments, pricing and experiment list returned 200; existing running/stopped experiment detail and metrics returned 200 |
| Browser: absent backend | No Canary sidebar group; direct `/canary` explained that it is not configured |
| Browser: no access | No Canary sidebar group; direct `/canary` showed permission denied |
| Browser: reader | Experiment/pricing navigation present, no creation entry/button; direct `/canary/new` showed permission denied |
| Browser: upstream unavailable | Canary navigation remained and list displayed API error/retry |
| Browser: writer | Creation entry/button present; live creation wizard and production target selector loaded |
| Browser: capability-request failure | Local fault injection showed feature-configuration error/retry while login/session and Help navigation remained usable |
| Browser: existing data | Running experiment stayed Serving; historical rows and TTFT metric details rendered |

```text
baseline inventory -> image-only dry-run -> Console rollout -> API matrix -> browser checks -> remove temporary test resources
```

The absence/outage tests used isolated Console instances with the same built image, rather than stopping the shared backend. No new experiment was deployed, no existing experiment was stopped, and global pricing was not changed; this validates the migration and access behaviour, not a new workload lifecycle run. Optional backend availability is deliberately separate from configuration and authorization.
