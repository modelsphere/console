# 安装 console + swissd（模型部署）

在一个已有 modelsphere 推理栈的集群上，用一个 chart 装好 console 和 swissd，跑通：

```
登录 console → 模型部署 → 站点配置(首次) → 模型目录 → 部署 → release Ready
            → autoconfig 写入路由 → Playground 对话
```

设计与取舍见 [console-design.md#swissd-in-the-chart](console-design.md#swissd-in-the-chart)。

## 1. 前置条件

| 项 | 要求 | 检查 |
|---|---|---|
| 权限 | cluster-admin（chart 会建 ClusterRole、CRD） | preflight |
| GPU | 有 `nvidia.com/gpu` 可分配的节点，型号满足目录里模型的要求 | preflight |
| CRD | LeaderWorkerSet、LLMScaler、LLMSLORequirement、ModelRoute（`*.modelsphere.dev` 或旧 group），建议 ServiceMonitor | preflight |
| 网关 | llm-openresty + autoconfig：一个带 `session_route_*.conf` 的 ConfigMap、它的 Service、放 key 的 Secret | preflight |
| 模型目录 | 集群内能访问的 https/http 地址，提供 `index.json` | `--catalog` |
| 模型 chart 仓库 | 站点配置里的 `chartRepo`，集群内能拉取（如 `https://harbor.4pd.io/chartrepo/hardcore-tech/`） | 部署时 |
| 权重 | GPU 节点上位于站点配置 `model.pathTemplate` 的目录 | 部署时 |
| 镜像 | `swr.cn-east-3.myhuaweicloud.com/risecloud/{console,swissd}` 私有，需要拉取凭据 | preflight |
| StorageClass | 默认的，或设置 `swiss.persistence.storageClass`（swissd 的 SQLite） | preflight |
| CNI | 能执行 NetworkPolicy（calico/cilium）。flannel 下 swissd 在集群内不受保护 | preflight |

```sh
hack/preflight-swiss.sh --model-ns <模型命名空间> --gateway-ns <网关命名空间> \
  --catalog <目录地址> --release-ns modelsphere
```

有 `FAIL` 先解决再装。

## 2. 镜像与凭据

镜像已推送：

| 组件 | 镜像 |
|---|---|
| console | `swr.cn-east-3.myhuaweicloud.com/risecloud/console:0.1.0-dev.49daa54` |
| swissd | `swr.cn-east-3.myhuaweicloud.com/risecloud/swissd:0.5.8`（chart 的 appVersion） |

```sh
kubectl create ns modelsphere
kubectl -n modelsphere create secret docker-registry swr-creds \
  --docker-server=swr.cn-east-3.myhuaweicloud.com \
  --docker-username=<SWR 长期登录用户名> --docker-password=<长期登录密钥>
```

`hcloud SWR CreateSecret` 生成的是临时凭据，会过期；测试环境请用 SWR 的长期登录指令。

## 3. 安装

复制 `examples/values-swiss.yaml`，填上所有 `<...>`：

| 值 | 填什么 |
|---|---|
| `swiss.config.catalog` | 模型目录地址（默认值；站点配置里的 `catalog` 优先） |
| `swiss.rbac.namespaces` | 模型部署到的命名空间（= 站点配置的 `namespace`） |
| `playground.gateway.namespaces` | 网关所在命名空间（路由 ConfigMap 和 key Secret） |

```sh
helm upgrade --install console ./helm/console -n modelsphere \
  -f my-values.yaml --set image.tag=0.1.0-dev.49daa54 --wait
```

console 代码有变动时用 `hack/image.sh` 重新构建推送，它会写出 `console-image.yaml`，换成 `-f console-image.yaml`。

`NOTES` 打印访问地址（默认 NodePort）。默认账号 `admin` / `P@88w0rd`，首次登录要求改密码。

## 4. 站点配置（首次进入 模型部署 时）

swissd 没有站点配置时会把页面带到设置页，保存后写入 `<ns>/console-swiss-profile`。和网关相关的字段必须这样填：

```yaml
name: <集群名>
namespace: <模型命名空间>          # 必须在 swiss.rbac.namespaces 里
chartRepo: <模型 chart 仓库>
registry:
  mirror: <引擎镜像的镜像仓库，可空>
model:
  pathTemplate: /mnt/disk0/models/{{org}}/{{name}}
route:
  nginxConfigMap: <网关ns>/<openresty 路由 ConfigMap>
  nginxService: <网关ns>/<openresty Service>
  nginxPort: 8080
  auth:
    secretRef: <网关ns>/<key Secret>  # 必须写成 namespace/name
    secretKey: keys                   # 必须显式写；openresty 的 "key:owner" 格式可以直接用
scaler:
  serverAddress: http://decision-gen.llm-scaler.svc:80
  sloAddress: http://slo-api.llm-scaler.svc:80
```

为什么 `secretRef`、`secretKey` 要写全：不写时 swissd 和 console 的默认值不一样（见 console-design.md 的 "Still missing" 表）。

保存后约 30 秒，Playground 就能列出网关上已有的模型。

### 集群访问不到 chart 仓库时

公开仓库是 `https://modelsphere.github.io/helm-charts`（chart 包在 GitHub Releases）。集群内访问不到时，在集群里放一个镜像：

```sh
# 在能上网的机器上：取目录里用到的 chart 版本（目前 sglang 0.7.0、0.7.1）
for v in 0.7.0 0.7.1; do curl -sSLO https://github.com/modelsphere/helm-charts/releases/download/sglang-$v/sglang-$v.tgz; done
helm repo index .          # 生成相对 URL 的 index.yaml
kubectl -n modelsphere create configmap chart-mirror --from-file=.
# 再起一个 nginx Deployment + Service，把这个 ConfigMap 挂到 /usr/share/nginx/html
```

站点配置里写 `chartRepo: http://chart-mirror.modelsphere.svc/`。在 daocloud-ce 上验证过：plan、diff、install、status、uninstall 都通过 console 跑通。

## 5. 部署并对话

1. 模型部署 → 模型目录 → 选模型 → Deploy → 预览（plan/diff）→ 安装。
2. 部署 页等 release Ready（大模型加载可能要几十分钟）。
3. Playground 选该模型对话。

## 6. 验证

| 步骤 | 期望 |
|---|---|
| `GET /api/deploy/session` | `initialized: true` |
| `GET /api/deploy/catalog` | 目录里的模型 |
| `GET /api/llm/v1/models` | 网关上所有路由的模型 |
| `POST /api/llm/v1/chat/completions` | 回答 + usage |

## 7. 排查

| 现象 | 原因 |
|---|---|
| console Pod `ImagePullBackOff`，401 | 没有 `swr-creds`，或凭据过期 |
| 模型部署 页全是 502 | swissd 没起来：`kubectl -n modelsphere logs deploy/console-swiss` |
| Playground 502 `site profile ... not found` | 还没完成第 4 步 |
| Playground 502 `forbidden` 读 Secret/ConfigMap | `playground.gateway.namespaces` 没包含网关命名空间 |
| 部署页看不到 release、或 apply 403 | 模型命名空间不在 `swiss.rbac.namespaces` |
| 状态页探活 401 | swissd 早于 0.5.8，或 `secretKey` 指的条目不是 key |
| diff 500 `progressDeadlineSeconds (2000) does not clear the startupProbe budget` | 目录里 qwen3.6-35b-a3b 1.0.0 的问题。改用 1.0.1（model-catalog 分支 `fix/qwen3.6-progress-deadline`，需要发布到目录） |
| diff 500 `no matches for kind "LeaderWorkerSet"` | 集群没装 LWS CRD；kimi-k2.5 这类多节点模型需要 |
| diff 500 `failed to fetch ... index.yaml` / 超时 | 集群访问不到 chart 仓库，见"集群访问不到 chart 仓库时" |

目录里每个模型在 daocloud-ce 上 plan + diff 的结果（2026-09-28）：

| 模型 | chart | 结果 |
|---|---|---|
| glm5.1, glm5.3, kimi-k3, mimo-v2.5, modelforge, modelforge-0.0.2, qwen-distilled-kimi | sglang 0.7.0/0.7.1 | 通过 |
| kimi-k2.5 | sglang 0.7.0 (LWS) | 集群缺 LWS CRD |
| qwen3.6-35b-a3b 1.0.0 | sglang 0.7.1 | 目录缺陷，见上 |

## 已知限制

- swissd 不读 `X-Remote-User`：操作记录没有操作人。
- 权限只到 `backends/swiss` + HTTP 方法：能预览（POST plan/diff）就能安装。
- swiss 关闭时 模型部署 菜单仍显示（接口 502）。
- 多站点切换器没有迁过来。
