// SDK 自身文案的中文词表（业务组件文案在 rise-global @theriseunion/business）。也是未注入宿主时（单测 / SSR）的回落来源，所以这份必须是全集。
//
// 结构按 rise-global `docs/superpowers/specs/2026-09-26-design-system-i18n-design.md` §4.1：
// key 为 `<组件名 camelCase>.<用途>`，多个组件共用的词放 `shared.*`；顶层不得用宿主 `common`
// 已有的 `actions` / `status` / `table` / `terms` / `misc`。
//
// 插值与复数用 ICU 语法（`{name}`、`{n, plural, …}`），与宿主一致。
// **中文值不得含 plural / select** —— 复数与选择只出现在英文值里。
// 不要放代码样例或含 JSX 花括号的文本：ICU 会把单花括号当参数，整条渲染成 key 原文。

export default {
  resourceApi: {
    error: {
      network: '网络连接失败，请检查网络设置。',
      unauthorized: '未授权，请重新登录。',
    },
  },
} as const
