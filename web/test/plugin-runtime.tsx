import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadPlugins } from "../src/shell/plugins";
import "../src/index.css";

const result = await loadPlugins([]);
if (result.errors.length) throw new Error(result.errors.join("\n"));
const plugin = result.modules[0];
if (!plugin) throw new Error("Configure a plugin before running this fixture");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[plugin.basePath]}>
      <Routes>{plugin.pages.map((page) => <Route key={page.path} path={`${plugin.basePath}/${page.path}`} element={page.element} />)}</Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
