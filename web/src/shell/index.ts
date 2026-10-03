// Everything a module may import from the shell. Modules import "@/shell" only,
// never a file under it, so the shell can move things around freely.
export type { ConsoleModule, ModulePage } from "@/shell/module";
export { useModulePath, ModuleProvider } from "@/shell/module";
export { apiFetch, request, ApiError, type Me } from "@/shell/api";
export { useAuth } from "@/shell/auth";
export { usePermissions, PermissionGuard } from "@/shell/permissions";
export { StatCard } from "@/shell/StatCard";
export { CopyButton, copyText } from "@/shell/CopyButton";
export {
  registerI18n,
  useT,
  getT,
  tNodes,
  useLocale,
  formatDateTime,
  formatNumber,
  LOCALES,
  type Locale,
  type TFn,
} from "@/shell/i18n";
