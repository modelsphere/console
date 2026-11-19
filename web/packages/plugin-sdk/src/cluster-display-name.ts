import { getBusiness } from './host'
import type { ReactNode } from 'react'

/** 仅供列表单元格显示；调用方继续用原集群名处理筛选、排序、请求和导出。 */
export function useClusterDisplayName(options?: Array<{ name: string; displayName?: string }>, loading = false): (name: string) => ReactNode {
  return getBusiness<{ useClusterDisplayName: (options?: Array<{ value: string; label: string }>, loading?: boolean) => (name: string) => ReactNode }>()
    .useClusterDisplayName(options?.map(option => ({ value: option.name, label: option.displayName || option.name })), loading)
}
