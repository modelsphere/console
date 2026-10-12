import { lazy, Suspense, type ReactNode } from "react";
import { Activity, Bot, Library, Server, SlidersHorizontal } from "lucide-react";
import type { ConsoleModule } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { SwissScope } from "@/modules/inferences/components/SwissScope";
import { InferencesOverview } from "@/modules/inferences/Dashboard";

const InferenceList = lazy(() => import("@/modules/inferences/InferenceList").then((m) => ({ default: m.InferenceList })));
const CatalogPage = lazy(() => import("@/modules/inferences/CatalogPage").then((m) => ({ default: m.CatalogPage })));
const ModelPage = lazy(() => import("@/modules/inferences/ModelPage").then((m) => ({ default: m.ModelPage })));
const NodesPage = lazy(() => import("@/modules/inferences/NodesPage").then((m) => ({ default: m.NodesPage })));
const RunsPage = lazy(() => import("@/modules/inferences/RunsPage").then((m) => ({ default: m.RunsPage })));
const SiteProfilePage = lazy(() => import("@/modules/inferences/SiteProfilePage").then((m) => ({ default: m.SiteProfilePage })));
const SetupPage = lazy(() => import("@/modules/inferences/SetupPage").then((m) => ({ default: m.SetupPage })));
const InferenceDetail = lazy(() => import("@/modules/inferences/InferenceDetail").then((m) => ({ default: m.InferenceDetail })));

function Loading() {
  const t = useT();
  return <div className="p-6 text-sm text-muted-foreground">{t("common:status.loading")}</div>;
}

const page = (node: ReactNode) => (
  <Suspense fallback={<Loading />}>
    <SwissScope>{node}</SwissScope>
  </Suspense>
);

// swissd in Rise Global's layout, beside the swiss module; it reuses swiss's
// API client and panels (docs/console-design.md, "The inferences module").
export const inferencesModule: ConsoleModule = {
  id: "inferences",
  title: "模型服务",
  basePath: "/inferences",
  frame: "flush",
  overview: InferencesOverview,
  pages: [
    { path: "", element: page(<InferenceList />), permission: "swiss.view", menu: { label: "推理服务", icon: Bot } },
    { path: ":release/details", element: page(<InferenceDetail />), permission: "swiss.view" },
    { path: "catalog", element: page(<CatalogPage />), permission: "swiss.view", menu: { label: "模型库", icon: Library }, topbar: { label: "模型广场" } },
    { path: "catalog/:name", element: page(<ModelPage />), permission: "swiss.view" },
    { path: "nodes", element: page(<NodesPage />), permission: "swiss.view", menu: { label: "节点", icon: Server } },
    { path: "runs", element: page(<RunsPage />), permission: "swiss.view", menu: { label: "操作记录", icon: Activity } },
    { path: "site-profile", element: page(<SiteProfilePage />), permission: "swiss.view", menu: { label: "站点配置", icon: SlidersHorizontal } },
    { path: "setup", element: page(<SetupPage />), permission: "swiss.view" },
  ],
};
