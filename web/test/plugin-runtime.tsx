import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { modules as builtins } from "../src/modules";
import { Sidebar } from "../src/shell/Sidebar";
import { navGroups } from "../src/shell/module";
import { loadPlugins } from "../src/shell/plugins";
import "../src/index.css";

const result = await loadPlugins(builtins);
if (result.errors.length) throw new Error(result.errors.join("\n"));
const plugin = result.modules.find((module) => !builtins.some((builtin) => builtin.id === module.id));
if (!plugin) throw new Error("Configure a plugin before running this fixture");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function NavigationFixture() {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="flex gap-4">
    <aside className={collapsed ? "w-16 shrink-0" : "w-64 shrink-0"}>
      <button onClick={() => setCollapsed((value) => !value)}>Toggle sidebar</button>
      <Sidebar groups={navGroups(result.modules, () => true)} collapsed={collapsed} />
    </aside>
    <main className="min-w-0 flex-1">
      <Routes>{plugin!.pages.map((page) => <Route key={page.path} path={`${plugin!.basePath}/${page.path}`} element={page.element} />)}</Routes>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[plugin.basePath]}><NavigationFixture /></MemoryRouter>
  </QueryClientProvider>,
);
