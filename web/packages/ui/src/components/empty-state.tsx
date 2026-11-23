"use client"

import * as React from "react"
import { Inbox, Lock, Plug, SearchX, TriangleAlert } from "lucide-react"
import { cn } from "../utils"
import { useUiT } from "../i18n/index"
import { Button } from "./ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { resolveEmptyParts, type EmptySituation, type EmptyStateSize } from "./empty-state-model"

export type { EmptySituation, EmptyStateSize, EmptyUnavailable, EmptyForbidden } from "./empty-state-model"

export interface EmptyStateProps {
  situation?: EmptySituation
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  size?: EmptyStateSize
  error?: Error | string | null
  onRetry?: () => void
  onClearFilters?: () => void
  fill?: boolean
  className?: string
  /** @deprecated Loading belongs to the containing component. */
  loading?: boolean
}

const ICON: Record<EmptySituation, React.ComponentType<{ className?: string }>> = {
  empty: Inbox, noMatch: SearchX, error: TriangleAlert, unavailable: Plug, forbidden: Lock,
}

function useEmptyContent(props: EmptyStateProps) {
  const t = useUiT()
  const { situation = "empty", size = "block", title, description, error, action, onRetry, onClearFilters } = props
  const errorText = error ? (typeof error === "string" ? error : error.message) : undefined
  const hasDescription = description !== undefined && description !== null && description !== ""
  const parts = resolveEmptyParts({
    situation, size, hasTitle: title !== undefined, hasDescription, hasError: !!errorText,
    hasAction: !!action, hasRetry: !!onRetry, hasClearFilters: !!onClearFilters,
  })
  const heading = title !== undefined ? title : parts.titleKey ? t(parts.titleKey) : undefined
  const desc = parts.errorAsDescription ? (errorText !== heading ? errorText : undefined)
    : hasDescription ? description : parts.descriptionKey ? t(parts.descriptionKey) : undefined
  const small = size !== "block"
  const actionNode = parts.showRetry ? (
    <Button variant={small ? "outline" : "default"} size={small ? "sm" : "default"} onClick={onRetry}>
      {t("shared.retry")}
    </Button>
  ) : parts.showClearFilters ? (
    <Button variant="outline" size={small ? "sm" : "default"} onClick={onClearFilters}>
      {t("resourceTable.noMatch.clear")}
    </Button>
  ) : parts.showAction ? action : null
  return { parts, heading, desc, actionNode }
}

export function EmptyState(props: EmptyStateProps) {
  const { situation = "empty", size = "block", icon, fill = false, loading = false, className } = props
  const { parts, heading, desc, actionNode } = useEmptyContent(props)
  const dim = loading && "opacity-60 pointer-events-none"
  if (size === "block") {
    const Icon = icon ?? ICON[situation]
    return (
      <Empty className={cn(dim, className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon className={parts.tone === "destructive" ? "text-destructive" : undefined} />
          </EmptyMedia>
          {heading && <EmptyTitle>{heading}</EmptyTitle>}
          {desc && <EmptyDescription>{desc}</EmptyDescription>}
        </EmptyHeader>
        {actionNode && <EmptyContent>{actionNode}</EmptyContent>}
      </Empty>
    )
  }
  if (size === "compact") {
    return (
      <div className={cn("flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground", fill && "h-full", dim, className)}>
        {heading && <p className={cn(parts.tone === "destructive" && "text-destructive-text")}>{heading}</p>}
        {desc && <p className="mt-0.5 text-xs">{desc}</p>}
        {actionNode && <div className="mt-3 flex justify-center">{actionNode}</div>}
      </div>
    )
  }
  return (
    <div className={cn("px-2 text-center text-sm text-muted-foreground", !heading ? "py-2.5" : actionNode ? "py-4" : "py-6", dim, className)}>
      {heading && <p className={cn(parts.tone === "destructive" && "text-destructive-text")}>{heading}</p>}
      {desc && <p className="mt-1 text-xs text-muted-foreground/80">{desc}</p>}
      {actionNode && <div className={cn("flex justify-center", heading && "mt-3")}>{actionNode}</div>}
    </div>
  )
}
