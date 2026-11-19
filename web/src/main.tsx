import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/shell/App";
import { modules } from "@/modules";

import { loadPlugins } from "@/shell/plugins";

void loadPlugins(modules).then(({ modules: installed, errors }) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App modules={installed} pluginErrors={errors} />
    </StrictMode>,
  );
});
