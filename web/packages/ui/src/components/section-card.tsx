"use client"

// SectionCard —— 内容分区卡。
//
// ══════════════════════════════════════════════════════════════════════════════
// 详情页、概览页、设置页里那种「标题 + 一段内容（+ 脚注）」的白卡。
// 内容完全自定义：表格、图表、属性列表、纯文本都行 —— 组件只管**外壳与状态**。
//
// ── 一条贯穿的原则：配了就显示，不配就不显示 ──────────────────────────────
// 每个可选块（图标 / 摘要 / 右侧操作 / 脚注 / 折叠）都是**给了才出现**，
// 而且连同它自己的分隔线一起出现或消失 —— 留一条没有内容的分隔线比没有更难看。
// 这样同一个组件既能是「一句话的极简卡」，也能是「带操作和脚注的完整分区」。
//
// ── 与 CollapsibleSection 的关系 ──────────────────────────────────────────
// 那个组件是本组件的一个子集（永远可折叠、无摘要、无脚注）。为避免两套实现，
// 它已改为本组件的薄壳（见 collapsible-section.tsx）。是否保留那个名字归 #61 定。
//
// ── 两个刻意不做的 ────────────────────────────────────────────────────────
// 1. **不支持卡片嵌套**。边框套边框是视觉噪音 —— 分区用分隔线，不用第二层卡。
// 2. **标题不吸顶**。长内容时看着炫，代价是卡片变成第二个滚动容器，
//    页面出现两条滚动轴，滚起来找不着北。

import * as React from "react"
import { ChevronDown, RotateCw, TriangleAlert } from "lucide-react"
import { cn } from "../utils"
import { useUiT } from "../i18n/index"
import { Button } from "./ui/button"
import { FieldHint } from "./field-hint"
import { Skeleton } from "./ui/skeleton"

export interface SectionCardProps {
  /** 标题左侧的图标 */
  icon?: React.ReactNode
  title: React.ReactNode
  /**
   * 标题右侧那句小字。
   *
   * 这是本组件最值钱的一处：用户**不展开、不细看**，只扫标题行就能知道这张卡
   * 装的是什么、有多少（「10 项 · 本服务创建 4 · 引用 5」）。扫视成本降一个量级。
   */
  summary?: React.ReactNode
  /**
   * 标题右边那个 `?`。**这张卡的说明放这儿，不放卡底**。
   *
   * 卡底脚注有两个毛病：一是说明和内容之间隔着整块正文，读到那儿早忘了在说什么；
   * 二是它常驻占一行，而这种话是**读一次**的 —— 老用户每次进来都要跳过它。
   * 收进 `?` 之后标题行只多一个 16px 图标，要看的人点一下就有。
   *
   * 一两句话说清「这是什么、有什么前提」；长了就该进文档。`footer` 只留给
   * **必须常驻**的内容（开发明确要求时），不是默认去处。
   */
  hint?: React.ReactNode
  /** 标题行最右侧的插槽：按钮、下拉筛选、计数徽标…… 折叠按钮会排在它右边 */
  actions?: React.ReactNode

  /** 可折叠。不给就是不可折叠，连折叠按钮都不出现 */
  collapsible?: boolean
  /** 非受控初值。默认展开 */
  defaultExpanded?: boolean
  /** 受控展开态 —— 做「全部展开 / 全部收起」时必须用受控 */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void

  /**
   * 内容区是否带内边距。默认 true；放表格时传 false。
   *
   * 表格自带单元格内边距，外面再套一层会让表头与卡片边框对不齐 ——
   * 差那几像素在一屏里很显眼。
   */
  padded?: boolean

  /** 加载中：显示骨架而不是空白。行数按内容高度给 */
  loading?: boolean
  /** 骨架行数。默认 3 */
  skeletonRows?: number
  /**
   * 取数失败。**单张卡失败不该让整页挂掉** —— 就地显示原因 + 重试，
   * 其余卡片照常可用。
   */
  error?: Error | string | null
  onRetry?: () => void
  /** 内容为空时显示它（如「暂无关联资源」）。给了才在 children 为空时生效 */
  empty?: React.ReactNode

