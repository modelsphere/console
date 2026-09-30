import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./Layout";
import { Deployments } from "@swiss/routes/Deployments";
import { DeploymentDetail } from "@swiss/routes/DeploymentDetail";
import { Catalog } from "@swiss/routes/Catalog";
import { Model } from "@swiss/routes/Model";
import { Deploy } from "@swiss/routes/Deploy";
import { Upgrade } from "@swiss/routes/Upgrade";
import { Runs } from "@swiss/routes/Runs";
import { Nodes } from "@swiss/routes/Nodes";
import { SiteProfile } from "@swiss/routes/SiteProfile";
import { Login } from "./Login";
import { Setup } from "@swiss/routes/Setup";
import { PreviewDeploySettings } from "./PreviewDeploySettings";
import { PreviewSLO } from "./PreviewSLO";
import { Gate } from "@swiss/components/Session";
import { ToastProvider } from "@swiss/components/ui/toast";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server is the source of truth; nothing here is cached durably or
      // written optimistically. Cluster state is what it is.
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Outside the gate: the login is what the gate sends you to, and
                the setup page is what it sends you to when there is no profile
                yet -- neither can be behind the thing that redirects to it. */}
            <Route path="login" element={<Login />} />
            {import.meta.env.DEV && (
              <Route path="preview/deploy-settings" element={<PreviewDeploySettings />} />
            )}
            {import.meta.env.DEV && <Route path="preview/slo" element={<PreviewSLO />} />}
            <Route
              path="setup"
              element={
                <Gate>
                  <Setup />
                </Gate>
              }
            />
            <Route
              element={
                <Gate>
                  <Layout />
                </Gate>
              }
            >
              <Route index element={<Deployments />} />
              <Route path="deployments/:namespace/:release" element={<DeploymentDetail />} />
              <Route path="nodes" element={<Nodes />} />
              <Route path="site-profile" element={<SiteProfile />} />
              <Route path="runs" element={<Runs />} />
              <Route path="catalog" element={<Catalog />} />
              <Route path="catalog/:name" element={<Model />} />
              <Route path="deploy/:name" element={<Deploy />} />
              <Route path="upgrade/:namespace/:release" element={<Upgrade />} />
              <Route path="*" element={<div className="text-sm text-muted-foreground">Not found.</div>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
