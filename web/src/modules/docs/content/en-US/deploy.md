# Deploying models

Swiss (swissd) on the cluster performs every deployment. Each install, upgrade and rollback first composes a **plan** and previews the change; nothing runs until you confirm.

## First use: site setup

If swissd has no site profile yet, Model Serving opens on **Site setup**. Describe the cluster and save:

- model catalog: where deployable models come from
- chart and image registries
- model path template: where weights live on the nodes

You can change it any time in [Site Profile](/inferences/site-profile), as a form or as YAML. The server validates it before saving.

## 1. Pick a model

Open the [Model Library](/inferences/catalog):

- Narrow it down with search and filters (family, engine, hardware, tag); "Tuned only" keeps models with tuned variants.
- Click a card for details. The **Variants** tab lists the ways the model can be deployed (GPU model, GPU count, engine), each with "N nodes available" computed from the cluster's free GPUs.
- Click **Deploy** on the variant you want.

## 2. Fill in the form

| Section | Main fields | Notes |
|---|---|---|
| Basics | Service name, namespace | The service name also names the helm release, route, scaler and SLO; lowercase letters, digits and `-`, at most 53 characters. **Cannot be changed later** |
| Resources & scheduling | Autoscaling / replicas, GPU models, tolerations | Autoscaling is on by default: LLMScaler keeps replicas between the bounds |
| Routing | Publish route, route path, concurrency limit | Only with "Publish route" on can the model be called through the gateway and the Playground |
| SLO & monitoring | TTFT / TPS thresholds, ServiceMonitor | The scaler sizes replicas against the SLO |
| Advanced | Image override, model path, YAML overrides | Rarely needed |

Most fields can stay empty and take the site profile's and chart's defaults.

**Adaptive concurrency** groups the master switch, floor fraction, absolute floor, start point, idle hold, and TTFT decisions together; its internal knobs are available under **Advanced adaptive options**. Turning the switch off hides and clears the group's entered values; turning it back on does not restore them. **Default peer maximum** stays in **Capacity & failover** and still applies when adaptive concurrency is off; it also influences the static maximum used for adaptive bounds. Review the diff before confirming an upgrade.

## Video models

A variant whose engine is `video` (such as MiniMax H3, chart `minimax-h3`) opens a form of its own: none of the LLM settings (SLO thresholds, CART, compile cache, image override, route tuning) apply.

| Field | Notes |
|---|---|
| Pools | FL2VA (text and first/last frame to video) and Ref2VA (reference media to video), each on or off with its own replicas, TP size and Ulysses degree. GPUs per pod = TP × Ulysses; the form shows the total |
| Turbo | Ref2VA only: the 8-step Turbo LoRA; off serves the base model |
| Autoscale / SLO | One switch for the scaler and the SLO requirements. The chart creates one SLO per pool with a minimum of 1 replica and **no maximum, so nothing is scaled yet** |
| Storage | The shared asset volume: its storage class must support ReadWriteMany; empty uses the cluster default |
| Database URL | Optional; empty uses the chart's default. On an upgrade, empty keeps the release's own |

To scale a pool, open **Edit SLO** on the release once it is up. There is one section per pool:

- **Bounds**: the minimum (replicas or concurrency) and the maximum (replicas). An empty maximum is autoscaling off. A save only adds or changes values, so to turn a pool's scaling off again use **Reset**: it removes the maximum and sets the priority back to normal, and keeps the minimum and the queue settings. Set the priority again after a reset if the pool had it high.
- **Max queue depth**: queued and running tasks per replica before the pool gets another replica.
- **Priority**: high or normal.

A video release serves a job API rather than chat. Its access card shows how to submit a task (`POST /v2/video_generation`), poll it (`GET /v2/query/video_generation/<task_id>`) and download the result (`GET /v2/video_generation/<task_id>/content`, no key needed). Its **Check** runs a readiness probe of the route's `/readyz`, which answers only when the router, a server and the database behind it are all up. It is not offered in the Playground.

Download links point back at H3. When the site profile names a `route.gateway`, the gateway URL for the release's route is filled in for the chart automatically. An explicit `server.config.publicBaseUrl` in the Override YAML still wins.

## Generation recovery

Enable **Routing → Generation recovery** in the deploy or upgrade form. Enter the **Actual model** whose weights are deployed, such as `kimi-k3` or `glm-5.3`. This selects the continuation strategy; it is not the client-facing served name.

