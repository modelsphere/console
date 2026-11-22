---
title: 本地开发
slug: /development/local
---

本地 Console 使用开发集群中的身份资源与后端服务，前端由 Vite 热更新。

## 工具

| 工具 | 用途 |
| --- | --- |
| Go | 版本以仓库 `go.mod` 为准 |
| Node.js、pnpm | 前端与文档站；文档站要求 Node 22.12+ |
| kubectl、Helm | 开发集群、Chart 与插件安装 |
| Telepresence（可选） | 访问集群 DNS 和调试集群请求 |

## 运行服务

在仓库根目录准备配置，使用开发集群，不连接生产环境：

```sh
cp examples/console.yaml console.yaml
# 编辑 cluster.kubeconfig、cluster.context 和 backend 地址
go run ./cmd/console --config console.yaml --log-level debug
```

JWT Secret 和集群凭据不得提交到仓库。关闭认证仅用于个人隔离开发环境。

## 运行前端

```sh
pnpm --dir web install
pnpm --dir web dev
```

Vite 默认地址为 `http://localhost:5173`，代理 `/api` 和 `/oauth` 到本地后端。配置以 `web/vite.config.ts` 为准。

## 验证修改

```sh
pnpm --dir web test
pnpm --dir web typecheck
pnpm --dir docs-site build
```

| 现象 | 检查 |
| --- | --- |
| 服务没有 UI | Vite 是否运行，或是否生成了 `web/dist` |
| 后端域名无法解析 | 本机是否可达集群 DNS；必要时使用受控端口转发或 Telepresence |
| 插件没有出现 | 按[生命周期核验链](lifecycle.md)检查 CR、release、清单与浏览器错误 |
| 菜单出现但 API 被拒绝 | 检查后端 IAM；菜单可见不代表 API 已授权 |

完整仓库开发流程见 [Console 本地开发文档](https://github.com/modelsphere/console/blob/main/docs/development/local-development.md)。