  /**
   * 标题行下面那条分隔线。默认 `true`。
   *
   * 关掉的场景：内容本身已经自带上边界（顶到卡片边的表格有表头线、图表有坐标轴），
   * 再来一条就是两条平行线挨着，读作一道粗缝而不是一条分隔。
   * 内容是散排文字时保持默认 —— 没有线的话标题会和正文糊成一坨。
   */
  headerDivider?: boolean

  /**
   * 底部脚注。**默认不要用** —— 卡片的说明走 `hint`（标题旁的 `?`）。
   * 只在内容必须常驻、不能藏进浮层时才给（开发明确要求的那种）。
   */
  footer?: React.ReactNode
  footerClassName?: string

  children?: React.ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  icon,
  title,
  summary,
  hint,
  actions,
  collapsible = false,
  defaultExpanded = true,
  expanded: expandedProp,
  onExpandedChange,
  padded = true,
  headerDivider = true,
  loading = false,
  skeletonRows = 3,
  error = null,
  onRetry,
  empty,
  footer,
  footerClassName,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  const t = useUiT()
  const [inner, setInner] = React.useState(defaultExpanded)
  const controlled = expandedProp !== undefined
  const expanded = collapsible ? (controlled ? expandedProp : inner) : true
  const toggle = () => {
    const next = !expanded
    if (!controlled) setInner(next)
    onExpandedChange?.(next)
  }

