// Available built-ins. Startup YAML selects their order and folder placement.
import type { ConsoleModule } from "@/shell";
import { docsModule } from "@/modules/docs";
import { iamModule } from "@/modules/iam";
import { inferencesModule } from "@/modules/inferences";
import { playgroundModule } from "@/modules/playground";
import { routerModule } from "@/modules/router";

export const builtinModules: Record<string, ConsoleModule> = {
  inferences: inferencesModule,
  playground: playgroundModule,
  router: routerModule,
  iam: iamModule,
  docs: docsModule,
};
export const modules = Object.values(builtinModules);
