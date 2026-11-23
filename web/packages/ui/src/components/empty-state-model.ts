// 空状态判定（PATTERNS §6）：容器处于哪种处境、某处境在某档位下渲染哪些部件。

import type { ReactNode } from "react"

export type EmptySituation = "empty" | "noMatch" | "error" | "unavailable" | "forbidden"
export type EmptyStateSize = "block" | "compact" | "inline"

/** 不可用：原因必填（集群未装组件、资源未就绪…），可带一个去处理的入口 */
export interface EmptyUnavailable {
  description: string
  title?: string
  action?: ReactNode
}

/** 无权限：可给更具体的标题与说明（如「请联系管理员开通个人操作日志」） */
export interface EmptyForbidden {
  title?: string
  description?: string
  /** 去别处的入口（如「查看集群监控」）；无权限不是重试能好的事，不放重试 */
  action?: ReactNode
}

export interface ContainerState {
  loading?: boolean
  forbidden?: boolean | EmptyForbidden | null
  unavailable?: EmptyUnavailable | null
  error?: unknown
  /** 当前有生效的筛选 / 搜索词 */
  filtered?: boolean
  isEmpty?: boolean
}

/** 判定顺序固定：加载 → 无权限 → 不可用 → 失败 → 筛没了 → 没数据；都不是返回 null（显示内容） */
export function resolveContainerSituation(s: ContainerState): EmptySituation | "loading" | null {
  if (s.loading) return "loading"
  if (s.forbidden) return "forbidden"
  if (s.unavailable) return "unavailable"
  if (s.error) return "error"
  if (s.isEmpty) return s.filtered ? "noMatch" : "empty"
  return null
}

export const SITUATION_TITLE_KEY: Record<EmptySituation, string> = {
  empty: "shared.noData",
  noMatch: "resourceTable.noMatch.title",
  error: "shared.loadFailed",
  unavailable: "emptyState.unavailable.title",
  forbidden: "emptyState.forbidden.title",
}

/** 行内档（下拉浮层）沿用下拉自己的措辞 */
const INLINE_TITLE_KEY: Partial<Record<EmptySituation, string>> = {
  empty: "selectEmpty.title",
  noMatch: "selectCombobox.noMatch",
}

const SITUATION_DESCRIPTION_KEY: Partial<Record<EmptySituation, string>> = {
  noMatch: "resourceTable.noMatch.description",
  forbidden: "emptyState.forbidden.description",
}

export interface EmptyPartsInput {
  situation: EmptySituation
  size: EmptyStateSize
  hasTitle: boolean
  hasDescription: boolean
  hasError: boolean
  hasAction: boolean
  hasRetry: boolean
  hasClearFilters: boolean
}

export interface EmptyParts {
  showIcon: boolean
  /** 未传标题时取的词表 key；null = 不渲染标题 */
  titleKey: string | null
  /** 未传说明时取的词表 key */
  descriptionKey: string | null
  /** 失败处境用错误文本作说明 */
  errorAsDescription: boolean
  showAction: boolean
  showRetry: boolean
  showClearFilters: boolean
  tone: "default" | "destructive"
}

export function resolveEmptyParts(i: EmptyPartsInput): EmptyParts {
  const actionAllowed = i.situation === "empty" || i.situation === "unavailable" || i.situation === "forbidden"
  const showAction = i.hasAction && actionAllowed
  // 行内档「只有按钮」时不压默认标题：按钮文案已说明这里是空的
  const dropDefaultTitle = i.size === "inline" && i.situation === "empty" && showAction
  let titleKey: string | null = null
  if (!i.hasTitle && !dropDefaultTitle) {
    titleKey = i.size === "inline" ? (INLINE_TITLE_KEY[i.situation] ?? SITUATION_TITLE_KEY[i.situation]) : SITUATION_TITLE_KEY[i.situation]
  }
  const descriptionKey =
    i.hasDescription || i.size === "inline" ? null : (SITUATION_DESCRIPTION_KEY[i.situation] ?? null)
  return {
    showIcon: i.size === "block",
    titleKey,
    descriptionKey,
    errorAsDescription: i.situation === "error" && i.hasError && !i.hasDescription,
    showAction,
    showRetry: i.situation === "error" && i.hasRetry,
    showClearFilters: i.situation === "noMatch" && i.hasClearFilters && i.size !== "inline",
    tone: i.situation === "error" ? "destructive" : "default",
  }
}
