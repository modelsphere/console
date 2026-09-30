# Console Helm Chart

**把 ModelSphere Console 装进 Kubernetes 的安装包。**

## 它不做什么

- **不安装、不修改 Swiss 和已有网关** —— 只对它们的 ConfigMap / Secret 做 `get`。
- **不按 commit 构建镜像** —— 每个 commit 的 Chart 都使用同一个固定镜像 `swr.cn-east-3.myhuaweicloud.com/risecloud/console:0.1.0-dev.4f512ab`（公开、仅 linux/amd64）。文件名中的 commit SHA 只标识 Chart 内容。
- **不需要 `install.sh`** —— 它是源码仓库里的可选辅助脚本（自动发现 Swiss 和网关、生成 values、安装后做端到端验证），不在 Chart 包内，本文流程不使用它。用法见 `./install.sh --help`。

## 快速上手

先确认[前置条件](#前置条件)。

```text
下载并校验 -> [仅接入已有 Swiss：写 console-values.yaml] -> helm upgrade --install -> port-forward -> 登录并改密码
```

方括号一步见[第 2 步](#2-接入已有-swiss写-values)，此时 `helm` 命令加 `--values console-values.yaml`（见[第 3 步](#3-安装)）。

以下命令为独立模式（内置网关 + CPU 演示模型）。每次都下载到新的临时目录，重复执行即升级。

```bash
# 1. 下载 main 最新的安装包并校验（输出 OK 才继续）
ARTIFACT_DIR=$(mktemp -d)
RUN_ID=$(gh run list -R modelsphere/console -w "Helm chart" -b main -s success -L 1 \
  --json databaseId -q '.[0].databaseId')
gh run download "$RUN_ID" -R modelsphere/console -p 'console-chart-*' -D "$ARTIFACT_DIR"
PACKAGE=$(find "$ARTIFACT_DIR" -name 'console-*.tgz')
(cd "$(dirname "$PACKAGE")" && sha256sum -c ./*.sha256)

# 2. 安装
helm upgrade --install console "$PACKAGE" \
  --namespace modelsphere --create-namespace \
  --wait --timeout 20m

# 3. 访问 http://127.0.0.1:8080
kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

用 `admin` / `P@88w0rd` 登录。

> **首次登录会要求修改密码**：按页面提示设置新密码后才能继续使用。

## 两种模式

设置了 `playground.gateway.profile` 或 `playground.gateway.configMap` 中任一项，Chart 就改用已有网关，不再安装内置网关和演示模型。接入 Swiss 时只用 `profile`。

| 模式 | 适用 | 安装内容 |
|---|---|---|
| 独立模式（默认） | 集群没有 Swiss | Console + 内置 OpenResty 网关 + CPU 演示模型 |
| 接入已有 Swiss | 集群已运行 Swiss 和 OpenResty 推理网关 | 仅 Console；读取 Swiss 与网关的配置 |

## 前置条件

| 条件 | 适用模式 | 原因 | 检查 |
|---|---|---|---|
| `helm` v3、`kubectl` | 全部 | 安装与检查 | `helm version` |
| `sha256sum`（GNU coreutils） | 全部 | 校验安装包；macOS 用 `shasum -a 256 -c` 代替 `sha256sum -c` | `sha256sum --version` |
| `gh` 已登录，账号可读私有仓库 `modelsphere/console` | 全部（网页下载时不需要 `gh`） | 安装包是该仓库的 Actions artifact | `gh auth status` |
| Helm 使用 cluster-admin 级权限 | 全部 | Chart 创建 IAM CRD、ClusterRole/ClusterRoleBinding（platform-admin 角色含 `*` 权限，Kubernetes 只允许已持有这些权限的用户创建），并在其他 namespace 中创建 Role/RoleBinding | `kubectl auth can-i '*' '*' --all-namespaces` 输出 `yes` |
| linux/amd64 节点 | 全部 | Console 镜像只有 amd64 | `kubectl get nodes -L kubernetes.io/arch` |
| 节点能拉取 `swr.cn-east-3.myhuaweicloud.com` | 全部 | Console 镜像所在仓库 | — |
| 默认 StorageClass、约 2 CPU / 2 GiB 空闲 | 独立 | 演示模型权重存在 PVC 中 | `kubectl get storageclass` |
| 节点能访问 Docker Hub、ghcr.io，以及 modelscope.cn 或 hf-mirror.com | 独立 | 拉取网关与 llama.cpp 镜像，首次启动下载约 500 MB 模型权重 | — |
| Swiss 以 `auth.disabled=true` 运行 | 接入 | 登录和权限由 Console 统一处理 | 见[找到 Swiss 和网关](#找到-swiss-和网关) |
| Swiss site profile 已存在，且 `cluster.profile.key` 为 `profile.yaml`（默认值） | 接入 | Console 从 profile 读取网关入口，且只读 `profile.yaml` 这个 key；profile 在 Swiss 网页首次保存设置时才创建 | 同上 |
| `playground.gateway.*` 引用的 namespace 均已存在 | 接入 | Chart 在这些 namespace 中创建 Role | `kubectl get ns <namespace>` |

## 1. 下载安装包

每个 push 到 GitHub 的 commit 都会运行 [`Helm chart` workflow](https://github.com/modelsphere/console/actions/workflows/helm-chart.yml)，产出 artifact `console-chart-<version>-git<commit-sha>`（保留 30 天）：

```text
console-<version>-git<commit-sha>.tgz
console-<version>-git<commit-sha>.tgz.sha256
values-existing-stack.example.yaml
```

| 方式 | 做法 |
|---|---|
| 命令行 | [快速上手](#快速上手)第 1 步；指定 commit 时把 `-b main` 换成 `-c <commit-sha>` |
| 网页 | 见下图；之后令 `PACKAGE=<解压目录>/console-<version>-git<commit-sha>.tgz` |

```text
workflow 页面 -> 选择目标 commit 的成功 run -> Artifacts -> 下载 zip -> 解压到新目录 -> 在该目录执行 sha256sum -c ./*.sha256
```

校验输出 `OK` 才继续。

## 2. 接入已有 Swiss：写 values

独立模式跳过本节。

### 找到 Swiss 和网关

```text
Swiss Service -> Swiss ConfigMap (swiss.yaml) -> site profile (profile.yaml) -> 网关 Service / 路由 ConfigMap / 密钥 Secret
```

```bash
# Swiss Service：记下 NAMESPACE、NAME、PORT
kubectl get svc -A -l app.kubernetes.io/name=swiss

# Swiss 配置（ConfigMap 与 Service 同名）：
#   server.auth.disabled       必须为 true
#   cluster.profile.configMap  即 site profile，格式 namespace/name
#   cluster.profile.key        必须为 profile.yaml
kubectl -n <swiss-namespace> get configmap <swiss-name> -o jsonpath='{.data.swiss\.yaml}'

# site profile：记下 route.nginxService、route.nginxConfigMap、route.auth.secretRef
kubectl -n <profile-namespace> get configmap <profile-name> -o jsonpath='{.data.profile\.yaml}'
```

### 填写 values

示例 values 随安装包一起下载。复制后用编辑器按下表修改，所有引用写成 `namespace/name`：

```bash
cp "$(dirname "$PACKAGE")/values-existing-stack.example.yaml" console-values.yaml
```

| values | 填什么 | Chart 在该 namespace 创建 |
|---|---|---|
| `backends[0].url` | `http://<swiss-name>.<swiss-namespace>.svc:<port>/api`，必须以 `/api` 结尾 | — |
| `playground.gateway.profile` | Swiss 的 `cluster.profile.configMap` | 只读 Role |
| `playground.gateway.service` | profile 的 `route.nginxService` | 只读 Role |
| `playground.gateway.secretRef` | profile 的 `route.auth.secretRef`；它只有 name 时，namespace 是 **Swiss 所在的 namespace**。profile 没有此字段时删除此行 | 只读 Role |
| `playground.gateway.configMap` | **不设置**：已设置 `profile` 时 Console 拒绝启动 | — |

只读 Role 名为 `console-console-gateway`，只授予 `configmaps`、`secrets` 的 `get`（`templates/gateway-rbac.yaml`）。Console 还要读取的对象及其权限来源：

| Console 读取 | 来源 | 权限来自 |
|---|---|---|
| site profile ConfigMap | `playground.gateway.profile` | 该 namespace 的只读 Role |
| 路由 ConfigMap | profile 的 `route.nginxConfigMap` | 与上表某个引用同 namespace 时，已有只读 Role；否则需手动授权（见下） |
| 网关密钥 Secret | `playground.gateway.secretRef` | 该 namespace 的只读 Role |

路由 ConfigMap 在其他 namespace 时，安装后手动创建同样的 Role：

```bash
kubectl -n <route-namespace> create role console-console-gateway --verb=get --resource=configmaps,secrets
kubectl -n <route-namespace> create rolebinding console-console-gateway \
  --role=console-console-gateway --serviceaccount=modelsphere:console-console
```

## 3. 安装

与快速上手第 2 步相同，加上 values：

```bash
helm upgrade --install console "$PACKAGE" \
  --namespace modelsphere --create-namespace \
  --values console-values.yaml \
  --wait --timeout 20m
```

## 4. 检查和登录

```bash
helm -n modelsphere status console
kubectl -n modelsphere get pods,svc
kubectl -n modelsphere port-forward svc/console-console 8080:8080
```

浏览器打开 `http://127.0.0.1:8080`（Service 默认是 NodePort，也可用 NOTES 打印的节点地址），用 `admin` / `P@88w0rd` 登录。

> **首次登录会要求修改密码**：按页面提示设置新密码后才能继续使用。

集群中已有同名 IAM User（例如 Rise Global 的）时，Chart 不会覆盖它，`helm status` 输出的 NOTES 会说明。

## 卸载

```bash
helm -n modelsphere uninstall console
```

以下对象不会随 release 删除，重新安装时会继续使用：

| 对象 | 原因 | 手动清理 |
|---|---|---|
| 演示模型 PVC `console-console-demo`（独立模式） | 带 `helm.sh/resource-policy: keep`，避免重装时重新下载权重 | `kubectl -n modelsphere delete pvc console-console-demo` |
| 路由 API 密钥 Secret `console-console-api-keys` | Console 运行时创建，不属于 release | `kubectl -n modelsphere delete secret console-console-api-keys` |
| IAM 数据：User、IAMRole、IAMRoleBinding、LoginRecord（集群级） | Console 运行时创建（Chart 种下的管理员 User 属于 release，会被删除） | 见下 |
| IAM CRD `*.iam.theriseunion.io` | Helm 不删除 `crds/` 中的资源 | 见下 |

IAM CRD 和数据与 Rise Global 共用同一套定义。集群中还有 Rise Global 或其他 Console 时**不要删除**；确认只有本 Console 使用后，删除 CRD 会连同全部用户、角色和登录记录一起删除：

```bash
kubectl delete crd users.iam.theriseunion.io iamroles.iam.theriseunion.io \
  iamrolebindings.iam.theriseunion.io loginrecords.iam.theriseunion.io
```

## 常用 values

完整说明见 `values.yaml` 的注释。

| values | 作用 |
|---|---|
| `gateway.models` | 独立模式下，在演示模型之外接入自己的 OpenAI 兼容服务 |
| `demo.enabled=false` | 已有真实模型后关闭演示模型 |
| `service.type` | 暴露方式，默认 `NodePort` |
| `admin.encryptedPassword` | 预先设定管理员密码的 bcrypt 哈希 |
| `metrics.serviceMonitor.enabled` | 使用 Prometheus Operator 采集指标 |
| `auth.jwtSecret` | 与 Rise Global 共享签名密钥；为空时首次安装自动生成 |
| `auth.disabled=true` | 关闭登录，所有请求以本地管理员身份执行；见下节 |

## 关闭登录（auth.disabled）

笔记本、演示环境，或者外层已有认证的单租户集群，可以不要登录页：

```sh
helm install console ./console --set auth.disabled=true
```

这时 console 不再签发或校验 token，每个请求都带一个合成的 `admin`
身份（`system:masters`），授权器的短路分支让它通过所有检查。前端不再显示登录
页，用户菜单里的"修改密码"和"退出登录"一并隐藏——两者都没有可操作的对象。

| 影响 | 说明 |
|---|---|
| 整条链路都没有鉴权 | swissd 在 console 后面本来就以 `server.auth.disabled` 运行、信任 console 的 RBAC。这里再关掉，栈里就没有任何一层做授权了 |
| 不要暴露在共享网络上 | 任何能访问到这个地址的人都是管理员 |
| 签名密钥照常生成 | Secret 仍然存在，`auth.jwtSecret` 仍可用于与 Rise Global 共享 |
| 管理员 User 照常创建 | 没人用它登录，但保留它意味着改回 `auth.disabled=false` 只是改一个值；把它从 manifest 里去掉会让 helm 删除它 |

启动时会打印一条 warning，`helm install` 的 NOTES 也会提示。

改回来：

```sh
helm upgrade console ./console --set auth.disabled=false
```

## 本地打包与发布

CI 对每个 push 执行：

```text
push -> lint -> 校验示例 values -> 渲染两种模式 -> 检查镜像可匿名拉取 -> 按完整 SHA 打包 -> sha256 -> artifact
```

在仓库根目录生成相同格式的文件（脚本拒绝 dirty worktree，保证文件名中的 SHA 与内容一致）：

```bash
hack/chart.sh --output ./dist
```

推送到 Helm 仓库需要 SWR 企业版 Chart 仓库；SWR 基础版不接受 Helm OCI manifest。凭据只通过环境变量传入，脚本经 stdin 交给 Helm：

```bash
helm plugin install https://github.com/chartmuseum/helm-push --version 0.11.1
export SWR_CHART_REPO_URL="https://<namespace>.swr.<region>.myhuaweicloud.com/chartrepo/<namespace>"
export SWR_CHART_USERNAME="<AccessKey>"
read -rs SWR_CHART_PASSWORD && export SWR_CHART_PASSWORD   # 输入 SecretKey，不进入 shell 历史
hack/chart.sh --output ./dist --push
```
