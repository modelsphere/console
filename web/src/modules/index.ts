// The installed modules, in sidebar order. Add or remove a line to plug one in or out.
import type { ConsoleModule } from "@/shell";
import { docsModule } from "@/modules/docs";
import { iamModule } from "@/modules/iam";
import { inferencesModule } from "@/modules/inferences";
import { canaryModule } from "@/modules/canary";
import { playgroundModule } from "@/modules/playground";
import { routerModule } from "@/modules/router";

export const modules: ConsoleModule[] = [inferencesModule, canaryModule, playgroundModule, routerModule, iamModule, docsModule];