- Requires **CART**, **Publish a route**, and `sglang` chart **0.8.11+** or `vllm` chart **0.8.9+**. Composing the plan checks these conditions.
- **Stream idle timeout** is the time without a chunk after streaming starts; clearing removes the stored form timeout override and inherits catalog, site and chart settings.
- **Resume interrupted responses** is on by default; off detects and logs interruptions without sending a continuation request.
- **Buffer tool calls** holds arguments until a complete call can be sent together, so interrupted calls can be regenerated.
- Requests flow through `openresty → continuation gateway → CART → inference instance`. The gateway is deployed with the model release; review and confirm the diff before applying.
- Unsupported requests, including structured JSON output, pass through. Verify the actual model and engine combination against the [gateway compatibility documentation](https://github.com/modelsphere/continuation_gateway).
- Upgrades carry the configured recovery settings forward. Turn the switch off, compose and confirm to remove the gateway. Advanced YAML takes precedence over the form; if it overrides the recovery controls, update it before composing the plan.

## 3. Review and confirm

**Compose plan** opens the review:

- **Plan**: the configuration layers this deployment is made of.
- **Diff**: what will change compared with the cluster.
- **Change note**: why you are making the change; it goes into the activity log.

Click **Deploy** to confirm.

## 4. Wait until ready

Watch the [Inference Services](/inferences) list:

| State | Meaning |
|---|---|
| Applying | helm is running |
| Loading | pods are scheduled and reading weights |
| Serving | ready for traffic |
| Failed | the deployment failed; see its output in Activity |
| Not ready | not ready after an hour, longer than a normal load; investigate |

> **A cold start takes 20–40 minutes.** Loading large weights is slow; "Loading" is usually not an error.

Click a service for its details. **Overview** shows progress step by step: applied → instances ready → routed → autoscaling. The other tabs:

| Tab | Contents |
|---|---|
| Instances | pods, their nodes and restart counts |
| Logs | recent logs per pod and container |
| Events | Kubernetes events, optionally warnings only (kept for one hour by default) |
| Versions | revision history; view the values of any revision and roll back |
| Activity | this service's installs, upgrades and rollbacks |
| Plan | how the current plan is composed |

## Upgrade, roll back, uninstall

From a row's actions in the list, or the top of the detail page:

- **Upgrade**: change the model version, variant or settings; again you review the diff before confirming. Service name and namespace are fixed.
- **Roll back**: pick a revision under Versions to restore its plan as it was. To change settings, upgrade instead.
- **Edit SLO**: the latency and throughput targets and the replica bounds the scaler works with. Services deployed without SLO need it switched on in an upgrade first.
- **Uninstall**: stops the service and deletes its pods; the activity log is kept. Reinstalling loads the weights again.
- While pods are still terminating the service stays listed as **Uninstalling**; upgrade, roll back, SLO edits and uninstall stay disabled until it disappears.

"Behind catalog" in the list means the catalog has a newer version to upgrade to; "Untracked" means the release was not deployed by Swiss and cannot be upgraded here.

## Edit a catalog's variants

A catalog-server catalog can be edited from a model's page. In the [Site profile](/inferences/site-profile) editor, tick the catalog **Writable** and enter its catalog-server **Write token**; swissd keeps the token in its own Secret. Any later change to the catalog other than **Default** (its URL, its name, unticking **Writable**) removes the token: enter it again with the change. Saving checks the token with the catalog server first, a new catalog's too: if the server does not accept it or cannot be reached, nothing is saved and the editor says why. Each change is one commit to the catalog.

| Action | Where | What to know |
|---|---|---|
| Set up an empty catalog | **Set up this catalog** in the model library's toolbar | where the catalog is served and its repository; until then it takes no models |
| Catalog settings | **Catalog settings** in the model library's toolbar | its `catalog.yaml`: `site`, `raw`, `repo` |
| Add a model | **New model** in the model library's toolbar | its name and first variant id, its `metadata.yaml`, and the variant, copied from one the catalog has |
| Edit a model | **Edit model** in a model's header | its `metadata.yaml`: description, default variant, tuning |
| Add a variant | **Add variant** in the header | starts as a copy of the default variant at version 1.0.0; set its `id`, which is also its file name |
| Edit | the variant card's `⋯` menu | raise `version` on every change (**Raise version** does it); **Check** validates without committing |
| Delete | the variant card's `⋯` menu | refused for the default variant, one a tuning result names, or the model's last; its history stays |

- A writable catalog is labelled **Writable** in the model library's catalog selector.
- If someone changed the file after you opened it, saving says so; reload it and edit again.
- Commits are authored by the token's owner, not by you.
- If the token is changed or removed on the catalog server later, the next change says so; enter the new one in the Site profile editor.
- Editing needs the model deployment backend's (`swiss`) permissions: `update` to add or edit a variant or set a token, `delete` to delete either.

## Nodes and activity

- [Nodes](/inferences/nodes): the cluster's GPU inventory — free GPUs, the largest free slot on one node, models in stock, and unavailable nodes. Check here before deploying.
- [Activity](/inferences/runs): every install, upgrade, rollback and uninstall swissd has run; expand a row for its full output.

## Read-only mode

If action buttons are greyed out with "this swissd is read-only", swissd on the cluster is not allowed to deploy and you can only look. An operator has to turn on `allowDeploy` in Swiss's configuration.
