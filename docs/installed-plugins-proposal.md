# Configured frontend plugins

The current design is tracked in [issue #113](https://github.com/modelsphere/console/issues/113), with the [SDK architecture](plans/2026-11-05-global-sdk-design.md) and [development/deployment guide](development/plugins.md).

Menus, components and internal routes come from the SDK registration in the installed release. Deployment uses the built bundle from the release's `frontend/` directory.
