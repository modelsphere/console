# Console 开发指南站点

沿用 Global 的 Docusaurus 文档方案，正文直接来自仓库 `docs/guide/`，不通过临时文件浏览服务暴露 Research 目录。

```sh
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site start --host 127.0.0.1 --port 3001 --no-open
```

- 开发地址：`http://127.0.0.1:3001/`。
- 前端插件：`http://127.0.0.1:3001/overview/frontend/frontend-plugin`。
- 构建检查：`pnpm --dir docs-site build`，失效的内部链接会阻止构建。
- 部署时通过 `DOCS_URL`、`DOCS_BASE_URL` 指定站点 URL 和路径。
- `3000` 是已有 Global 文档站，本站不替换它。

Mermaid 使用 11.x，并显式安装 `@mermaid-js/layout-elk` 0.1.x，保持 Docusaurus 3.10.1 的主题和可选布局依赖处于兼容范围；不要只升级其中一个包。

本机使用上述 `start --host 127.0.0.1`。Docusaurus 3.10.1 的 `serve` 命令虽然接受 `--host`，但其底层 `listen` 未传入绑定地址，不作为本站的本机入口。
