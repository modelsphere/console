# Deployment configuration browser fixture

The fixture renders the production deploy/upgrade components and hooks against in-memory API responses.

```sh
pnpm --dir web dev --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/test/deployment-configuration.html?scenario=upgrade` to start directly in the three-pane YAML editor. Close it to inspect the synchronized form, then use **编辑 YAML** in the top toolbar to reopen it. Add `&view=form` to start with the complete form. All scenarios use the existing form/edit API without an advertised configuration capability.

| Scenario | Coverage |
|---|---|
| `upgrade` | Stored user values, bidirectional controls/YAML, current revision comparison |
| `create` | Fresh deployment defaults and configuration preview |
| `autoscale` | User replica count and higher-priority effective value |
| `canary` | A running revision with experiment settings compared with the target plan returned by the existing service |
| `gpu` | Product aliases, multiple products, unverified product acceptance, retained affinity |
| `legacy` | Upgrade against the existing API with no capability field |

Console helpers in `window.deploymentFixture`:

- `advanceRevision()` simulates another deployment revision.
- `failPreview(true)` makes chart values unavailable; reset with `false` and refresh.
- `requests()` returns the recorded compose inputs.

The fixture blocks unexpected network requests and uses mock install/apply functions. Its compose stub follows the existing contract: upgrades merge form values and replace submitted edit YAML. It does not validate live cluster behavior.
