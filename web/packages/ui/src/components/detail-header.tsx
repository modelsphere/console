"use client"

// DetailHeader —— 资源详情页的页头卡。
//
// ══════════════════════════════════════════════════════════════════════════════
// 它把详情页顶部那一整块固化下来：返回 / 图标+标题+状态 / 副标题 / 异常提示 /
// 规格条 / Tab 栏。这些东西每个详情页都要，而且每次手搓都会长得不太一样 ——
// 间距差几像素、分隔线有无、异常提示放哪儿，攒够几个页面就散了。
//
// ── 设计的核心：组件管排版，调用方管内容 ────────────────────────────────────
// 不同资源的详情页，规格条里该显示什么**完全不一样**：推理服务是「服务 ID /
// 归属 / 副本 / 运行时长」，模型仓库可能是「格式 / 大小 / 版本 / 下载量」，
// 节点可能是「架构 / 内核 / 调度状态 / 污点」。
//
// 所以 `meta` 是一个**数组**，不是一组固定字段。组件只保证：小标签在上、值在下、
// 等宽分列、超出换行、没有数据时整块（连同分隔线）消失。
// 这与 ResourceTable 的 `activeFilters` 是同一条思路 —— 内置固定字段的组件
// 迟早会长出 20 个配置项和一个 renderXxx 逃生口。
//
// ── 中性纪律 ────────────────────────────────────────────────────────────────
// 返回用 `onBack` 回调而不是 `href` —— 设计系统组件不该 import next/link
// （插件运行时和 Storybook 里会炸）。路由是业务概念，交还给调用方。

import * as React from "react"
import { ArrowLeft, MoreHorizontal, TriangleAlert } from "lucide-react"
import { cn } from "../utils"
import { useUiT } from "../i18n/index"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"
import { StatusIndicator, type StatusVariant } from "./status-indicator"

export interface DetailAction {
  key: string
  label: string
  icon?: React.ReactNode
  /** 危险动作：文字用 destructive 色。二次确认由调用方决定要不要做 */
  danger?: boolean
  /** 返回 true 置灰；返回字符串则置灰并把它作为原因提示 */
  disabled?: boolean | string
  onClick: () => void
}

export interface DetailMetaItem {
  label: string
  value: React.ReactNode
}

export interface DetailNotice {
  tone: StatusVariant
  /** 发生了什么 */
  title: string
  /** 为什么 */
  detail?: React.ReactNode
  /** 下一步。传节点而不是回调 —— 有时是按钮，有时是链接 */
  action?: React.ReactNode
}

export interface DetailHeaderProps {
  /** 返回上一层。不给就不显示返回区 */
  onBack?: () => void
  /** 返回按钮上的文字，通常是列表页名称（如「推理服务」） */
  backLabel?: string

  /** 标题左侧的图标，给标题一个视觉锚点 */
  icon?: React.ReactNode
  title: string
  /** 一句「它是什么」。不要往里塞 ID / 归属那些事实 —— 那些归 meta */
  subtitle?: React.ReactNode
  status?: { tone: StatusVariant; label: string; animated?: boolean }

  /**
   * 左侧竖条的颜色档。不传就跟随 `status.tone`；传 `false` 关掉。
   *
   * 这条竖条是本组件唯一的"装饰"，但它承担实际功能：让健康状态成为**余光可感**
   * 的信息。一屏信息里，一个小状态点很容易被略过；一条贯穿整卡的色带不会。
   */
  accent?: StatusVariant | false

  /** 异常提示。健康时不传 */
  notice?: DetailNotice

  /**
   * 操作。**≤ 5 个全部平铺，> 5 个全部收进 ⋯** —— 阈值由组件定，调用方不能选
   * （LF 2026-09-15）。没有「平铺几个、剩下折叠」这种混合形态。
   */
  actions?: DetailAction[]
  additionalActions?: React.ReactNode

  /** 规格条。空数组或不传则整块消失（含分隔线） */
  meta?: DetailMetaItem[]
  /**
   * 规格条列数上限。默认 4 —— 实际列数取 `min(metaColumns, meta.length)`，
   * 3 项配 4 列会多留一条空轨道，右侧凭空多出一段留白。
   */
  metaColumns?: 2 | 3 | 4

  /** 底部 Tab 栏插槽，通常放一个 `<TabsList>` */
  tabs?: React.ReactNode

  className?: string
}

const ACCENT_CLASS: Record<StatusVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
  default: "bg-muted-foreground",
}

/** 提示条的底色与文字色。用同色低透明底 + 同色文字，不用实心块 —— 实心块太吵 */
const NOTICE_CLASS: Record<StatusVariant, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/8 text-destructive",
  info: "bg-info/8 text-info",
  neutral: "bg-muted text-muted-foreground",
  default: "bg-muted text-muted-foreground",
}

