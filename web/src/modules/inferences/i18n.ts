import { registerI18n, useT as useShellT } from "@/shell";
import zh from "@/modules/inferences/locales/zh-CN.json";
import en from "@/modules/inferences/locales/en-US.json";

registerI18n("inferences", { "zh-CN": zh, "en-US": en });

export const useT = () => useShellT("inferences");
