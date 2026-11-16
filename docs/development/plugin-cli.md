# ModelSphere Plugin CLI

本文档说明如何使用 modelsphere CLI 在 CPU16 集群安装、注册和卸载插件。

## 1. 职责划分

插件由一个 Helm release（运行时）和一条 Plugin CR（注册）共同组成：

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

| 主体 | 负责 | 不负责 |
| --- | --- | --- |
| CLI `plugin install` | 校验包、生成宿主 overlay、安装/升级插件 Helm release | 修改 Console 的 Helm values、升级 Console、创建 CR |
| CLI `plugin registration` | 从插件包和集群参数生成 Plugin CR | 执行 `kubectl apply` |
| 用户 / GitOps | 创建、禁用和删除 Plugin CR | 修改已安装 release 的内部资源 |
| Console | 监听 CR，读取已安装 release 的 `plugin.yaml` 和 `frontend/` 文件，挂载前端资源与后台路由 | 安装插件、修改插件 release |

Console 只观察已经部署的 release。CLI 安装与注册是两个独立动作，因此可以用 GitOps
管理 CR，也可以让不同的人分别执行安装和审批注册。

Console Chart 在 `crds/` 中携带 `modelsphere.dev_plugins` CRD。Helm 只在首次
`helm install` 时创建 `crds/` 下的 CRD；已经存在的 release 执行 `helm upgrade`
不会补装，升级到带插件能力的版本后需要单独执行一次：

```sh
kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" \
  apply -f "$CONSOLE_REPO/helm/console/crds/"
```

缺少 CRD 时 Console 的 informer 会持续报 `the server could not find the requested
resource`，`/readyz` 保持 503。Console 的 ServiceAccount 对 `plugins` 只有
`get/list/watch`，对 `plugins/status` 只有写权限；另外有一个 namespaced Role，
允许它在 Console 所在 namespace 读取 Helm 的 release Secret。插件 release 装在
其他 namespace 时，需要在该 namespace 额外授权同样的 Secret 读取权限，否则 CR
进入 `Degraded`。

## 2. 准备工具

需要：

- Go 1.26 或更高版本
- Helm 3.8 或更高版本
- kubectl
- 能访问 CPU16 集群的 VPN
- Console 仓库的 `imneov/polaris-global-plugin-runtime` 分支
- Canary 插件仓库的 `imneov/global-plugin-package` 分支

当前用户的 CLI 二进制位于 `~/Applications/bin/modelsphere`，该目录已经在当前 shell 的
`PATH` 中。其他用户安装时使用自己的 `$HOME/Applications/bin`。

连接集群前先启动 CPU16 对应的 VPN。当前集群参数：

| 参数 | 值 |
| --- | --- |
| kubeconfig | `/Users/neov/.kube/kubeconfig-cpu16-admin.yaml` |
| Kubernetes context | `kubernetes-admin@kubernetes` |
| Console release | `modelsphere-console` |
| Console namespace | `console-system` |
| Plugin namespace | `console-system` |
| Console URL | `http://172.28.44.16:30370` |

进入 Console 仓库并设置变量：

```sh
cd /Users/neov/orca/workspaces/console/可拔插
git switch imneov/polaris-global-plugin-runtime

export CONSOLE_REPO=/Users/neov/orca/workspaces/console/可拔插
export PLUGIN_REPO=/Users/neov/orca/workspaces/console/console-canary-plugin
export KUBECONFIG=/Users/neov/.kube/kubeconfig-cpu16-admin.yaml
export KUBE_CONTEXT=kubernetes-admin@kubernetes
export CONSOLE_RELEASE=modelsphere-console
export CONSOLE_URL=http://172.28.44.16:30370
```

非交互使用时，把默认值写入 ModelSphere 配置即可（`$XDG_CONFIG_HOME` 或
`~/Library/Application Support/modelsphere/config.yaml`）：

