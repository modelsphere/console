# Configured frontend plugins

The current design is tracked in [issue #113](https://github.com/modelsphere/console/issues/113), with the [SDK architecture](plans/2026-11-05-global-sdk-design.md) and [development/deployment guide](development/plugins.md).

Menus come from Console configuration. Pages register through `@modelsphere/plugin-sdk`. Development uses Vite source modules and Fast Refresh; deployment uses a static-resource image.
