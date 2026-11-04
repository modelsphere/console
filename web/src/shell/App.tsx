import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/shell/auth";
import { PermissionGuard, PermissionsProvider } from "@/shell/permissions";
import { Layout } from "@/shell/Layout";
import { ModuleProvider, joinPath, validateModules, type ConsoleModule } from "@/shell/module";
import { Login } from "@/shell/pages/Login";
import { Home } from "@/shell/pages/Home";
import { useT } from "@/shell/i18n";
import { ChangePassword } from "@/shell/pages/ChangePassword";

const queryClient = new QueryClient();

function RequireAuth({ modules }: { modules: ConsoleModule[] }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (me.requirePasswordReset && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  if (!me.requirePasswordReset && location.pathname === "/change-password") {
    return <Navigate to="/" replace />;
  }
  if (location.pathname === "/change-password") return <Outlet />;
  return (
    <Layout modules={modules}>
      <Outlet />
    </Layout>
  );
}

export function App({ modules, pluginErrors = [] }: { modules: ConsoleModule[]; pluginErrors?: string[] }) {
  const t = useT("shell");
  validateModules(modules);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PermissionsProvider>
          <BrowserRouter>
            {pluginErrors.length > 0 && (
              <details role="alert" className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-red-300 bg-white p-4 text-sm text-red-700 shadow-lg">
                <summary className="cursor-pointer">{t("plugins.failed")}</summary>
                <ul className="mt-2 list-inside list-disc break-words">
                  {pluginErrors.map((error, index) => <li key={index}>{error}</li>)}
                </ul>
              </details>
            )}
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth modules={modules} />}>
                <Route path="/change-password" element={<ChangePassword />} />
                <Route path="/" element={<Home modules={modules} />} />
                {modules.flatMap((m) =>
                  m.pages.map((p) => (
                    <Route
                      key={`${m.id}:${p.path}`}
                      path={joinPath(m.basePath, p.path)}
                      element={
                        <ModuleProvider module={m}>
                          <div className={m.frame === "flush" ? "h-full" : "p-6"}>
                            {p.permission ? <PermissionGuard permission={p.permission}>{p.element}</PermissionGuard> : p.element}
                          </div>
                        </ModuleProvider>
                      }
                    />
                  )),
                )}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </PermissionsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