```yaml
kubeconfig: /Users/neov/.kube/kubeconfig-cpu16-admin.yaml
context: kubernetes-admin@kubernetes
console:
  release: modelsphere-console
  namespace: console-system
```

## 3. CLI 命令

```text
modelsphere plugin validate <chart-or-package>
modelsphere plugin package <chart-directory> --destination <directory>
modelsphere plugin list
modelsphere plugin install <chart-or-package> [flags]
modelsphere plugin registration <chart-or-package> [flags]
modelsphere plugin uninstall [group/name] [flags]
```

| 命令 | 作用 |
| --- | --- |
| validate | 校验 Chart 或 `.tgz` 包中的 `Chart.yaml` 和 `plugin.yaml` |
| package | 校验、执行 `helm lint`，并生成 `.tgz` 插件包 |
| list | 读取 Plugin CR，列出 group/name、版本、release 和状态 |
| install | 安装/升级插件 Helm release，按 `plugin.yaml` 的 `requires` 生成宿主 overlay |
| registration | 输出可直接 `kubectl apply` 的 Plugin CR YAML |
| uninstall | 选择或指定插件，先删除 Plugin CR，再卸载插件 Helm release |

CLI 的调试日志使用 kubectl 风格的数值 verbosity，日志写入 stderr，不污染 stdout：

| 参数 | 内容 |
| --- | --- |
| 默认 / `-v=0` | 只输出命令结果和错误 |
| `-v=1` | 输出阶段进度，以及长时间等待时的心跳 |
| `-v=2` | 输出 Helm/kubectl 命令和执行耗时 |
| `-v=4` | 转发经过脱敏的子进程 stderr |
| `-v=6` | 输出 stdout/stderr 字节数等诊断摘要 |

## 4. 生成发布包

普通用户使用 CI 发布的 `.tgz`。发布者在前后端镜像推送后，用插件仓库的脚本生成绑定
同一镜像版本的包：

```sh
node "$PLUGIN_REPO/hack/package-plugin.mjs" \
  --registry swr.cn-east-3.myhuaweicloud.com/risecloud \
  --tag 9de35525cdff005dd3a3d5660992486460c0ebfb \
  --destination "$CONSOLE_REPO"
```

脚本会把当前 Chart、`frontend/dist` 和 `plugin.yaml` 打进包，并执行 `helm lint --strict`。
CI 在镜像发布成功后上传同样的 `.tgz` artifact。

> 工作区现有的 `canaryd-0.3.0.tgz` 是旧格式的包：包内没有 `frontend/` 目录，
> `plugin.yaml` 仍是 `modelsphere.io/v1alpha1`。当前结构要求包内包含
> `frontend/<entry>`、`apiVersion: v1` 的 `plugin.yaml` 和带 `authProxy: true`
> 的 `ReverseProxy`；使用前必须按上面的命令重新打包，并确保后端镜像包含当前分支的代码。

`modelsphere plugin package` 保留给开发者校验源码 Chart；同名包默认拒绝覆盖，
显式 `--force` 时先验证新包再原子替换旧包。它不会自动选择发布镜像版本。

## 5. 安装运行时

install 的执行顺序：

1. 校验插件包。
2. 发现唯一的 Console Helm release；`--console-release` / `--console-namespace`
   可覆盖，`--plugin-namespace` 默认与 Console 同 namespace（装到其他 namespace 时
   要为 Console 的 ServiceAccount 补上该 namespace 的 release Secret 读取权限）。
3. 读取 Console 的 `externalSwiss`、`platform.inferenceNamespaces` 和
   `imagePullSecrets`。
4. 按插件包 `plugin.yaml` 的 `requires` 生成临时宿主 overlay。
5. Helm `upgrade --install` 插件 release，默认等待就绪。

```sh
cd "$CONSOLE_REPO"
modelsphere -v=2 --timeout 10m plugin install "$PLUGIN_PACKAGE"
```