/**
 * 规格条的列轨道。**每列有宽度上限，不等分整行宽度**（project#287）。
 *
 * 原来是 `sm:grid-cols-4`：四条等分轨道铺满整张卡。窄屏上这没问题，1600px 以上每列
 * 就有 380px+，而规格条装的多半是 ID、工作空间名、几个数字 —— 值只占前 1/3，后面全是
 * 空的，四项之间被拉开到读不成一组。节点详情与资源池详情两页都栽在这上面。
 *
 * `minmax(0, 14rem)`：轨道**长到 14rem 就停**，剩下的宽度留在右侧不参与分配，列因此
 * 向左聚拢成一块。**装不下时退回等分**（四列的临界是卡内容宽 992px = 4×224 + 3×32；
 * 更窄就按可用宽度均分，与改动前逐像素一致），所以窄屏与两栏布局里的页头不受影响 ——
 * 这条只在「本来就宽得没必要」的地方起作用。
 * 下界写 0 而不是 auto，长值才截得掉（`dd` 上的 `truncate` 靠它生效）。
 *
 * 14rem 的来历：规格条里最宽的一类值是中截断到 20 字符的 mono ID 加一个复制键
 * （约 190px），14rem = 224px 装得下它，再宽的部分只会是空白。
 * 试过 `minmax(0, max-content)`（按内容定宽）：短值那几列会挤到快贴在一起，且列宽
 * 随数据跳动，两行 meta 时上下对不出节奏 —— 等宽 + 封顶才既紧凑又稳定。
 */
const META_COLS = {
  1: "grid-cols-[repeat(1,minmax(0,14rem))]",
  2: "sm:grid-cols-[repeat(2,minmax(0,14rem))]",
  3: "sm:grid-cols-[repeat(3,minmax(0,14rem))]",
  4: "sm:grid-cols-[repeat(4,minmax(0,14rem))]",
} as const

function ActionButton({ action }: { action: DetailAction }) {
  const d = action.disabled
  const btn = (
    <Button
      variant="outline"
      size="sm"
      disabled={!!d}
      // 悬停只把颜色压到 70%、不铺灰底（LF 2026-09-09 定，与行操作同一套手感）：
      // 普通动作 → 主色 70%（中性主题下就是近黑压淡，彩色主题下是主色压淡）；
      // 危险动作 → 红 70%。描边跟着文字走。压 tailwind-merge 同组覆盖 outline 的 hover。
      className={cn(
        "enabled:hover:bg-background",
        action.danger
          ? "text-destructive enabled:hover:border-destructive/70 enabled:hover:text-destructive/70"
          : "enabled:hover:border-primary/70 enabled:hover:text-primary/70"
      )}
      onClick={action.onClick}
    >
      {action.icon}
      {action.label}
    </Button>
  )
  // 置灰必须给原因。套一层 span —— disabled 的按钮不派发指针事件，
  // 直接挂 tooltip 会弹出来就不消失
  if (typeof d !== "string") return btn
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-not-allowed">{btn}</span>} />
      <TooltipContent>{d}</TooltipContent>
    </Tooltip>
  )
}

/**
 * 平铺的上限。超过它，**所有**动作整组收进 ⋯，不做「前 N 个平铺、其余折叠」
 * 的混合形态（LF 2026-09-15）。
 *
 * 混合形态的两个毛病：平铺出来的那几个是按声明顺序切的、不是按重要性，用户得在
 * 两个地方找动作；各页面动作数量不一时标题行宽度还会跳。
 */
const INLINE_ACTION_LIMIT = 5

