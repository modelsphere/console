(() => {
  const { React, Router, shell, icons, register } = window.ConsolePluginHost;
  const h = React.createElement;
  shell.registerI18n("example", {
    "zh-CN": { group: { "示例工具": "示例工具" }, menu: { index: "工具工作台" }, title: "工具工作台", greeting: "你好，{name}", count: "操作次数：{count}", action: "记录一次操作", open: "打开工作台" },
    "en-US": { group: { "示例工具": "Example tools" }, menu: { index: "Workspace" }, title: "Workspace", greeting: "Hello, {name}", count: "Actions: {count}", action: "Record an action", open: "Open workspace" },
  });
  function Workspace() {
    const t = shell.useT("example");
    const { me } = shell.useAuth();
    const [count, setCount] = React.useState(0);
    return h("section", { className: "console-example" },
      h("h1", null, t("title")),
      h("p", null, t("greeting", { name: me?.displayName || me?.name || "admin" })),
      h("p", { "aria-live": "polite" }, t("count", { count })),
      h("button", { type: "button", onClick: () => setCount((value) => value + 1) }, t("action")),
    );
  }
  function Overview() {
    const t = shell.useT("example");
    const path = shell.useModulePath();
    return h("section", { className: "console-example console-example-overview" },
      h("h2", null, t("title")),
      h(Router.Link, { to: path("") }, t("open")),
    );
  }
  register({
    id: "example", title: "示例工具", basePath: "/example", overview: Overview,
    pages: [{ path: "", element: h(Workspace), menu: { label: "工具工作台", icon: icons.Boxes } }],
  });
})();