  // toArray 会丢掉 null / undefined / boolean —— `{list.length > 0 && <Table/>}` 这种常见写法
  // 在空时 children 是 `false`，用 Children.count 会算成 1 个节点，空态永远不出现（2026-09-01 实测抓到）。
  const isEmpty = empty !== undefined && !loading && !error && React.Children.toArray(children).length === 0

  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {/*
        可折叠时**整条 header 都可点**，不只是那个 28px 的箭头 —— 标题、摘要、
        空白处点哪儿都能开合（2026-09-03 LF 定案）。折叠卡的标题行本身就是
        「这一段的开关」，只认箭头等于把命中区缩到十几分之一。

        右侧操作区 `stopPropagation` 拦住冒泡：那里的「查看全部」这类按钮有自己的
        动作，点它不该顺带折叠掉整张卡。

        可达性：`role="button"` + `tabIndex` + Enter/Space —— header 是 `<header>`
        不是 `<button>`，这几样不补就只有鼠标能用。里面那个箭头按钮保留，
        它才是屏幕阅读器识别的正经开关（带 `aria-expanded`），
        所以 header 自己不再报 `aria-expanded`，避免同一状态播报两遍。
      */}
      <header
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          headerDivider && "border-b border-border/60",
          collapsible && "cursor-pointer select-none"
        )}
        {...(collapsible
          ? {
              role: "button",
              tabIndex: 0,
              onClick: (e: React.MouseEvent) => {
                /*
                 * 点到**任何可交互元素**就不折叠：`actions` 里的「查看全部」、
                 * 摘要里的链接、右边那个折叠按钮自己（它有自己的 onClick）。
                 * 用 `closest` 判来源，比给每个操作包一层 stopPropagation 稳 ——
                 * 调用方往 `actions` 里塞什么我们管不着，但它总归是按钮或链接。
                 */
                const hit = (e.target as HTMLElement).closest(
                  "button,a,input,select,textarea,[role=button]"
                )
                if (hit && hit !== e.currentTarget) return
                toggle()
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                // 只响应落在 header 自身上的按键：焦点在操作按钮里时不该折叠
                if (e.target !== e.currentTarget) return
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  toggle()
                }
              },
            }
          : {})}
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        {/* 标题与 `?` 成一组、用自己的窄 gap：吃标题行的 `gap-3` 会让问号飘得像另一个元素，
            而它解释的就是左边这个标题。点它不该连带折叠卡片，所以拦掉冒泡。
            `min-w-0`：标题 + 操作放不下时标题折行，操作区不被挤出卡头（操作区 shrink-0 不让位） */}
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="min-w-0 text-sm font-medium text-foreground">{title}</h3>
          {hint && (
            <span className="flex" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <FieldHint>{hint}</FieldHint>
            </span>
          )}
        </div>
        {/* 摘要可截断：标题和操作都不该为它让位 */}
        {summary && (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</p>
        )}
        {/* `-my-1`：标题行的高度必须由**文字**决定，不能由里面塞了什么控件决定。
            折叠按钮是 `icon-sm`（28px），比 `text-sm` 的行高（20px）高 8px ——
            不抵掉的话，「加了折叠按钮的卡片」比「没加的」高 8px，两张卡并排
            一眼就看出上沿没对齐（页面上卡片是成排出现的，这种差最显眼）。
            上下各吃掉 4px，28 → 20，与纯文字标题行严丝合缝。

            这同时给 `actions` 定了个契约：**高度 ≤ 28px 的控件不会撑高标题行**
            （`xs` / `sm` / `icon-xs` / `icon-sm` 都在这条线内）。再高的控件会
            把卡片撑高 —— 那种东西本来也不该放在标题行里。 */}
        {(actions || collapsible) && (
          <div className={cn("-my-1 flex shrink-0 items-center gap-1", !summary && "ml-auto")}>
            {actions}
            {collapsible && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={expanded}
                aria-label={expanded ? t("shared.collapse") : t("shared.expand")}
                /* 按钮**自己 toggle**：header 的 onClick 会把落在 button 上的点击
                   排除掉（见上面的 closest 判断），不自己做这里就点不动了。
                   stopPropagation 是双保险，也让语义更清楚：这次点击到此为止。 */
                onClick={(e) => {
                  e.stopPropagation()
                  toggle()
                }}
              >
                <ChevronDown
                  className={cn("size-4 transition-transform", !expanded && "-rotate-90")}
                />
              </Button>
            )}
          </div>
        )}
      </header>

      {/* 折叠用条件渲染而不是 CSS 隐藏：卡片内容常是表格/图表，
          藏着不卸载会持续占内存、图表还会继续跑动画和 resize 监听。
          与筛选栏那种「藏着保留未提交输入」的场景取舍相反。 */}
      {expanded && (
        <>
          <div
            className={cn(
              padded && "px-4 py-3.5",
              // padded={false} 是给表格用的：内容贴边，让表格自己的边框走满卡片。
              // 但 shadcn 的 Table 单元格是 `px-2`（上游原值，不 fork），
              // 而本卡的 header / footer 是 `px-4` —— 直接贴边会差 8px，
              // 表现为「表格比标题往左缩了一点、比脚注缩得更多」。
              // 所以把嵌套表格的单元格补齐到 px-4，三者左边缘才对齐。
              // 只作用于直接后代的 th/td，不影响表格里再嵌的东西。
              !padded && "[&_table_th]:px-4 [&_table_td]:px-4",
              contentClassName
            )}
          >
            {loading ? (
              <div className={cn("flex flex-col gap-2.5", !padded && "px-4 py-3.5")}>
                {Array.from({ length: skeletonRows }, (_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : error ? (
              <div
                className={cn(
                  "flex items-start gap-2.5 text-sm text-destructive",
                  !padded && "px-4 py-3.5"
                )}
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("shared.loadFailed")}</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    {typeof error === "string" ? error : error.message}
                  </p>
                </div>
                {onRetry && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={onRetry}>
                    <RotateCw />
                    {t("shared.retry")}
                  </Button>
                )}
              </div>
            ) : isEmpty ? (
              <div
                className={cn(
                  "py-6 text-center text-sm text-muted-foreground",
                  !padded && "px-4"
                )}
              >
                {empty}
              </div>
            ) : (
              children
            )}
          </div>

          {/* 脚注：配了才出现，连同它上面那条分隔线 */}
          {footer && (
            <footer className={cn("border-t border-border/60 bg-surface-toolbar px-4 py-2.5 text-xs text-muted-foreground", footerClassName)}>
              {footer}
            </footer>
          )}
        </>
      )}
    </section>
  )
}