export function DetailHeader({
  onBack,
  backLabel,
  icon,
  title,
  subtitle,
  status,
  accent,
  notice,
  actions = [],
  additionalActions,
  meta = [],
  metaColumns = 4,
  tabs,
  className,
}: DetailHeaderProps) {
  const t = useUiT()
  const backText = backLabel === undefined ? t("shared.back") : backLabel
  const accentTone = accent === false ? null : (accent ?? status?.tone ?? null)
  const showToolbar = Boolean(onBack || actions.length || additionalActions)
  // 要么全平铺、要么全折叠 —— 见 INLINE_ACTION_LIMIT。
  const foldAll = actions.length > INLINE_ACTION_LIMIT
  const inline = foldAll ? [] : actions
  const folded = foldAll ? actions : []
  // 列数不超过项数：轨道数比项数多的那几条是空的，只在右边多留一段白。
  // 夹在 1..4 之间而不是直接 as：`metaColumns` 的类型只在编译期成立，而本组件是经
  // 宿主 `SDK.components` 注入给远程插件的 —— 插件那边拿到的是 any，传进来什么都可能。
  // 键落空时 `cn` 会把 undefined 丢掉，静态 className 里的 `grid-cols-2` 兜底。
  const metaCols = Math.min(4, Math.max(1, Math.min(metaColumns, meta.length))) as keyof typeof META_COLS

  return (
    <TooltipProvider>
      <section
        // 给宿主一个稳定的钩子：板形态（data-surface=board）下宿主会把页面容器的顶部
        // 留白抹掉（给列表工具栏贴顶栏用），而页头卡是一张卡、不能贴着顶栏 —— 宿主按
        // 这个 slot 把 16px 补回来（console globals.css「板形态 · 内容区顶部留白」一节）。
        data-slot="detail-header"
        className={cn(
          "relative overflow-hidden rounded-lg border border-border bg-card",
          className
        )}
      >
        {accentTone && (
          <span
            aria-hidden
            className={cn("absolute inset-y-0 left-0 w-[3px]", ACCENT_CLASS[accentTone])}
          />
        )}

        <div className="px-5 pt-4 pb-0">
          {showToolbar && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {onBack ? (
                // 用箭头而不是折角（chevron）：折角在导航里表达的是「展开/下一级」，
                // 箭头才是「回退」。这个区分在返回按钮上尤其要紧 —— 它是页面里
                // 唯一的逃生口，语义不能含糊。
                <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  {backText}
                </button>
              ) : (
                <span />
              )}

              <div className={cn("flex shrink-0 items-center gap-2", additionalActions && "max-w-full flex-wrap")}>
                {inline.map((a) => (
                  <ActionButton key={a.key} action={a} />
                ))}
                {/* 超过阈值就整组收进 ⋯，见 INLINE_ACTION_LIMIT。 */}
                {folded.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="icon-sm" aria-label={t("shared.moreActions")}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="min-w-36">
                      {folded.map((a) => {
                        const d = a.disabled
                        return (
                          <DropdownMenuItem
                            key={a.key}
                            disabled={!!d}
                            variant={a.danger ? "destructive" : undefined}
                            // 与 ResourceTable 行操作的 ⋯ 菜单同一套手感（LF 2026-09-09）：
                            // 高亮时文字染主色（危险项仍红）、行高 py-1.5 px-2.5。
                            // 标签直接当文本节点：基类 `focus:**:text-accent-foreground` 会把
                            // 所有后代元素压回 accent 色，文本节点不受它管。
                            className="px-2.5 py-1.5 whitespace-nowrap not-data-[variant=destructive]:focus:text-primary"
                            // 置灰原因走原生 title，**不在菜单里铺第二行**（LF 2026-09-15）：
                            // 那行灰字把菜单项撑成两行高、还和标签抢视线。禁用项不派发指针
                            // 事件，Tooltip 组件在这里挂不住，原生 title 是唯一能用的。
                            title={typeof d === "string" ? d : undefined}
                            onClick={a.onClick}
                          >
                            {a.icon}
                            {a.label}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {additionalActions}
              </div>
            </div>
          )}

          {/* ── 标题行 ── */}
          <div className={cn("flex items-start gap-3", showToolbar && "mt-3")}>
            {icon && (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                {/* 「标题」档：lg + 500（PATTERNS §5.4 角色表，LF 2026-09-08 试看）。
                    此前 2xl + 600：字重超出「只有 400 / 500」的规矩，字号也与页头 PageBanner
                    的 lg 不在一档 —— 同一个对象在列表页头和详情页头不该是两种分量。 */}
                <h1 className="text-lg font-medium text-foreground">{title}</h1>
                {status && (
                  <StatusIndicator
                    variant={status.tone}
                    animated={status.animated}
                    label={status.label}
                  />
                )}
              </div>
              {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          {/* ── 异常提示 ──
              紧贴标题下方：它回答「现在出了什么事」，与标题是同一件事的两面。
              三段式 —— 发生了什么 / 为什么 / 下一步。只甩一个红色状态词，
              等于把诊断工作全丢给用户。 */}
          {notice && (
            <div
              className={cn(
                "mt-3.5 flex items-start gap-2.5 rounded-md px-3 py-2.5",
                NOTICE_CLASS[notice.tone]
              )}
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{notice.title}</p>
                {notice.detail && (
                  <p className="mt-0.5 text-xs leading-relaxed opacity-90">{notice.detail}</p>
                )}
              </div>
              {notice.action && <div className="-my-1 shrink-0">{notice.action}</div>}
            </div>
          )}

          {/* ── 规格条 ──
              字段由调用方给，组件只管排版。没有数据时整块连同分隔线一起消失 ——
              留一条空分隔线比没有更难看。 */}
          {meta.length > 0 && (
            <dl
              className={cn(
                "mt-5 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-border/60 pt-4 pb-4",
                META_COLS[metaCols]
              )}
            >
              {meta.map((m) => (
                <div key={m.label} className="min-w-0">
                  {/* 两级对比而非两种颜色：眼睛先扫到值，需要时再看标签。
                      标签不做「全大写 + 加字距」—— 中文没有大小写，字距一拉反而散。 */}
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="mt-1 truncate text-sm text-foreground">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* 没有 meta 时补一点底部留白，否则标题会贴着卡片下沿 */}
          {meta.length === 0 && <div className="h-4" />}
        </div>

        {/* Tab 贴卡片底边：页头与 Tab 本是一体 —— Tab 切的是「这个对象的哪一面」 */}
        {tabs && <div className="border-t border-border/60 px-5 py-2.5">{tabs}</div>}
      </section>
    </TooltipProvider>
  )
}