预期输出：

```text
Installed runtime: modelsphere.dev/canary 0.4.0
Registration is separate: create a Plugin CR to load it in Console.
```

宿主能力映射见 [`plugin-platform-config.md`](plugin-platform-config.md)。要点：

| 插件声明 | Console 来源 | 结果 |
| --- | --- | --- |
| `requires.swiss: true` | `externalSwiss.url` 和 `externalSwiss.proxyKey` | 生成 `swiss.url` / `swiss.proxySecret*`，缺少配置时在 Helm 前失败 |
| `requires.inferenceNamespaces: true` | `platform.inferenceNamespaces` | 生成 `targetNamespaces` |
| `requires.imagePullSecrets: true` | Console values 的 `imagePullSecrets` | 生成同名 Secret 引用；要求插件与 Console 同 namespace，否则在 Helm 前失败 |

临时 overlay 以 `0600` 创建，安装结束即删除；包内和 overlay 都不包含 Secret 内容。

## 6. 注册插件

registration 只输出声明，不访问集群中的 CR（发现 Console release 除外）：

```sh
modelsphere plugin registration "$PLUGIN_PACKAGE" \
  --console-release "$CONSOLE_RELEASE" \
  --console-namespace console-system
```

输出示例：

```yaml
apiVersion: modelsphere.dev/v1alpha1
kind: Plugin
metadata:
  name: modelsphere.dev--canary
spec:
  type: helm
  scope: platform
  enabled: true
  version: 0.3.0
  chart:
    name: canaryd
    namespace: console-system
    releaseName: canary
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `metadata.name` | `group--name` 的可逆编码；Console 用它作为资源路径 `/plugins/<name>/` |
| `spec.version` | 已安装 Chart 的版本；必须与 Helm release 中的 Chart 版本一致 |
| `spec.chart.name` | Chart 名称，不是插件产品名 |
| `spec.chart.releaseName` | Helm release 名称；默认取 `plugin.yaml` 的 `name` |
| `spec.chart.namespace` | release 所在 namespace |
| `spec.enabled` | `false` 时不加载前端和路由，但保留 release 与 IAM |

审核后手动 apply：

```sh
modelsphere plugin registration "$PLUGIN_PACKAGE" \
  --console-release "$CONSOLE_RELEASE" \
  --console-namespace console-system \
  | kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" apply -f -
```

Console 通过 informer 监听 CR，不轮询。启动时先列出全部 CR 并完成首次同步，
`/readyz` 在同步完成前返回 503，避免 Pod 在插件资源可用前接收流量。

## 7. 验证

查看 CR 与状态：

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  plugin list
```

```text
IDENTITY                VERSION  KIND    RELEASE  STATUS
modelsphere.dev/canary  0.4.0    Plugin  canary   Installed
```

`STATUS` 来自 CR 的 `status.phase`：`Installed`、`Degraded`、`Pending`；`spec.enabled=false`
显示为 `Disabled`。`VERSION` 是 `plugin.yaml` 的产品版本，不是 Chart 版本。

检查 Console 侧的加载结果：

```sh
helm --kubeconfig "$KUBECONFIG" --kube-context "$KUBE_CONTEXT" \
  status canary --namespace console-system

curl -fsS "$CONSOLE_URL/plugins/index.json" | jq .
curl -fsS -o /dev/null -w 'entry_http=%{http_code}\n' \
  "$CONSOLE_URL/plugins/modelsphere.dev--canary/index.umd.js"
```

`index.json` 中应出现 `id: canary`、`entry: /plugins/modelsphere.dev--canary/index.umd.js`
和 `backend` 声明。

登录 Console 后打开：

```text
http://172.28.44.16:30370/canary
```

