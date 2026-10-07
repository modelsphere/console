# Getting started

ModelSphere Console is the single entry point of the inference platform: deploy models, try them out and issue API keys here; programs then call models through the OpenAI-compatible API with those keys.

## The whole flow

```
pick a model -> deploy an inference service -> wait until ready -> try it in the Playground -> create an API key -> call /v1
```

| Step | Page | See |
|---|---|---|
| Pick and deploy a model | [Model Serving → Model Library](/inferences/catalog) | [Deploying models](/help/docs/deploy) |
| Watch the rollout | [Model Serving → Inference Services](/inferences) | [Deploying models](/help/docs/deploy) |
| Chat with a model | [Playground → Chat](/playground) | [Playground](/help/docs/playground) |
| Issue keys | [Router → API Keys](/router/api-keys) | [Calling the API](/help/docs/api) |
| Manage users and roles | [Access Control → Users](/iam/users) | [Access control](/help/docs/access-control) |

## Signing in

- Sign in with the username and password your administrator gave you. The administrator account created at install time is `admin`.
- **The first sign-in asks you to set a new password.** Keeping the initial one is allowed, with a warning, but choose one only you know.
- To change it later: avatar at the top right → **Change password**. At least 8 characters; the strength meter updates as you type.

## The interface

- The **sidebar** groups pages by feature and shows only the pages your account may open. If a menu is missing, your role does not grant it; ask an administrator.
- **Top right**:
  - User Guide: opens this guide from any page.
  - Language icon: switch between Chinese and English.
  - Palette icon: preferences, with three layouts (mixed nav, classic, minimal). Stored in this browser only.
  - Avatar: your identity, change password, sign out.
- The **Overview** page shows the current session (user, groups, role) and each module's summary cards.

## Menus

| Group | Menus | Purpose |
|---|---|---|
| Model Serving | Inference Services, Model Library, Nodes, Activity, Site Profile | Deploy and manage inference services |
| Playground | Chat | Talk to models in the browser |
| Router | API Keys | Keys that programs use to call `/v1` |
| Access Control | Users, Login History, Roles | Accounts and permissions |
| Help | User Guide | This guide |
