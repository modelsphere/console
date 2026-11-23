// Installed feature providers; shell/console-navigation.ts owns presentation order.
import type { ConsoleModule } from "@/shell";
import { docsModule } from "@/modules/docs";
import { iamModule } from "@/modules/iam";
import { inferencesModule } from "@/modules/inferences";
import { extensions } from "@/extensions/registry";
import { playgroundModule } from "@/modules/playground";
import { routerModule } from "@/modules/router";

export const modules: ConsoleModule[] = [inferencesModule, ...extensions.modules, playgroundModule, routerModule, iamModule, docsModule];
