import type { HostNavigation } from "./navigation-types";

const reference = (provider: string, ...entries: string[]) => entries.map(entry => ({ provider: `console/${provider}`, entry }));

// Group and reference array order is presentation order, independent of provider registration.
export const consoleNavigation: HostNavigation = {
  groups: [
    { name: "inferences", ns: "inferences", title: "模型服务", menus: reference("inferences", "index", "catalog", "nodes", "runs", "siteProfile") },
    { name: "playground", ns: "playground", title: "Playground", menus: reference("playground", "index") },
    { name: "router", ns: "router", title: "路由", menus: reference("router", "apiKeys") },
    { name: "iam", ns: "iam", title: "访问控制", menus: reference("iam", "users", "loginHistory", "roles") },
    { name: "docs", ns: "docs", title: "帮助", menus: reference("docs", "docs") },
  ],
};
