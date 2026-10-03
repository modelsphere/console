// The installed modules, in sidebar order. Add or remove a line to plug one in or out.
import { registerI18n, type ConsoleModule } from "@/shell";
import { iamModule } from "@/modules/iam";
import { inferencesModule } from "@/modules/inferences";
import { playgroundModule } from "@/modules/playground";
import { routerModule } from "@/modules/router";
import { swissModule } from "@/modules/swiss";
import swissNavEn from "@/modules/swiss-nav.en-US.json";

// modules/swiss mirrors swiss/web and is not edited here, so its sidebar's
// English lives beside it; its pages stay Chinese.
registerI18n("swiss", { "en-US": swissNavEn });

export const modules: ConsoleModule[] = [swissModule, inferencesModule, playgroundModule, routerModule, iamModule];
