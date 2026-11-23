import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGlobalHost } from "./host";

describe("Global SDK state components", () => {
  it("renders the default forbidden state used by the unmodified Dashboard", () => {
    const { host } = createGlobalHost();
    const html = renderToStaticMarkup(createElement(host.ui.EmptyState, { situation: "forbidden" }));
    expect(html).toContain("无权访问");
    expect(html).toContain("请联系管理员开通相应权限");
    expect(html).not.toContain("<button");
  });

  it("shows an error message and retry without requiring a custom description", () => {
    const { host } = createGlobalHost();
    const html = renderToStaticMarkup(createElement(host.ui.EmptyState, {
      situation: "error", error: new Error("Dashboard module load timed out"), onRetry: () => {},
    }));
    expect(html).toContain("加载失败");
    expect(html).toContain("Dashboard module load timed out");
    expect(html).toContain("重试");
  });

  it.each(["forbidden", "unavailable", "error"] as const)("renders the Dashboard %s state through the public host", situation => {
    const { host } = createGlobalHost();
    const State = host.ui.EmptyState;
    const html = renderToStaticMarkup(createElement(State, {
      situation, title: "Dashboard unavailable", description: "Backend not ready", onRetry: () => {},
    }));
    expect(html).toContain("Dashboard unavailable");
    expect(html).toContain("Backend not ready");
    expect(html.includes("<button")).toBe(situation === "error");
  });
});