后台路由由 Console 代理：`/api/canary/*` 命中已安装 release 中的
`ReverseProxy`。请求先经过 Console IAM 鉴权（资源 `backends`，名称 `canary`），
再带上 `X-Remote-User` / `X-Remote-Group` 转发。没有对应 RBAC 的用户会收到 403。
插件的 `ReverseProxy` 必须满足：路径以 `/api/` 开头、`authProxy: true`、
upstream 使用 http/https 和合法端口；否则该 CR 进入 `Degraded`，且不加载前端。

## 8. 禁用与恢复

禁用不卸载 release，也不删除 CR：

```sh
kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" \
  patch plugins.modelsphere.dev modelsphere.dev--canary \
  --type merge -p '{"spec":{"enabled":false}}'
```

Console 会立即从 index 和路由中移除该插件；重新设为 `true` 后恢复。CR 删除或禁用时，
已加载的前端资源与后台路由同时失效，不需要重启 Console。

## 9. 卸载插件

uninstall 的执行顺序：

```text
选择 CR
   |
   v
删除 Plugin CR          Console 停止提供前端资源和路由
   |
   v
Helm uninstall release  删除 Deployment / Service / PVC 等运行时
```

交互选择卸载目标：

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  -v=2 --timeout 10m \
  plugin uninstall
```

脚本中使用完整身份，并通过 `--yes` 跳过确认：

```sh
modelsphere \
  --kubeconfig "$KUBECONFIG" \
  --context "$KUBE_CONTEXT" \
  --timeout 10m \
  plugin uninstall modelsphere.dev/canary \
  --yes \
  --wait
```

预期输出：

```text
Uninstalled: modelsphere.dev/canary
```

卸载后检查：

```sh
kubectl --kubeconfig "$KUBECONFIG" --context "$KUBE_CONTEXT" \
  get plugins.modelsphere.dev

helm --kubeconfig "$KUBECONFIG" --kube-context "$KUBE_CONTEXT" \
  status canary --namespace console-system

curl -fsS "$CONSOLE_URL/plugins/index.json"
```

CR 应已消失，Helm 应返回 `release: not found`，index 中不再出现 `"id": "canary"`。

## 10. 失败处理

| 阶段 | CLI / Console 行为 | 检查方式 |
| --- | --- | --- |
| 包校验失败 | 不执行任何集群操作 | 修复 `plugin.yaml` 或 Chart 后重新 validate |
| 缺少宿主能力 | 在 Helm 前失败（缺 Swiss 配置、推理 namespace、跨 namespace 的镜像 Secret） | 补齐 Console values 后重试 |
| 插件 Helm 安装失败 | Console 没有 CR，不受影响 | `helm status <release> -n <namespace>` |
| CR 未创建 | 运行时存在但 Console 不加载 | `modelsphere plugin list`，确认 CR 是否存在 |
| Chart 与 CR 不匹配 | CR `Degraded`，不加载前端或路由 | 核对 `spec.version`、`spec.chart.name`、`spec.chart.releaseName` |
| release 未部署 | CR `Degraded` | `helm status`，确认状态是 `deployed` |
| release 在 Console namespace 之外 | Console 无权读取 Helm release Secret，CR `Degraded` | 在该 namespace 为 Console 的 ServiceAccount 授权 Secret `get/list`，或改装到 Console namespace |
| Console 缺 `plugins` 权限 | informer 报 `forbidden`，`/readyz` 持续 503 | 升级到包含 `plugins` ClusterRole 与 release Secret Role 的 Console Chart 版本 |
| 前端入口缺失或路径非法 | CR `Degraded`，不提供资源 | 重新打包，确认包内有 `frontend/<entry>` |
| CR 注销失败 | CLI 停止，不卸载 release | 先修复 API 访问，再执行 uninstall |
| 后台接口 403 | Console IAM 拒绝 | 给用户绑定包含 `backends/canary` 的 `get` 权限 |

不要手工修改插件 release 内部资源。Console 的插件注册只来自 Plugin CR，
release 的安装、升级和卸载由 Helm 管理。
