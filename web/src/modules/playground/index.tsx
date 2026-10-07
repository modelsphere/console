import { lazy, Suspense, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import type { ConsoleModule } from "@/shell";
import { useT } from "@/modules/playground/i18n";

// Loaded on first visit: Markdown and syntax highlighting are most of the
// module's weight, and no other page needs them.
const Chat = lazy(() => import("@/modules/playground/Chat").then((m) => ({ default: m.Chat })));

function Loading() {
  const t = useT();
  return <div className="p-6 text-sm text-muted-foreground">{t("common:status.loading")}</div>;
}

const page = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

// The gateway key stays server-side, so the pages need no credential of their
// own -- only playground.use and access to the llm backend.
export const playgroundModule: ConsoleModule = {
  id: "playground",
  title: "Playground",
  basePath: "/playground",
  frame: "flush",
  pages: [
    { path: "", element: page(<Chat />), permission: "playground.use", menu: { label: "对话", icon: MessageSquare } },
  ],
};
