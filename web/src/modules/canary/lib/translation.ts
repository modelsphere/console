import {
  createContext,
  useContext,
  useSyncExternalStore,
  type Context,
} from "react";
import i18next, { type i18n as I18n, type TFunction } from "i18next";
import ICU from "i18next-icu";
import { canaryLocales } from "../locales";
// Fallback belongs only to this module. Console injects its own i18n instance.
const fallback = i18next.createInstance();
void fallback
  .use(ICU)
  .init({
    lng: "en",
    fallbackLng: "en",
    ns: ["canary"],
    defaultNS: "canary",
    resources: {
      en: { canary: canaryLocales.en },
      zh: { canary: canaryLocales.zh },
    },
    initAsync: false,
    interpolation: { escapeValue: false },
  });
export const CanaryI18nContext: Context<I18n> = createContext(fallback);
export function useTranslation(namespace = "canary"): {
  t: TFunction;
  i18n: I18n;
} {
  const instance = useContext(CanaryI18nContext);
  const language = useSyncExternalStore(
    (cb) => {
      instance.on("languageChanged", cb);
      return () => {
        instance.off("languageChanged", cb);
      };
    },
    () => instance.language,
    () => instance.language,
  );
  return { t: instance.getFixedT(language, namespace), i18n: instance };
}
