import { lazy, Suspense, type ReactNode } from "react";
import { FlaskConical, Plus } from "lucide-react";
import type { ConsoleModule } from "@/shell";
import { apiFetch } from "@/shell/api";
import { i18n, useT } from "@/shell/i18n";
import { useCapabilities } from "@/shell/capabilities";
import { CanaryProvider } from "./lib/provider";
import { PluginBase } from "./lib/host";
import { registerCanaryLocales } from "./locales";

const CanaryList = lazy(() => import("./pages/CanaryList").then((m) => ({ default: m.CanaryList })));
const CanaryCreate = lazy(() => import("./pages/CanaryCreate").then((m) => ({ default: m.CanaryCreate })));
const ExperimentDetail = lazy(() => import("./pages/ExperimentDetail").then((m) => ({ default: m.ExperimentDetail })));
const LiveCanaryDetail = lazy(() => import("./pages/LiveCanaryDetail").then((m) => ({ default: m.LiveCanaryDetail })));
const Pricing = lazy(() => import("./pages/Pricing").then((m) => ({ default: m.Pricing })));

registerCanaryLocales(i18n);
const authFetch: typeof fetch = (input, init) => apiFetch(String(input), init);

function CanaryScope({ children }: { children: ReactNode }) {
  const { data } = useCapabilities();
  const t = useT("shell");
  return (
    <CanaryProvider fetch={authFetch} i18n={i18n} canWrite={data?.canary.canWrite ?? false}>
      <PluginBase basePath="/canary">
        <Suspense fallback={<div className="p-6">{t("capability.loading")}</div>}>{children}</Suspense>
      </PluginBase>
    </CanaryProvider>
  );
}

const page = (node: ReactNode) => <CanaryScope>{node}</CanaryScope>;

export const canaryModule: ConsoleModule = {
  id: "canary",
  title: "Canary",
  basePath: "/canary",
  capability: "canary",
  frame: "flush",
  pages: [
    { path: "", element: page(<CanaryList />), menu: { label: "实验", icon: FlaskConical } },
    { path: "new", element: page(<CanaryCreate />), permission: "canary.write", requiresWrite: true, menu: { label: "新建实验", icon: Plus } },
    { path: "pricing", element: page(<Pricing />), menu: { label: "价格", icon: FlaskConical } },
    { path: "experiments/:id", element: page(<ExperimentDetail />) },
    { path: ":ns/:name", element: page(<LiveCanaryDetail />) },
  ],
};
