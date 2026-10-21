# Console 已有 Helm 部署纳管设计

## 背景

Console #65 要求将控制台之外安装的模型纳入 Model Serving，而不卸载或重新部署。最新 Swiss 只枚举已有计划记录的 release，没有接管接口。本次仅修改 Console，复用 Swiss 已有计划生成与后续升级接口；不修改其他项目。

## 目标

- 输入已有 Helm release，关联目录中的模型与变体，预览后使其出现在现有服务列表。
- 纳管只创建管理记录，不执行 Helm install、upgrade、rollback 或卸载。
- 保留 Helm 已提供的用户 values，明确区分“选择的后续管理基线”和不可追溯的原始目录来源。
- 拒绝覆盖已有记录，拒绝预览后已变化的 release；默认安装不增加部署写权限。

### 非目标

- 跨集群导入、导入非 Helm 工作负载、修改 Swiss API、改变推理工作负载。
- 推断原始模型来源，保证第一次升级与原始清单完全相同，恢复纳管前的 Swiss 历史。

## 架构

### 概要设计

```text
管理员显式启用并配置命名空间
  -> Console 导入表单
  -> Console 后端读取 Helm Secret
  -> Swiss 既有 POST /api/plans 生成管理基线
  -> 用户预览确认
  -> Console 重新验证 Secret 与计划
  -> 仅创建 Swiss plan.swiss/v1 格式 ConfigMap
  -> Swiss 既有部署列表、升级和回滚流程
```

### 架构设计

拟议接口只由 Console 提供：

| 接口 | 输入或输出 |
|---|---|
| `GET /api/deployment-imports` | 是否启用、允许的命名空间；要求配置 backend 的 get 权限 |
| `POST /api/deployment-imports/preview` | `namespace, release, catalog, model, variant, version`；返回 `plan, revision, chart, secretUID, resourceVersion, warnings` |
| `POST /api/deployment-imports` | 同上，加 `expectedRevision, expectedSecretUID, expectedResourceVersion, expectedPlanHash`；重新读取和生成后进行对比，然后只创建 ConfigMap |

配置：`deploymentImports.enabled` 默认 false；`backend` 默认 swiss，必须对应模型服务现有的 `/api/deploy` 静态后端；`namespaces` 启用时必须为非空显式列表；`planConfigMapPrefix` 默认 `swiss-plan-`，必须与目标 Swiss 一致。管理员需确保 backend 指向 Console 所连接的同一集群，命名空间同样在 Swiss 读取范围内。

- 只支持 Helm Secret storage，针对命名空间/release 标签读取，限制 Secret 数量、压缩与解压大小；仅接管状态 deployed 的最新有效修订。
- 选择目录模型是操作员声明的管理关联，必须与现有 chart 名称和精确版本匹配；不伪造该 release 原本由目录部署的事实。
- 将 Helm 存储中的 `config` 作为现有用户覆盖值交给既有计划接口。计划可能包含当前目录与站点默认值，预览必须明确告知：第一次升级仍需检查差异。
- 只接受 `plan.swiss/v1` 计划。保存格式为 `plan.yaml`（无 layers/helmfile）、各层 YAML、可用时的 `helmfile.yaml`、`status.yaml`；格式以兼容性测试固定。ConfigMap 标签由 Swiss 枚举，附 Console 纳管者、时间、Helm UID 和 revision 注解。
- 只创建管理记录前，检查同名 LLMService 不存在；已由 LLMService 管理的 release 返回 409，无法确认是否存在时拒绝纳管，避免两套管理记录。
- 使用 Kubernetes Create 而非 Update/Apply；已有同名计划一律冲突，包括非 Swiss ConfigMap，避免误覆盖。
- 预览与确认间的 revision、UID、resourceVersion 或计划哈希变化返回 409，要求重新预览。无法跨 Helm Secret 与 ConfigMap 提供事务；外部 Helm 管理者应在接管期间停止修改，后续升级仍由既有 diff/revision 检查保护。
- 认证、密码重置保护沿用 Console；预览和确认要求 backend 的 get/create 权限，以及 `deploymentimports` 的 create 权限，resourceName 为 namespace/release。UI 使用 `deployments.import`；UI 可见性不是授权。
- chart 在显式允许的命名空间内创建 Role/RoleBinding，授予 secrets get/list、configmaps get/create、llmservices get；不授予 Secret 写入或现有 ConfigMap 更新。`rbac.create=false` 的安装自行配置相同权限。
- 有限超时、有限请求/响应体，禁止 upstream 重定向。不记录 values/令牌，不把上游错误正文直接返回；响应使用 no-store。

### 组件模块

| 组件 | 职责 | 状态归属 |
|---|---|---|
| Console 导入表单 | 输入 release、选择模型、预览确认、展示错误 | 本地表单 |
| Console 导入 API | 授权、读取 Helm、生成基线、验证并创建记录 | 无持久草稿 |
| Helm Secret | 现有 revision、chart、用户 values | 原有 Helm release |
| Swiss 既有计划 API | 解析目录与站点，生成可升级计划 | Swiss 草稿存储 |
| Swiss 计划 ConfigMap | 纳管后供现有列表、升级、归档读取 | 目标 namespace |

### 数据流程

1. Console 后端读取限定命名空间的 Helm Secret，提取 release 身份、chart、修订和用户 values。
2. Console 使用已配置 backend 与既有认证转发规则请求 Swiss 生成管理基线。
3. 浏览器收到预览与并发标识；用户确认后，Console 重新读取与生成，验证完全一致。
4. Console 创建计划 ConfigMap；浏览器刷新已有部署列表，后续操作仍通过 Swiss。

## 场景

### 接入场景

前置条件：同一集群的 Swiss、已有模型目录、允许纳管的命名空间存在。管理员设置：

```yaml
deploymentImports:
  enabled: true
  backend: swiss
  namespaces: [models]
  planConfigMapPrefix: swiss-plan-
```

拟议校验命令（需安装相应 chart 配置和权限）：

```sh
curl -H "Authorization: Bearer $CONSOLE_TOKEN" "$CONSOLE_URL/api/deployment-imports"
```

预期返回 enabled=true 与 models。关闭时界面不显示导入入口，POST 不进行任何 Kubernetes 读取或写入。

### 接管手工部署的模型

在“推理服务 → 导入已有部署”输入命名空间和 release，选择与其 chart 匹配的模型及变体，点击预览，再确认纳管。预览展示修订、chart、目录关联与计划，并说明只新增管理记录。确认后服务出现在既有列表，Helm 修订与工作负载不变。数据走向为 Helm Secret → Console → Swiss 计划接口 → 用户确认 → 计划 ConfigMap → 既有列表。

### 预览后发生变化或记录已存在

确认返回 409 时不覆盖记录，不执行部署，界面清除旧预览并要求重新读取。授权失败、目录不可达、计划版本不兼容、Kubernetes 创建失败时展示对应错误，保持可重试。存在原始 Helm release 但没有新增计划记录不算纳管完成。

## 验证

实施阶段需覆盖：默认关闭、认证/授权、命名空间限制、损坏或过大的 Helm 数据、状态/身份/chart 检查、现有 values 传递、预览后并发变化、create-only 冲突、可读计划格式、前端重试及完整构建。此文档是接口实施前的设计记录；集群验收与兼容性验证结果在 PR 中分别列出。
