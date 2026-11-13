// @modelsphere/plugin-sdk — Main entry point

// Re-export all types
export type {
  ScopeType,
  Scope,
  ViewMode,
  PluginMenu,
  PluginContext,
  PluginAPI,
  RequestOpts,
  PluginEventMap,
  PluginEvents,
  PluginNav,
  SlotRegistration,
  PluginDefinition,
  PluginInstance,
  RiseHostSDK,
  ApiClient,
  ApiResponse,
  ScopeContextValue,
  UiSurface,
  BusinessSurface,
  PermissionsAPI,
  AuthUser,
  AuthAPI,
  ScopeFilterKind,
  ScopeFilterOption,
  UseScopeFilterOptions,
  UseScopeFilterResult,
} from './types'

// Re-export runtime API
export { createPlugin } from './core'

// Re-export typed host accessors
export { getHostSDK, getApi, navigate, getUi, getBusiness, usePermissions, getScopeContext, getAuth, generateUUID, getPluginComponents } from './host'

// Re-export page-level scope filter hook
export { useScopeFilter } from './scope-filter'
export { useClusterDisplayName } from './cluster-display-name'

export {
  RESOURCES_FACADE_PREFIX,
  RiseResourceError,
  RiseResourcePathError,
  buildResourcePath,
  clusterViewScopeOrThrow,
  resolveClusterViewScope,
  scopedApi,
} from './cluster-resource-api'
export type {
  ClusterViewScope,
  ResourceRequestOpts,
  ResourceRequestScope,
  ResourceResponse,
} from './cluster-resource-api'

// 「从镜像仓库进入实例创建」的 URL 契约（跨插件只走 URL）
export {
  CREATE_INSTANCE_ROUTES,
  CREATE_INSTANCE_PARAM,
  CREATE_INSTANCE_IMAGE_REF_PARAM,
  CREATE_INSTANCE_IMAGE_TAG_PARAM,
  CREATE_INSTANCE_IMAGE_SOURCE_PARAM,
  CREATE_INSTANCE_NAMESPACE_PARAM,
  CREATE_INSTANCE_CLUSTER_PARAM,
  splitImageRef,
  isValidCreateInstancePreset,
  buildCreateInstanceUrl,
  parseCreateInstancePreset,
  clearCreateInstanceParams,
} from './create-instance'
export type {
  CreateInstanceTarget,
  CreateInstanceImageSource,
  CreateInstancePreset,
} from './create-instance'


export type { RiseHostSDK as PluginHostSDK } from "./types";
