import { lazy, Suspense, type ReactNode } from "react";
import { Bot } from "lucide-react";
import type { ConsoleModule } from "@/shell";
import { useT } from "@/modules/inferences/i18n";
import { SwissScope } from "@/modules/inferences/components/SwissScope";

const InferenceList = lazy(() => import("@/modules/inferences/InferenceList").then((m) => ({ default: m.InferenceList })));
const InferenceDetail = lazy(() => import("@/modules/inferences/InferenceDetail").then((m) => ({ default: m.InferenceDetail })));

function Loading() {
  const t = useT();
  return <div className="p-6 text-sm text-muted-foreground">{t("common:status.loading")}</div>;
}

// swiss's gate wraps every page: it owns the swissd session and sends an
// uninitialised site to swiss's setup. Read at render, so the reference to the
// module below is not read while it is still being declared.
const page = (node: ReactNode) => (
  <Suspense fallback={<Loading />}>
    <SwissScope self={() => inferencesModule}>{node}</SwissScope>
  </Suspense>
);

// The releases swiss deployed, as Rise Global's lists and detail pages show
// them. A second view on swissd beside the swiss module, not a replacement: it
// reuses swiss's API client and panels (see docs/console-design.md, "The
// inferences module"), and the write paths are still swiss's wizards.
export const inferencesModule: ConsoleModule = {
  id: "inferences",
  title: "模型服务",
  basePath: "/inferences",
  frame: "flush",
  pages: [
    { path: "", element: page(<InferenceList />), permission: "swiss.view", menu: { label: "推理服务", icon: Bot } },
    { path: ":release/details", element: page(<InferenceDetail />), permission: "swiss.view" },
  ],
};
