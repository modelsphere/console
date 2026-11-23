# @modelsphere/ui

The ModelSphere UI kit: shadcn components on [Base UI](https://base-ui.com), a resource table, page banner, confirm dialog and select, the design tokens as a Tailwind preset, and the components' own strings in zh-CN and en-US.

It is a fork of the parts of Rise Global's design system (`rise-global/design`, commit `684df9fc`) that the ModelSphere console uses, published with approval. From here on it is its own library: changes are not synced either way.

A second batch came from `rise-global/design` commit `f9c21d1b`, also with approval, for the inferences pages:

| Components | Local changes |
|---|---|
| `ui/sheet`, `ui/combobox`, `ui/input-group`, `FormSection`, `FloatingField` and its `Field*`, `NumberField`, `FieldRepeater`, `FieldHint` | `FieldHierarchy` removed (no hierarchy select here); `FormSection`'s chevron is lucide's, not the icon registry's |
| `DetailHeader`, `PanelTabs`, `SectionCard`, `PropertyList`, `StatusIndicator`, `LoadingBlock` | none |
| `FilterSelect`, `FilterDivider` | none |
| `CodeBlock`, `CodeToolbar`, `CodeViewSheet` | `CodeViewSheet` shows a `CodeBlock`: the Monaco editor loads from the internet and is not forked |
| `useDirty`, `useAnchorNav`, `useScrollShadow` | none |

`EmptyState` and its state model come from `rise-global/design` commit `2be16f2c7bfa43e8dc2e5a90f936008d963888e4` for the Global plugin host contract. The rendering function is split for readability; state selection and action behavior are unchanged. Its model tests use this repository's Vitest runner.

| | |
|---|---|
| Delivered as | TypeScript source, not built. The consumer's bundler compiles it and the consumer's Tailwind generates its CSS |
| Lives in | `console/web/packages/ui` until a second ModelSphere UI needs it; then it moves to its own repository as is (it imports nothing from the console) |
| Peer | React 19, Tailwind CSS 4 |

## Contents

| Layer | What |
|---|---|
| `src/components/ui/` | shadcn (base-nova) components; local patches are listed at the top of each file |
| `src/components/` | composites: `ResourceTable`, `PageBanner`, `ConfirmDialog`, `DataSelect`, `RefreshButton`, `CopyButton`, `Spinner`, `TypeToConfirm`; forms (`FloatingField`, `FormSection`, `FieldRepeater`), detail pages (`DetailHeader`, `PanelTabs`, `SectionCard`, `PropertyList`, `StatusIndicator`), filters, code views |
| `src/locales/` | component strings, `ui.zh-CN.ts` (source) and `ui.en-US.ts` (typed `typeof zhCN`, so a missing or extra key fails `tsc`) |
| `src/i18n/` | the string store; `i18n-host.ts` is the host's entry |
| `tokens/` | colours (OKLCH), radius, shadows, fonts, motion; `tailwind-preset.cjs` |
| `styles/base.css` | Base UI's `data-*` variants, focus and cursor rules |

Comments are mostly Chinese and cite the original tracker (`freeland#N`, `LF <date>`): they record why a component is the way it is.

## Use

```css
/* the app's CSS entry */
@import "tailwindcss";
@import "@modelsphere/ui/base.css";
@config "../tailwind.config.ts";
```

```ts
// tailwind.config.ts
import preset from "@modelsphere/ui/tailwind-preset";
export default {
  presets: [preset],
  content: ["./src/**/*.{ts,tsx}", "./node_modules/@modelsphere/ui/src/**/*.{ts,tsx}"],
};
```

```tsx
import { Button, PageBanner, ResourceTable } from "@modelsphere/ui";
```

## Languages

Components render their built-in text (pagination, empty states, confirm buttons, placeholders) through a store the host plugs its i18n into. Without it they render Chinese.

```ts
import { configureUiI18n, uiLocales } from "@modelsphere/ui/i18n-host";

i18n.addResourceBundle("zh-CN", "ui", uiLocales["zh-CN"]);
i18n.addResourceBundle("en-US", "ui", uiLocales["en-US"]);

configureUiI18n({
  t: (locale, key, vars) => i18n.getFixedT(locale, "ui")(key, vars), // ICU messages
  subscribe: (cb) => { i18n.on("languageChanged", cb); return () => i18n.off("languageChanged", cb); },
  getLocale: () => i18n.language,
});
```

- The locale is passed in by the component, not read from the host: server rendering and the first hydrated frame are always zh-CN.
- A text prop the caller passes wins; an explicit `""` is kept, not replaced by the default.
- The package does not depend on i18next; any ICU renderer works.

Adding or changing a component string:

1. add the key to `ui.zh-CN.ts`, then `ui.en-US.ts`;
2. in a component, `const t = useUiT()` (one function per locale, safe in hook deps); outside React, `uiT()` at call time, never at module top level; keys in module-level tables go through `uiKey()`;
3. `src/i18n/usage.test.ts` checks keys exist, variables are passed, and nothing is looked up at import time.

## Tests

From the console's `web/`: `npx vitest run packages/ui` and `npx tsc -p packages/ui`.
