# Console Helm Chart

[English](README.md)

**把 ModelSphere Console 装进 Kubernetes 的安装包。** CI 把镜像和 Chart 以同一个版本发布到 GHCR，无需登录即可拉取：

| 制品 | 地址 |
|---|---|
| Chart | `oci://ghcr.io/modelsphere/charts/console` |
| 镜像 | `ghcr.io/modelsphere/console`（linux/amd64），tag 与 Chart 版本相同 |

## 它不做什么

- **不安装、不修改已有的 Swiss 和推理网关** —— 只读取它们的 ConfigMap / Secret。
- **不需要 `install.sh`** —— 它是源码仓库里的可选辅助脚本（自动发现 Swiss 和网关、生成 values、安装后做端到端验证），不在 Chart 包内，本文流程不使用它。用法见 `./install.sh --help`。

## 快速上手

先确认[前置条件](#前置条件)。以下只装 Console；模型由 Swiss 部署，见[接入已有 Swiss](#接入已有-swiss)：

```bash
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace \
  --wait --timeout 20m

kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

浏览器打开 `http://127.0.0.1:8080`，用 `admin` / `P@88w0rd` 登录。

> **首次登录会要求设置密码**：设置后才能继续使用。可以沿用初始密码（页面会提醒），建议换成自己的密码。

不写 `--version` 时安装最新正式版；重复执行即升级。版本见[选择版本](#选择版本)。

## 两种装法

| 装法 | 适用 | 额外 values | 得到什么 |
|---|---|---|---|
| 只装 Console | 先看界面、管用户 | 无 | 登录、用户和角色；没有模型，Playground 和 `/v1` 不可用 |
| 接入已有 Swiss | 集群已运行 Swiss 和 OpenResty 推理网关 | `--values console-values.yaml`，见[接入已有 Swiss](#接入已有-swiss) | 模型服务页面；Playground 和 `/v1` 调用在那里部署的模型 |

## 选择版本

| 来源 | 版本 | 用法 |
|---|---|---|
| 正式版（推送 `X.Y.Z` tag） | `X.Y.Z` | 不写 `--version` 即最新正式版；固定版本用 `--version X.Y.Z` |
| `main` 的每个 commit | `<appVersion>-git<commit 前 7 位>`，例如 `0.1.1-git3affbe6` | `--version 0.1.1-git3affbe6` |

`main` 的构建要写完整版本号。**不要用 `--devel` 取"最新"构建**：这类版本之间按 commit 哈希的字母顺序比较，选出来的不是最新的 commit。可用版本列在 [GitHub Packages](https://github.com/modelsphere/console/pkgs/container/charts%2Fconsole) 页面。

## 前置条件

| 条件 | 适用 | 原因 | 检查 |
|---|---|---|---|
| `helm` 3.8 及以上（Helm 4 也可）、`kubectl` | 全部 | 从 OCI 仓库安装需要 Helm 3.8+ | `helm version` |
| Helm 使用 cluster-admin 级权限 | 全部 | Chart 创建 IAM CRD、ClusterRole/ClusterRoleBinding（platform-admin 角色含 `*` 权限，Kubernetes 只允许已持有这些权限的用户创建），接入 Swiss 时还要在其他 namespace 创建 Role | `kubectl auth can-i '*' '*' --all-namespaces` 输出 `yes` |
| linux/amd64 节点 | 全部 | 镜像只有 amd64 | `kubectl get nodes -L kubernetes.io/arch` |
| 节点能访问 `ghcr.io` | 全部 | Console 镜像在 GHCR | — |
| Swiss Chart 0.7.0 及以上且开启 `auth.proxyKey`，或 Swiss 以 `auth.disabled=true` 运行 | 接入 Swiss | Console 用 proxyKey 代表登录用户访问 Swiss；目录 schema v2 和 site profile 的 `schemaVersion`/`writable` 也从 0.7.0 开始支持 | 见[找到 Swiss 和网关](#1-找到-swiss-和网关) |
| Swiss site profile 已存在，且 `cluster.profile.key` 为 `profile.yaml`（默认值） | 接入 Swiss | Console 从 profile 读取网关入口，且只读 `profile.yaml` 这个 key；profile 在 Swiss 网页首次保存设置时才创建 | 同上 |

## 接入已有 Swiss

```text
找到 Swiss 和网关 -> 复制 proxyKey 到 modelsphere -> 写 console-values.yaml -> helm upgrade --install
```

### 1. 找到 Swiss 和网关

```bash
# Swiss Service：记下 NAMESPACE、NAME、PORT
kubectl get svc -A -l app.kubernetes.io/name=swiss

# Swiss 配置（ConfigMap 与 Service 同名）：
#   server.auth.disabled       为 true 时跳过第 2 步
#   cluster.profile.configMap  即 site profile，格式 namespace/name
#   cluster.profile.key        必须为 profile.yaml
kubectl -n <swiss-namespace> get configmap <swiss-name> -o jsonpath='{.data.swiss\.yaml}'

# site profile：记下 route.nginxService、route.nginxConfigMap、route.auth.secretRef
kubectl -n <profile-namespace> get configmap <profile-name> -o jsonpath='{.data.profile\.yaml}'
```

### 2. 复制 proxyKey

Secret 不能跨 namespace 读取，所以把 Swiss 的 proxyKey 复制一份到 Console 所在的 namespace。Swiss 的登录 Secret 默认名为 `<swiss-name>-auth`：

```bash
kubectl create namespace modelsphere --dry-run=client -o yaml | kubectl apply -f -
kubectl -n <swiss-namespace> get secret <swiss-name>-auth -o jsonpath='{.data.proxyKey}' | base64 -d > proxyKey
kubectl -n modelsphere create secret generic swiss-proxy-key --from-file=proxyKey
rm proxyKey
```

第二条没有输出时，说明这个 Swiss 没有 proxyKey：升级 Swiss Chart 到 0.7.0 及以上，或让它以 `auth.disabled=true` 运行。

### 3. 写 values

示例 values 在 Chart 包里，取出后用编辑器按下表修改：

```bash
helm pull oci://ghcr.io/modelsphere/charts/console --untar --untardir /tmp/console-chart
cp /tmp/console-chart/console/values-existing-stack.example.yaml console-values.yaml
```

所有引用写成 `namespace/name`。

| values | 填什么 | Chart 在该 namespace 创建只读 Role |
|---|---|---|
| `externalSwiss.url` | `http://<swiss-name>.<swiss-namespace>.svc:<port>/api`，必须以 `/api` 结尾 | — |
| `externalSwiss.proxyKey.secretName` | 第 2 步的 `swiss-proxy-key`；Swiss 以 `auth.disabled=true` 运行时删除此行 | — |
| `externalSwiss.profile` | Swiss 的 `cluster.profile.configMap` | 是 |
| `playground.gateway.service` | profile 的 `route.nginxService` | 是 |
| `playground.gateway.secretRef` | profile 的 `route.auth.secretRef`；它只有 name 时，namespace 是 **Swiss 所在的 namespace**。profile 没有此字段时删除此行 | 是 |
| `playground.gateway.configMap` | **不设置**：已有 profile 时 Console 拒绝启动 | — |

只读 Role 名为 `console-console-gateway`，只授予 `configmaps`、`secrets` 的 `get`。Console 还会读取 profile 中的 `route.nginxConfigMap`；它在上表以外的 namespace 时，安装后手动授权：

```bash
kubectl -n <route-namespace> create role console-console-gateway --verb=get --resource=configmaps,secrets
kubectl -n <route-namespace> create rolebinding console-console-gateway \
  --role=console-console-gateway --serviceaccount=modelsphere:console-console
```

### 4. 安装

```bash
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace \
  --values console-values.yaml \
  --wait --timeout 10m
```

## 新增模型（可写目录）

只读目录足以部署。**新增模型**、**编辑模型**、**新增变体**和**目录设置**则需要**可写**目录，即提供 schema v2 的 catalog-server；静态 `index.json` 目录保持只读。

| 你的安装 | 可写目录从哪来 |
|---|---|
| 自带 Swiss（`swiss.enabled=true`） | 打开 swiss chart 的 `catalogServer`（0.7.0+），见下 |
| 接入已有 Swiss（`externalSwiss`） | 把 Swiss 升到 Chart 0.7.0 并打开它的 `catalogServer`，或让 swissd 指向任意可达的 catalog-server |

```bash
# 写 token：catalog-server 从 Secret 读取，同一个值稍后填进 site profile。不要写进 values 文件。
TOKEN=$(openssl rand -hex 24)
printf -- '- name: console\n  email: console@example.com\n  token: %s\n' "$TOKEN" > tokens.yaml
kubectl -n modelsphere create secret generic console-catalog-tokens --from-file=tokens.yaml
rm tokens.yaml
printf 'Write token: %s\n' "$TOKEN"

helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere \
  --set swiss.enabled=true --set 'swiss.rbac.namespaces={models}' \
  --set swiss.catalogServer.enabled=true \
  --set swiss.catalogServer.tokens.existingSecret=console-catalog-tokens
```

这会在 release 所在 namespace 运行 catalog-server，目录地址为 `http://<release>-catalog-server.<namespace>.svc`。目录仓库放在 PVC 上，`helm upgrade` 和 `helm uninstall` 都会保留；存储、token、可选 ingress 都是 swiss chart 的 values（`helm show values oci://ghcr.io/modelsphere/charts/swiss --version 0.7.0`）。

然后在 Console 里：

1. **模型服务 → Site Profile**：新增目录，`schemaVersion: v2`、勾选 **Writable**、填入上面的写 token。对应上面的 release：

   ```yaml
   catalogs:
     - name: local
       url: http://console-catalog-server.modelsphere.svc
       schemaVersion: v2
       writable: true
   ```

2. **模型库**：目录为空时点 **Set up this catalog**，之后点 **New model**。每次改动都是目录 git 仓库的一次提交；模型和变体的编辑见[部署模型](https://github.com/modelsphere/console/blob/main/web/src/modules/docs/content/zh-CN/deploy.md#编辑目录中的变体)。

## 检查和登录

```bash
helm -n modelsphere status console
kubectl -n modelsphere get pods,svc
kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

浏览器打开 `http://127.0.0.1:8080`（Service 默认是 NodePort，也可用 NOTES 打印的节点地址），用 `admin` / `P@88w0rd` 登录。

> **首次登录会要求设置密码**：设置后才能继续使用。可以沿用初始密码（页面会提醒），建议换成自己的密码。

集群中已有同名 IAM User（例如 Rise Global 的）时，Chart 不会覆盖它，`helm status` 输出的 NOTES 会说明。

## 卸载

```bash
helm -n modelsphere uninstall console
```

以下对象不会随 release 删除，重新安装时会继续使用：

| 对象 | 原因 | 手动清理 |
|---|---|---|
| 路由 API 密钥 Secret `console-console-api-keys` | Console 运行时创建，不属于 release | `kubectl -n modelsphere delete secret console-console-api-keys` |
| 复制的 `swiss-proxy-key` | 手动创建 | `kubectl -n modelsphere delete secret swiss-proxy-key` |
| IAM 数据：User、IAMRole、IAMRoleBinding、LoginRecord（集群级） | Console 运行时创建（Chart 种下的管理员 User 属于 release，会被删除） | 见下 |
| IAM CRD `*.iam.theriseunion.io` | Helm 不删除 `crds/` 中的资源 | 见下 |

IAM CRD 和数据与 Rise Global 共用同一套定义。集群中还有 Rise Global 或其他 Console 时**不要删除**；确认只有本 Console 使用后，删除 CRD 会连同全部用户、角色和登录记录一起删除：

```bash
kubectl delete crd users.iam.theriseunion.io iamroles.iam.theriseunion.io \
  iamrolebindings.iam.theriseunion.io loginrecords.iam.theriseunion.io
```

## 常用 values

完整说明见 `values.yaml` 的注释（`helm show values oci://ghcr.io/modelsphere/charts/console`）。

| values | 作用 |
|---|---|
| `externalSwiss.*` | 接入已有 Swiss，见上文 |
| `playground.gateway.*` | 直接指定推理网关（没有 Swiss 时用 `configMap` + `service`） |
| `service.type` | 暴露方式，默认 `NodePort` |
| `admin.encryptedPassword` | 预先设定管理员密码的 bcrypt 哈希 |
| `metrics.serviceMonitor.enabled` | 使用 Prometheus Operator 采集指标 |
| `auth.jwtSecret` | 与 Rise Global 共享签名密钥；为空时首次安装自动生成 |
| `auth.disabled=true` | 关闭登录，所有请求以本地管理员身份执行；见下节 |

## 关闭登录（auth.disabled）

笔记本、演示环境，或者外层已有认证的单租户集群，可以不要登录页：

```sh
helm upgrade --install console oci://ghcr.io/modelsphere/charts/console \
  --namespace modelsphere --create-namespace --set auth.disabled=true
```

这时 console 不再签发或校验 token，每个请求都带一个合成的 `admin`
身份（`system:masters`），授权器的短路分支让它通过所有检查。前端不再显示登录
页，用户菜单里的"修改密码"和"退出登录"一并隐藏——两者都没有可操作的对象。

| 影响 | 说明 |
|---|---|
| 整条链路都没有鉴权 | Console 是 Swiss 前面唯一做授权的一层。这里关掉，栈里就没有任何一层做授权了 |
| 不要暴露在共享网络上 | 任何能访问到这个地址的人都是管理员 |
| 签名密钥照常生成 | Secret 仍然存在，`auth.jwtSecret` 仍可用于与 Rise Global 共享 |
| 管理员 User 照常创建 | 没人用它登录，但保留它意味着改回 `auth.disabled=false` 只是改一个值；把它从 manifest 里去掉会让 helm 删除它 |

启动时会打印一条 warning，`helm install` 的 NOTES 也会提示。改回来时在同一条命令里改为 `--set auth.disabled=false`。

## 发布

两个 workflow：[`ci`](https://github.com/modelsphere/console/actions/workflows/ci.yml) 和 [`publish`](https://github.com/modelsphere/console/actions/workflows/publish.yml)（与 Swiss 的相同）：

| 触发 | 版本 | 推送 |
|---|---|---|
| push 到 `main` | `<appVersion>-git<sha7>` | 镜像和 Chart |
| 推送 tag `X.Y.Z`（必须等于 `Chart.yaml` 的 `appVersion`） | `X.Y.Z` | 镜像（另打 `latest`）和 Chart |
| pull request | `<appVersion>-git<sha7>` | 不推送，只测试、构建、打包 |

```text
ci:      go vet、go test、前端类型检查和测试、仓库 gate
publish: 构建镜像 -> helm dependency build、lint --strict、打包 -> 推送镜像和 Chart
```

发布正式版：

```bash
hack/bump.sh patch --tag     # 改 Chart.yaml 与 internal/version，提交并打 tag
git push origin main --follow-tags
```

新建的 GHCR package 默认是私有的。第一次发布后，要在 package 设置里改为 Public，否则匿名拉取会失败。
