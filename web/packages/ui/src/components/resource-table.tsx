"use client"

// ResourceTable —— 资源列表表格。
//
// ══════════════════════════════════════════════════════════════════════════════
// **资源列表一律用本组件。**
// ══════════════════════════════════════════════════════════════════════════════
//
// ── 职责边界 ───────────────────────────────────────────────────────────────
//
//   ResourceTable 管：展示、排序、分页、选择、批量、列管理、状态（空/加载/错误）
//   调用方管：      筛选控件、筛选逻辑、取数据
//
// **表格从不过滤数据。** 数据进来什么样就渲染什么样。
//
// 为什么这么切：筛选形态千变万化（链式依赖、级联、日期范围、树选择、远程搜索下拉），
// 任何内置方案都必然不够用，最后一定长成「20 个配置项 + 一个 renderFilter 逃生口」，
// 而且仍然表达不了链式筛选。
//
// 由此而来的几条：
//   - `ResourceColumn` 没有 searchable / searchType / searchOptions，只管展示与排序
//   - 没有 onSearch 回调
//   - `mode` 的语义是「分页和排序谁算」，与筛选无关
//   - **表格彻底不碰路由** —— 筛选状态归调用方，URL 同步也归它（设计系统组件
//     不该 import next/navigation，否则插件运行时和 Storybook 里会炸）
//
// ── 唯一的耦合点：activeFilters ───────────────────────────────────────────
// 表格需要知道「当前筛了什么」，但只为三件事：画 chip 行、区分空态、决定「清除
// 全部」是否可用。所以它吃的是**已生效筛选的描述**（key/label/display），不是控件。

import * as React from "react"
import {
  ChevronRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Download,
  Inbox,
  Loader2,
  MoreHorizontal,
  SearchX,
  TriangleAlert,
  X,
} from "lucide-react"
import { cn } from "../utils"
import {
  activateRowFromKeyboard,
  isRowActivationEnabled,
  shouldActivateRowFromPointer,
} from "./resource-table-row-activation"
import {
  type ColumnVisibility,
  resolveHiddenColumns,
  toggleColumnVisibility,
} from "./resource-table-column-visibility"
import { ConfirmDialog } from "./confirm-dialog"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { RefreshButton } from "./refresh-button"
import { Checkbox } from "./ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination"
import { Skeleton } from "./ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty"
import { DataSelect } from "./data-select"
import { useUiT } from "../i18n/index"

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceColumn<T> {
  key: string
  title: React.ReactNode
  /** 不给就取 `row[key]` */
  render?: (row: T, index: number) => React.ReactNode
  /**
   * 列宽，单位是**默认密度下的像素**。
   *
   * 实际渲染时换算成 `calc(var(--spacing) * N)`，所以会**跟着「界面密度」偏好缩放**
   * —— 写死 px 的话，密度调大后字号和内边距变大、列宽却不动，内容会被挤爆。
   *
   * 固定列（`fixed`）**必须**给宽度：粘性偏移靠累加前面各列宽度算出来。
   */
  width?: number
  align?: "left" | "center" | "right"
  /** 表头可点排序（三态：升 → 降 → 取消） */
  sortable?: boolean
  /** 远程排序时传给后端的字段名，默认用 `key` */
  sortKey?: string
  /** 本地排序的自定义比较；不给就按值类型自动推断 */
  sortComparator?: (a: T, b: T) => number
  /**
   * 横向滚动时固定在左/右边缘。
   *
   * **固定列必须给 `width`** —— 粘性定位要靠累加前面各列的宽度算出偏移量，
   * 宽度未知就算不出来。没给 width 的固定列会被降级为普通列（并在 dev 下告警），
   * 而不是错位显示 —— 错位比不固定更难查。
   */
  fixed?: "left" | "right"
  /** 列显隐面板里是否允许隐藏。默认 true；首列一般设 false */
  hideable?: boolean
  /** 默认是否隐藏（用户可在列显隐里打开） */
  defaultHidden?: boolean
  /** @deprecated 旧前端导出的取值映射；统一导出走 `onExport`，本字段只保留类型兼容。 */
  exportValue?: (row: T) => string | number
}

export interface ActiveFilter {
  /** 用于 onRemoveFilter 回传 */
  key: string
  /** chip 上的字段名 */
  label: string
  /** chip 上的值。多选时调用方自己拼成 `运行中 +2` */
  display: string
}

export type SortOrder = "asc" | "desc"
export interface SortState {
  key: string
  order: SortOrder
}

export interface BatchAction<T> {
  key: string
  label: string
  icon?: React.ReactNode
  /** 危险动作：文字用 destructive 色，且执行前弹确认框列出全部对象 */
  danger?: boolean
  /**
   * 确认框里再加一道「键入确认」闸门：**批量要抄固定词 `delete`**。
   *
   * 批量的风险不是"选错了哪一条"（清单已经列全），而是**没意识到这是 N 条**，
   * 所以只需要一个「我知道我在删东西」的动作，不必逐条抄标识 —— 那没人会做，
   * 只会逼人去找绕过的办法。判据全文见 `design/PATTERNS.md` 第 4 节。
   *
   * 默认关。本组件运行时注入进各插件，默认打开等于给全平台列表页静默加闸门。
   */
  requireTypeConfirm?: boolean
  /**
   * 逐项判定这条数据是否适用。
   * 返回 `true` 可执行；`false` 或**字符串**表示跳过（字符串会作为原因显示）。
   *
   * 这是批量操作最容易被做漏的一环：「批量关机」对已关机的实例无意义、「释放资源」
   * 对运行中的可能被禁止。没有逐项判定，用户点完只成功一半且不知道为什么。
   */
  applicableTo?: (row: T) => boolean | string
  /**
   * 执行。**逐项返回结果** —— 批量操作大概率部分成功，只回一个「操作完成」是错的。
   * 成功的项会自动移出选择集，失败的留着，用户能直接对剩下的重试。
   * 结果通过 `onBatchDone` 交给调用方去 toast。
   */
  run: (rows: T[]) => Promise<BatchResult[]> | BatchResult[]
}

export interface BatchResult {
  /** 对应行的 rowKey 值 */
  key: string
  ok: boolean
  /** 失败原因 */
  message?: string
}

export interface RowAction<T> {
  key: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onClick: (row: T) => void
  /** 返回 false 置灰；返回字符串则置灰并作为 tooltip 原因 */
  disabled?: (row: T) => boolean | string
}

/** @deprecated 统一导出入口是 `onExport`；本类型只保留调用方类型兼容，不渲染任何入口。 */
export interface ExportConfig<T> {
  /** 旧前端导出文件名。 */
  filename?: string
  /** 旧前端导出范围。 */
  scopes?: ("page" | "all" | "selected")[]
  /** 旧前端自定义导出回调。 */
  onExport?: (rows: T[], scope: "page" | "all" | "selected") => void
}

export interface ResourceExpandable<T> {
  /** 展开后渲染什么。拿到整行数据，返回任意节点 */
  render: (row: T) => React.ReactNode
  /**
   * 哪些行可展开。返回 false 的行渲染**空格子**，不渲染置灰箭头 ——
   * 一个点不动的箭头比没有箭头更让人困惑（"是坏了还是我没权限？"）。
   */
  /*
   * 曾有 `panel?: "inset" | "plain"` 两档 —— **2026-09-09 退役**。
   * 它是为了绕开当时那个灰底加的，结果全站长出两种面板。
   * **面板的画法只有一种，页面不参与。**
   */
  rowExpandable?: (row: T) => boolean
  /**
   * 同时能开几行。默认 `multiple`。
   *
   * `multiple` 是为了**横向对比**（展开区里放的往往是指标）。`single` 留给
   * 内容特别重、开两个就找不着北的表。
   */
  mode?: "single" | "multiple"
  /** 首屏默认展开哪几行（按 rowKey） */
  defaultExpandedKeys?: string[]
  /** 受控。做「全部展开 / 全部收起」时用 */
  expandedKeys?: string[]
  onExpandedChange?: (keys: string[]) => void
}

export interface ResourceTableProps<T> {
  data: T[]
  columns: ResourceColumn<T>[]
  /** 行唯一键的字段名。跨页选择、批量、列表 diff 全依赖它，必须可靠 */
  rowKey: keyof T & string

  loading?: boolean
  error?: Error | string | null
  onRetry?: () => void

  // ── 筛选：插槽 + 描述 ────────────────────────────────────────────────────
  /**
   * 作用域筛选（集群 / 工作空间），放 `ScopeFilter`。**固定渲染在筛选区第一位**，后面画一条
   * 竖分隔线 —— 它是上下文（「在哪个范围里看」），不是普通筛选条件，位置由组件保证，不靠约定。
   * 页面已在该作用域的 URL 下（侧栏有选择器）时不要再传（PATTERNS §1）。
   */
  scopeFilter?: React.ReactNode
  /** 筛选区插槽。放任何表单控件，建议用 FilterField 包一层统一排版 */
  filters?: React.ReactNode
  /** 当前生效的筛选，只用于画 chip / 区分空态 / 「清除全部」可用性 */
  activeFilters?: ActiveFilter[]
  onRemoveFilter?: (key: string) => void
  onClearFilters?: () => void
  /**
   * 工具栏排布（LF 2026-09-06）。
   *
   * `stacked`（默认）：筛选行 → 生效筛选的 chip 行 → 操作行，三块叠放。
   * `inline`：筛选项与操作项**合成一行** —— 筛选靠左，创建 / 批量 / 列显隐 /
   * 刷新靠右；放不下时右侧那组整体掉到第二行仍右对齐。这一形态下 chip 行不画
   * （FilterSelect 已把选中值写在芯片里，再摆一行是同一信息说两遍），「清除全部」
   * 跟在筛选项后面；「收起筛选」默认不显示（筛选就在眼前，收起没意义）。
   *
   * 两种只是同一批子节点的两种 JSX 排布，没有各自的状态，切换零成本。
   */
  toolbarLayout?: "stacked" | "inline"
  /** 「收起筛选 / 展开筛选」按钮。默认：stacked 显示、inline 不显示 */
  filterToggle?: boolean
  /**
   * 高度形态（LF 2026-09-07，PATTERNS §1「两种高度形态」）。
   *
   * `auto`（默认）：**随页** —— 表是自然高度，分页跟在表尾，整个内容区滚动。
   *   页面还有图表 / 卡片等别的内容块时用它。
   * `fill`：**铺满** —— 表撑满父容器：工具栏、表头固定，行溢出在表体内滚，分页钉在底部。
   *   页面只有一张表（可带页头 / 页签）时用它。父级要给高度链路：页面外壳
   *   `flex h-full flex-col`，内容区 `min-h-0 flex-1 overflow-hidden flex flex-col`（不是 overflow-auto）。
   *
   * 纯 CSS：只是根容器 / 表体滚动层 / 分页三处的 flex 与 overflow 不同，没有测量与状态。
   */
  height?: "auto" | "fill"

  // ── 排序 ────────────────────────────────────────────────────────────────
  defaultSort?: SortState
  /** 受控排序。传了就以它为准，配 onSortChange */
  sort?: SortState | null
  onSortChange?: (sort: SortState | null) => void

  // ── 分页 ────────────────────────────────────────────────────────────────
  /** 关闭时显示全部传入数据，适用于首页等有界预览。 */
  pagination?: boolean
  /** static：内部分页 + 内部排序；remote：只回调，数据原样渲染 */
  mode?: "static" | "remote"
  page?: number
  pageSize?: number
  /** remote 模式必给 */
  total?: number
  pageSizeOptions?: number[]
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void

  // ── 展开 ────────────────────────────────────────────────────────────────
  /**
   * 行展开。给了才有展开列。
   *
   * 形态选的是**撑开**（占一行真实的 `<tr>`），不是在行下浮出一个层。
   * 决定性的理由是这张表**横向可滚 + 有固定列**：浮层锚在行上，一横向滚要么
   * 跟着行飘（每帧重算位置）、要么脱锚指向别的行；撑开的行天生活在表格坐标系里，
   * 和它那一行一起动，零同步逻辑。
   *
   * 次要理由：浮层是**盖住**下面的行，丢的上下文和撑开一样多，还得先关掉才能看；
   * 而且浮层只能同时开一个，做不了「这两个服务哪个 KV 缓存更吃紧」的横向对比。
   */
  expandable?: ResourceExpandable<T>

  // ── 选择与批量 ──────────────────────────────────────────────────────────
  selectable?: boolean
  /** 返回 false 该行不可选（复选框置灰） */
  isRowSelectable?: (row: T) => boolean
  batchActions?: BatchAction<T>[]
  /** 批量执行完的回调，便于调用方刷新列表 */
  onBatchDone?: (actionKey: string, results: BatchResult[]) => void

  rowActions?: RowAction<T>[] | ((row: T) => RowAction<T>[])
  /** 操作列固定在右边缘。默认 'right'；传 false 关掉 */
  actionsFixed?: "right" | false
  /** 操作列的对齐（表头与内容一致）。默认 'left' —— 操作是次要动作区，
   *  居左能和左边各列的文字起始位对齐，视线不用横跳到最右再回来 */
  actionsAlign?: "left" | "center" | "right"
  /**
   * 操作列宽度。**默认不用传** —— 组件渲染后量各行操作区的自然宽度取最大值回写
   * （`tableLayout: fixed` 下这一列不会自己撑开，只能量）。
   *
   * 只有在「想让它比内容更宽 / 更窄」时才传，传了就完全按你给的来、不再测量。
   */
  actionsWidth?: number
  onRowClick?: (row: T) => void
  /** 返回 false 时，该行不进入焦点顺序，也不响应整行鼠标或键盘激活 */
  isRowActivatable?: (row: T) => boolean

  // ── 卡头 ────────────────────────────────────────────────────────────────
  /**
   * 卡头标题 —— 画在**卡内、工具栏之上**，带一条贯穿的分隔线。
   *
   * 给「页面上不止这一张表」的场合用：一排图表卡下面跟一张表，没有标题就少了个锚，
   * 而在外面套一层 `SectionCard` 会是**两条边框**（本组件自带卡壳：工具栏与表体共用一个
   * 容器）。所以标题归本组件自己画 —— 排版与 `SectionCard` 的卡头同一套（`text-sm` + 500、
   * 摘要降一档灰），两种容器的卡头才长得一样。
   *
   * **页面只有这一张表时不要传**：那时页头（`PageBanner`）已经说了这一页是什么，
   * 再画一次就是同一件事说两遍。
   */
  title?: React.ReactNode
  /** 标题左侧的图标（同 `SectionCard` 的 `icon`） */
  titleIcon?: React.ReactNode
  /** 标题右侧那句小字（同 `SectionCard` 的 `summary`）：不展开就知道这张表装了什么、有多少 */
  titleSummary?: React.ReactNode
  /** 卡头最右侧的插槽。与工具栏的操作区分开：这里放**说明性**的东西（时间范围、口径切换） */
  titleActions?: React.ReactNode

  // ── 工具栏 ──────────────────────────────────────────────────────────────
  /** 操作行左侧（创建按钮等）。批量动作不在这里 —— 它们在勾选后出现的选中操作条上 */
  toolbarLeft?: React.ReactNode
  /** 操作行右侧、内置图标按钮的**再右边**（列表/监控 切换这类自定义） */
  toolbarRight?: React.ReactNode
  showColumnToggle?: boolean
  /**
   * 受控列显隐（`key → 是否显示`），配 `onColumnVisibilityChange`。不传则组件内部自管。
   *
   * 从详情页返回要恢复列显隐时，把它和筛选、页码放进同一个 `useListState`（PATTERNS §1.7）。
   * 没有记录的列按 `defaultHidden` 取初值，`{}` 等价于全按默认；不在 `columns` 里的 key 忽略。
   */
  columnVisibility?: ColumnVisibility
  onColumnVisibilityChange?: (visibility: ColumnVisibility) => void
  showRefresh?: boolean
  onRefresh?: () => void
  /** 自动刷新的可选间隔（秒）。给了才出现下拉 */
  refreshIntervals?: number[]
  /**
   * 统一导出入口。**传了才渲染「导出」按钮**；不传则工具栏没有任何导出 UI。
   *
   * 本包不发网络请求，所以组件只负责在统一位置渲染统一文案的按钮：能力探测、创建导出任务、
   * 结果提示与跳转导出中心都由页面做（PATTERNS §1「导出」）。
   */
  onExport?: () => void | Promise<void>
  /** 导出任务创建中：按钮禁用并显示进行中。 */
  exporting?: boolean
  /** @deprecated 统一导出入口是 `onExport`；本配置不渲染任何入口。 */
  exportConfig?: ExportConfig<T>

  // ── 空态 ────────────────────────────────────────────────────────────────
  /** 「一条都还没有」时的标题。筛选后无结果的文案由组件固定给 */
  emptyTitle?: string
  emptyDescription?: string
  /** 「一条都还没有」时的行动号召（通常是创建按钮） */
  emptyAction?: React.ReactNode
  emptySize?: "default" | "compact"

  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

/** 默认比较：数字按大小，其余按 localeCompare（中文才排得对） */
function defaultCompare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), "zh-Hans-CN")
}

/**
 * 勾选列的固定宽度。
 *
 * 这个值有**两处消费者，必须一致**：表头/单元格的实际宽度，以及左固定列算
 * 粘性偏移时的起点。写死成常量而不是分别用 `w-10` 和字面量 40 —— 两处一旦漂移，
 * 表现是固定列横向错位半个格，很难看出是这里的问题。
 */
// 50 → 35（LF 2026-09-09）：勾选框本身 16px，50 的格子左右各留 17px，一列勾选框看着像悬空；
// 35 = 16 + 单元格 px-2 两侧 16 + 3px 余量，与首列文字的起点对齐得更紧。所有消费者（colgroup /
// 表头粘性偏移 / 固定列 left 累加）都读这一个常量。
const SELECT_COL_WIDTH = 35

/**
 * 展开列的固定宽度。与 SELECT_COL_WIDTH 同理，两处消费者必须一致。
 *
 * 比勾选列窄一档：它只装一个 16px 图标，不需要 50。
 */
const EXPAND_COL_WIDTH = 40

/**
 * 监听横向滚动余量，写成滚动容器上的 data 属性（对应 AntD 的 ping-left/ping-right）。
 *
 * 写 data 属性而不是 React state：固定列散在表头和每一行里，逐个透传要穿好几层；
 * 用 `group/scroll` + `group-data-*` 让 CSS 自己解决，滚动时也不触发 React 重渲染
 * —— 长表格里这点很关键。
 *
 * 三个触发时机缺一不可：滚动、容器尺寸变化（窗口缩放 / 侧栏折叠）、列或行数变化。
 * 只听 scroll 的话，「一进来就放不下」这个最常见的情况反而不会触发（压根没滚过）。
 */
function useScrollEdges(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      // 留 1px 容差：缩放比例下 scrollLeft 会是小数，严格比较会在两端抖动
      el.dataset.scrollL = String(el.scrollLeft > 1)
      el.dataset.scrollR = String(el.scrollLeft < max - 1)
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * 量出操作列该有多宽 —— **默认自适应，调用方不必传 `actionsWidth`**。
 *
 * 表格是 `tableLayout: fixed` + `<colgroup>` 写死列宽，这一列不会自己跟着内容撑开，
 * 所以只能渲染完再量、回写。量的是各行 `[data-slot=row-actions]` 的 `scrollWidth`
 * 取最大值：那个容器是 `w-max whitespace-nowrap`，量到的是**自然宽度**，不受列宽挤压。
 *
 * 为什么要逐行量而不是量第一行：`rowActions` 可以是函数（按行算动作，「运行中才给停止」
 * 这类），各行的动作数并不相同。
 *
 * ⚠️ **一帧的抖动是有意留下的**：首帧用启发式估值，量完再回写。想消掉它得先离屏渲染
 * 一份来量，成本远大于收益 —— 而估值已经覆盖了最常见的 1~2 个动作。
 */
function useActionsWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  deps: unknown[],
): number {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!enabled) { setWidth(0); return }
    const root = ref.current
    if (!root) return
    const measure = () => {
      const cells = root.querySelectorAll<HTMLElement>('[data-slot="row-actions"]')
      let max = 0
      cells.forEach((el) => { max = Math.max(max, el.scrollWidth) })
      // 左右内边距：单元格是 px-2（8px × 2），再留 8px 呼吸，免得按钮贴着固定列的分隔线
      setWidth(max > 0 ? Math.ceil(max) + 24 : 0)
    }
    measure()
    // 动作里可能有异步才定形的东西（图标字体、按钮文案由 i18n 后填），量一次不够
    const ro = new ResizeObserver(measure)
    root.querySelectorAll('[data-slot="row-actions"]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
  return width
}

/**
 * 把「按默认密度算的像素值」换成**跟随密度缩放**的 CSS 表达式。
 *
 * Tailwind v4 里所有尺寸都是 `calc(var(--spacing) * N)`，默认 `--spacing = 4px`。
 * 所以 `w` 个像素 = `N = w / 4` 个 spacing 单位。密度换档时 `--spacing` 变，
 * 列宽跟着变。
 *
 * ── 为什么必须这么做 ────────────────────────────────────────────────────
 * 列宽原本是写死的 px（`width: 210`）。密度调到「宽松」后字号和内边距都放大了，
 * 列宽却纹丝不动 —— 内容被挤爆（实测：智算资源列的百分比被遮掉一半）。
 *
 * ── 为什么不能干脆不写宽度、让它自适应 ──────────────────────────────────
 * 固定列的粘性偏移是**累加前面各列宽度**算出来的，宽度不确定就算不出偏移，
 * 固定列会钉进前一列内部。
 * AntD 的文档同样明确要求「固定列必须指定宽度」，是同一个约束。
 *
 * 所以宽度还得写，但要写成**相对密度**的，而不是绝对像素。
 */
const sp = (px: number) => `calc(var(--spacing) * ${px / 4})`

/** 未声明宽度的列在 fixed 布局下的兜底宽度（单位：默认密度下的 px） */
const DEFAULT_COL_WIDTH = 140

/**
 * 未声明宽度的列计入 tableMinWidth 时的**可读下限**（默认密度下的 px）。
 *
 * 与 DEFAULT_COL_WIDTH 是两个用途不同的值，别合并：
 *   DEFAULT_COL_WIDTH —— fixed 布局给「表格压到 min-width」场景的分列基准，
 *                        只在容器比 min-width 还窄、colgroup 又没写这列时生效；
 *   MIN_AUTO_COL_WIDTH —— min-width 本身要不要为这列保底。弹性列（未声明宽）
 *                        本来会伸缩，不需要 140 的满额保底，只需要「再窄就读不了」
 *                        的下限。80 扣掉单元格水平 padding（px-3 + CELL_INNER 的
 *                        px-1.5 ≈ 36）后剩 ~44px，够放一个状态词/短数字；再小
 *                        truncate 会把文字咬成单字符。
 */
const MIN_AUTO_COL_WIDTH = 80

/**
 * 算每一列的粘性定位样式。
 *
 * **勾选列只要存在就左固定**，不需要配置：勾选框一旦滚出视野，用户在右侧区域
 * 看到想操作的行也勾不上，只能滚回去 —— 那就等于批量操作在宽表上不可用。
 * 它永远是最左的粘性元素（left: 0）。
 *
 * 左固定列的 `left` = 它前面所有左固定列的宽度之和（含勾选列）；
 * 右固定列的 `right` = 它后面所有右固定列的宽度之和（含操作列）。
 *
 * 只有**边界那一列**画分隔阴影 —— 每列都画会糊成一片，且看不出固定区到哪儿为止。
 */
function computeSticky<T>(
  cols: ResourceColumn<T>[],
  widthOf: (c: ResourceColumn<T>) => number,
  /** 左侧控件区总宽（勾选 + 展开）。左固定列的偏移从它之后开始累加 */
  leadWidth: number,
  actionsWidth: number
): Map<string, { style: React.CSSProperties; edge: "left" | "right" | null }> {
  const out = new Map<string, { style: React.CSSProperties; edge: "left" | "right" | null }>()
  const lefts = cols.filter((c) => c.fixed === "left" && c.width)
  const rights = cols.filter((c) => c.fixed === "right" && c.width)

  let offset = leadWidth
  lefts.forEach((c, i) => {
    out.set(c.key, {
      style: { position: "sticky", left: sp(offset), zIndex: 2 },
      // 边界阴影只画在**最后一个**左粘性元素上；每个都画会糊成一片，
      // 也看不出固定区到哪儿为止
      edge: i === lefts.length - 1 ? "left" : null,
    })
    offset += widthOf(c)
  })

  let rOffset = actionsWidth
  ;[...rights].reverse().forEach((c, i) => {
    out.set(c.key, {
      style: { position: "sticky", right: sp(rOffset), zIndex: 2 },
      edge: i === rights.length - 1 ? "right" : null,
    })
    rOffset += widthOf(c)
  })

  return out
}

/**
 * 行的三种背景态。**必须全部不透明**，这是固定列能工作的前提。
 *
 * 固定列用 `bg-inherit` 从行继承背景。`background-color: inherit` 拿到的是父元素
 * **声明的那个值**，不是它与下层合成后的结果 —— 所以只要行是透明的（默认）或半透明的
 * （shadcn 原版 hover 是 `bg-muted/50`），继承过去的也是透明/半透明，横向滚动时
 * 下层单元格的文字就会从固定列里透上来、叠成一团。
 *
 * 选中态用 color-mix 现算出一个不透明色，而不是写 `bg-primary/[0.06]` —— 后者
 * 是半透明，会重蹈上面的覆辙。
 */
/**
 * 展开箭头。
 *
 * ── 命中区大于字形，且静止时不可见 ────────────────────────────────────────
 * 裸 chevron 有三处必丑，这套类逐个治：
 *
 * 1. **重量不匹配** —— 16px 描边字形紧挨着 16px 实心勾选框，笔画重量差一截，
 *    看着像一道杂笔而不是控件。治法是给它一个 28px 的命中区形成"控件"的体量，
 *    但静止时**完全透明**，不在每一行左边永久摆一个方块。
 * 2. **没有命中区** —— 图标本身当热区只有 16px，比 WCAG 的 24px 下限还小，
 *    鼠标过去毫无反应，点起来要瞄。
 * 3. **两级递进的反馈** —— 鼠标进入**这一行**先亮字形（`group-hover/row`），
 *    悬到按钮上才出淡底。进这行就知道"这儿有东西可点"，不必先精确悬到图标上。
 *    淡底用 `foreground/[0.06]` 而不是下划线或明显的选中色 —— 站内既定规范。
 *
 * ── 字形是 14px / stroke 2.5 / 六成色（LF 2026-09-09 定）──────────────────
 * 三个参数各管一件事，都试错过：
 *   **大小 14** —— 16px 在一列 40px 宽的格子里显得空、像飘着的杂笔；12px 又小得
 *                  不像个控件。14 是与正文（`text-sm`）齐平的那一档。
 *   **stroke 2.5** —— lucide 默认 stroke 2 是按 24px 画的，缩到 14px 后线宽只剩
 *                  1.17px，压在半像素上会发虚；提到 2.5 补回去。**尺寸变了别忘了它**。
 *   **色 60%** —— 静止时它只是「这里可以展开」的暗示，不该和数据抢；满色的
 *                  muted-foreground 在一列箭头里显得发硬（LF 实看）。
 *
 * 颜色是**三级递进**，不是两级：静止 60% → 鼠标进这一行回到满色 muted → 悬到按钮上
 * 才是 foreground + 淡底。中间那级是为了让「这一行可展开」在扫行时就看得见。
 */
const EXPAND_BTN = cn(
  "flex size-7 items-center justify-center rounded-md",
  "text-muted-foreground/60 transition-colors",
  "group-hover/row:text-muted-foreground",
  "hover:bg-foreground/[0.06] hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

/** 展开箭头的字形参数（14px，见上方注释）。 */
const EXPAND_ICON = "size-3.5 transition-transform duration-150 ease-out"

const ROW_BG = cn(
  "bg-card",
  "hover:bg-muted",
  "data-[selected]:bg-[color-mix(in_oklab,var(--primary)_6%,var(--card))]",
  "data-[selected]:hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))]"
)

/** 固定列的公共类：背景取自行 —— 前提是行的背景不透明（见 ROW_BG） */
// 粘性单元格自带行分隔线：`position: sticky` + `z-index` 让它成为独立层，画在**行之上**，
// 行的 `border-b`（折叠边框，属于 <tr>）会被这一格的背景盖掉 —— 表现是横向滚动时
// 固定列那一段没有分隔线，别的列有。补一条同色的下边框，两条线重合成一条。
const STICKY_CELL = "bg-inherit border-b"

/**
 * 单元格内容的截断层。
 *
 * ⚠️ 截断必须放在**内层 div**，不能放在 `<td>` 上。
 * `truncate` 含 `overflow-hidden`，而固定列的边界阴影是画在 `<td>` 的**伪元素**上、
 * 且用 `translate-x-full` 推到单元格**外侧** —— td 一旦 overflow-hidden，
 * 那个伪元素就被整块裁掉，阴影再也出不来。
 *
 * `truncate` 三件事都是必需的：
 *   - overflow-hidden：fixed 布局下超宽内容会**溢到下一列**（两列的字叠在一起）
 *   - ellipsis：裁掉要有「…」，否则从中间硬切，看不出还有内容
 *   - nowrap：行高应当一致，不该因为某格文字长就把整行撑高
 *
 * 自定义 render 里的多层结构（flex / 两行布局）不吃这一层的 ellipsis，
 * 得由那些组件自己截断 —— ResourceNameCell / ValueText 已经做了。
 *
 * `-mx-1.5 px-1.5`：**只想裁右边**（防止内容溢到下一列），左右两侧的装饰不该被切。
 * 用「负外边距 + 等量内边距」把裁剪盒往左右各撑开 6px，布局位置不变，
 * 只是给向外扩的装饰留出余量。
 *
 * ── 垂直方向的余量已去掉（2026-09-06，LF 要求，所有布局生效）──────────────
 * 原来还有一组 `-my-1.5 py-1.5`，把裁剪盒上下也撑开 6px —— 那让每个单元格内层
 * 高出 12px，行高跟着变大。
 *
 * ⚠️ **代价**：`StatusIndicator` 的光晕是 `ring-[3px]`，扩在圆点盒子外面，
 * 现在上下各有 3px 落在裁剪面外，会被削掉一点（圆点看着略扁）。
 * 真要两头都保住，得让光晕改用伪元素画在内容盒**里面**，那是 StatusIndicator
 * 自己的改动，不在本处。
 */
const CELL_INNER = "truncate -mx-1.5 px-1.5"

/**
 * 截断的单元格鼠标移上去给原文（原生 `title`）。
 *
 * **只在真截断时挂** —— 没截断也挂的话，每格停一下都弹一遍已经看得见的文字。
 * 用原生 title 而不是 Tooltip 组件：一屏几百个单元格，每个都挂一个受控浮层
 * 的开销和事件量不值当，而这里要的只是「看不全时能看全」。
 */
function overflowTitle(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget
  // 两个方向都要看：单行靠 `truncate`（横向），多行摘要靠 `line-clamp-*`（纵向）。
  // +1 容差：亚像素布局下两个值会差个零点几，不留容差会给没截断的格也挂上
  const clipped = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
  if (clipped) el.setAttribute("title", el.textContent ?? "")
  else el.removeAttribute("title")
}
/**
 * 固定区的边界阴影 —— 照 AntD 的做法。
 *
 * ── 三个关键点，缺一个都出不来 ────────────────────────────────────────────
 *
 * **① 阴影画在伪元素上，不画在单元格上。**
 *    Tailwind preflight 给 table 设了 `border-collapse: collapse`，而合并边框模型下
 *    **单元格自身的 box-shadow 根本不绘制**（规范如此，三大浏览器一致）——
 *    CSS 不报错、类也正常生成，只是浏览器不画。伪元素是普通盒子，不受这条限制。
 *
 * **② 用 inset 阴影 + 外推的窄条。**
 *    伪元素宽 30px、`translate-x-full` 推到单元格外侧，阴影用 `inset` 画在它内部，
 *    于是形成一条从固定列边缘向外渐弱的渐变带。直接用外阴影会是一圈硬边。
 *
 * **③ 只在那一侧真的滚动过时才显示**（AntD 叫 ping-left / ping-right）。
 *    常驻的话两侧永远都有阴影 —— 明明左边已经到头了还画着阴影，是在骗人。
 *    状态由 `useScrollEdges` 写在滚动容器的 data 属性上，这里用 group-data 取。
 */
const EDGE_BASE =
  "relative after:pointer-events-none after:absolute after:top-0 after:bottom-0 after:w-[30px] after:transition-shadow"
/** 左固定区的右边界：伪元素推到单元格右外侧 */
const STICKY_EDGE_LEFT = cn(
  EDGE_BASE,
  "after:right-0 after:translate-x-full",
  "group-data-[scroll-l=true]/scroll:after:shadow-[inset_10px_0_8px_-8px_rgb(0_0_0/0.15)]"
)
/** 右固定区的左边界：伪元素推到单元格左外侧 */
const STICKY_EDGE_RIGHT = cn(
  EDGE_BASE,
  "after:left-0 after:-translate-x-full",
  "group-data-[scroll-r=true]/scroll:after:shadow-[inset_-10px_0_8px_-8px_rgb(0_0_0/0.15)]"
)

// 滚动条（LF 2026-09-07）：两轴都 4px（写死像素不跟密度 —— 铺满形态下竖向滚动条也在这一层，
// 8px 在表体右缘像一根棒子）；平时透明，鼠标移进表体才显出来，移到滑块上再深一档。
//
// 颜色走容器上的 CSS 变量 `--sb`，滑块只读变量，**不要**写成 `[&:hover::-webkit-scrollbar-thumb]:bg-*`：
// Chromium 对滚动条伪元素依赖祖先 :hover 的样式不会在鼠标移出时重绘，滑块会一直留到
// 下一次滚动（LF 实测「移出表格滚动条不消失」）。变量变了伪元素就重算，没有这个问题。
const SCROLLBAR =
  "[--sb:transparent] hover:[--sb:color-mix(in_oklab,var(--foreground)_20%,transparent)] " +
  "[&::-webkit-scrollbar]:h-[4px] [&::-webkit-scrollbar]:w-[4px] " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-(--sb) " +
  "[&::-webkit-scrollbar-thumb:hover]:bg-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent"

// ─────────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────────

export function ResourceTable<T extends Record<string, any>>({
  data,
  columns,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  scopeFilter,
  filters,
  activeFilters = [],
  onRemoveFilter,
  onClearFilters,
  toolbarLayout = "stacked",
  filterToggle,
  height = "auto",
  defaultSort,
  sort: sortProp,
  onSortChange,
  mode = "static",
  pagination = true,
  page: pageProp,
  pageSize: pageSizeProp,
  total: totalProp,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  expandable,
  selectable = false,
  isRowSelectable,
  batchActions,
  onBatchDone,
  rowActions,
  actionsFixed = "right",
  actionsAlign = "left",
  actionsWidth,
  onRowClick,
  isRowActivatable,
  title: cardTitle,
  titleIcon,
  titleSummary,
  titleActions,
  toolbarLeft,
  toolbarRight,
  showColumnToggle = true,
  columnVisibility: columnVisibilityProp,
  onColumnVisibilityChange,
  showRefresh = false,
  onRefresh,
  refreshIntervals,
  onExport,
  exporting = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptySize = "default",
  className,
}: ResourceTableProps<T>) {
  const t = useUiT()
  // 显式传空串 / null 时不回落默认文案，仅 undefined（调用方未传）才取词表
  const emptyTitleText = emptyTitle === undefined ? t("shared.noData") : emptyTitle

  // ── 筛选区展开/收起 ──────────────────────────────────────────────────────
  // 刻意**不记住**（不存 localStorage）：每次进来都是展开。
  // 收起时用 CSS 隐藏而非卸载 —— 卸载会丢掉用户打了一半没提交的输入。
  const [filtersOpen, setFiltersOpen] = React.useState(true)

  // ── 排序：受控优先，否则内部 state ───────────────────────────────────────
  const [sortInner, setSortInner] = React.useState<SortState | null>(defaultSort ?? null)
  const sortControlled = sortProp !== undefined
  const sort = sortControlled ? sortProp : sortInner
  const applySort = (next: SortState | null) => {
    if (!sortControlled) setSortInner(next)
    onSortChange?.(next)
  }
  /** 表头点击：升 → 降 → 取消 */
  const toggleSort = (col: ResourceColumn<T>) => {
    const key = col.sortKey ?? col.key
    if (sort?.key !== key) applySort({ key, order: "asc" })
    else if (sort.order === "asc") applySort({ key, order: "desc" })
    else applySort(null)
  }

  // ── 分页：受控优先 ───────────────────────────────────────────────────────
  const [pageInner, setPageInner] = React.useState(1)
  const [sizeInner, setSizeInner] = React.useState(pageSizeOptions[0] ?? 10)
  const page = pageProp ?? pageInner
  const pageSize = pageSizeProp ?? sizeInner
  const setPage = (p: number) => {
    if (pageProp === undefined) setPageInner(p)
    onPageChange?.(p)
  }
  const setSize = (s: number) => {
    if (pageSizeProp === undefined) setSizeInner(s)
    // 改每页条数后回到第一页 —— 否则可能停在一个已不存在的页码上
    if (pageProp === undefined) setPageInner(1)
    onPageSizeChange?.(s)
    onPageChange?.(1)
  }

  // ── static 模式：内部排序 + 内部分页 ─────────────────────────────────────
  const sorted = React.useMemo(() => {
    if (mode === "remote" || !sort) return data
    const col = columns.find((c) => (c.sortKey ?? c.key) === sort.key)
    if (!col) return data
    const cmp = col.sortComparator ?? ((a: T, b: T) => defaultCompare(a[col.key], b[col.key]))
    // 复制再排：不改调用方传进来的数组（原地排序会让 React 认不出变化）
    const next = [...data].sort(cmp)
    return sort.order === "asc" ? next : next.reverse()
  }, [data, mode, sort, columns])

  const total = mode === "remote" ? (totalProp ?? 0) : sorted.length
  const pageRows = React.useMemo(() => {
    if (mode === "remote" || !pagination) return sorted
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, mode, pagination, page, pageSize])

  // ── 选择：跨页保留 ───────────────────────────────────────────────────────
  // 存的是 rowKey 的值 + 行快照。存快照是为了批量动作能作用到**已翻走的页**上
  // 那些选中项的名称/状态 —— 只存 key 的话，跨页后确认框里只有一串 ID。
  const [selected, setSelected] = React.useState<Map<string, T>>(new Map())
  const selectedRows = React.useMemo(() => [...selected.values()], [selected])
  const keyOf = React.useCallback((row: T) => String(row[rowKey]), [rowKey])

  const toggleRow = (row: T, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (checked) next.set(keyOf(row), row)
      else next.delete(keyOf(row))
      return next
    })
  }
  const selectablePageRows = pageRows.filter((r) => isRowSelectable?.(r) !== false)
  const pageAllSelected =
    selectablePageRows.length > 0 && selectablePageRows.every((r) => selected.has(keyOf(r)))
  const pageSomeSelected = selectablePageRows.some((r) => selected.has(keyOf(r)))
  const toggleAllOnPage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const r of selectablePageRows) {
        if (checked) next.set(keyOf(r), r)
        else next.delete(keyOf(r))
      }
      return next
    })
  }

  // Shift 范围选择：长列表里选连续一段的高频操作
  const lastClickedRef = React.useRef<number | null>(null)
  const handleRowCheck = (row: T, index: number, checked: boolean, shift: boolean) => {
    if (shift && lastClickedRef.current !== null) {
      const [from, to] = [lastClickedRef.current, index].sort((a, b) => a - b)
      setSelected((prev) => {
        const next = new Map(prev)
        for (let i = from; i <= to; i++) {
          const r = pageRows[i]
          if (!r || isRowSelectable?.(r) === false) continue
          if (checked) next.set(keyOf(r), r)
          else next.delete(keyOf(r))
        }
        return next
      })
    } else {
      toggleRow(row, checked)
    }
    lastClickedRef.current = index
  }

  // ── 列显隐 ───────────────────────────────────────────────────────────────
  // 受控优先；非受控保持挂载时按 defaultHidden 取一次初值的行为
  const [hiddenInner, setHiddenInner] = React.useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  )
  const visibilityControlled = columnVisibilityProp !== undefined
  const hidden = React.useMemo(
    () => (visibilityControlled ? resolveHiddenColumns(columns, columnVisibilityProp) : hiddenInner),
    [visibilityControlled, columns, columnVisibilityProp, hiddenInner]
  )
  const setColumnVisible = (key: string, visible: boolean) => {
    if (!visibilityControlled) {
      setHiddenInner((prev) => {
        const next = new Set(prev)
        if (visible) next.delete(key)
        else next.add(key)
        return next
      })
    }
    if (!onColumnVisibilityChange) return
    const current = visibilityControlled
      ? columnVisibilityProp
      : Object.fromEntries(columns.map((c) => [c.key, !hidden.has(c.key)]))
    onColumnVisibilityChange(toggleColumnVisibility(columns, current, key, visible))
  }
  const visibleColumns = columns.filter((c) => !hidden.has(c.key))

  // ── 批量抽屉 ─────────────────────────────────────────────────────────────

  // 滚动容器。声明提前到这儿：下面的操作列宽度测量要用它（`const` 有暂时性死区）。
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  /*
    操作列宽度：**默认自适应**，调用方不必传 `actionsWidth`。

    表格是 `tableLayout: fixed` + `<colgroup>` 写死列宽，所以这一列不会自己跟着内容
    撑开 —— 必须量出来回写。量的是各行 `[data-slot=row-actions]` 的自然宽度取最大值
    （那个容器是 `w-max whitespace-nowrap`，不受列宽挤压），加左右内边距。

    首帧先用启发式估一个值，避免量到之前塌成 0 闪一下。**估值只是起点不是结论** ——
    此前这里就只有估值，且 `rowActions` 传函数时（按行算动作，很常见）取不到样本、
    直接落到 56px 的最窄档，而实际渲染出来是两个文字按钮，必然挤爆。
  */
  const sampleActions = typeof rowActions === "function" ? [] : (rowActions ?? [])
  const inlineCount = sampleActions.length <= 2 ? sampleActions.length : 1
  const actionsGuess = rowActions ? (inlineCount === 2 ? 132 : inlineCount === 1 ? 108 : 56) : 0
  const measuredActions = useActionsWidth(scrollRef, !!rowActions && actionsWidth === undefined, [
    pageRows.length,
    rowActions,
  ])
  const actionsColWidth = actionsWidth ?? (measuredActions || actionsGuess)

  const hasLeftFixed = visibleColumns.some((c) => c.fixed === "left" && c.width)

  useScrollEdges(scrollRef, [visibleColumns.length, pageRows.length, selectable, rowActions])

  // ── 展开 ──────────────────────────────────────────────────────────────────
  const expandMode = expandable?.mode ?? "multiple"
  const [innerExpanded, setInnerExpanded] = React.useState<string[]>(
    () => expandable?.defaultExpandedKeys ?? []
  )
  const expandedCtl = expandable?.expandedKeys !== undefined
  const expandedKeys = expandedCtl ? expandable!.expandedKeys! : innerExpanded
  const expandedSet = React.useMemo(() => new Set(expandedKeys), [expandedKeys])

  const toggleExpand = React.useCallback(
    (k: string) => {
      const has = expandedSet.has(k)
      const next = has
        ? expandedKeys.filter((x: string) => x !== k)
        : expandMode === "single"
          ? [k]
          : [...expandedKeys, k]
      if (!expandedCtl) setInnerExpanded(next)
      expandable?.onExpandedChange?.(next)
    },
    [expandedSet, expandedKeys, expandMode, expandedCtl, expandable]
  )

  /**
   * 展开面板要贴住**可视区**而不是整张表，所以得知道容器的当前宽度。
   *
   * 不做就是 bug 不是体验问题：`<td colSpan>` 的宽度等于整张表（可能 1800px），
   * 面板内容会被拉出视口，读个属性还要横向滚。
   */
  // ── 批量执行 ──────────────────────────────────────────────────────────────
  /** 正在跑的动作 key。用来只禁住那一个按钮，而不是整条操作条 */
  const [running, setRunning] = React.useState<string | null>(null)
  /** 危险动作的二次确认。列出全部将要操作的对象 —— 这是原来抽屉最值钱的那一半 */
  const [confirm, setConfirm] = React.useState<{ action: BatchAction<T>; rows: T[] } | null>(null)

  const run = React.useCallback(
    async (action: BatchAction<T>, rows: T[]) => {
      if (rows.length === 0) return
      setRunning(action.key)
      try {
        const results = await action.run(rows)
        // 成功的项从选择集里移除 —— 它们要么已被删除、要么状态已变，
        // 留着会让下一次批量操作把它们再算一遍。
        // **失败的留下**：用户能直接对剩下的重试，不用重新勾一遍。
        setSelected((prev) => {
          const next = new Map(prev)
          for (const r of results) if (r.ok) next.delete(r.key)
          return next
        })
        onBatchDone?.(action.key, results)
      } finally {
        setRunning(null)
      }
    },
    [onBatchDone]
  )

  /**
   * 滚动容器的**可视宽度**。行展开面板与三种整行状态（加载失败 / 空 / 筛没了）都靠它
   * 贴住可视区居中 —— 它们所在的 `<td colSpan>` 宽度是**整张表**的宽度，列多时远宽于
   * 可视区，`text-center` 在那个宽度里居中就会偏到滚动内容的中点。
   *
   * ⚠️ **不要再加 `expandable` 之类的开关**：这里原先写的是 `if (!el || !expandable) return`
   * ——为行展开面板加的，于是不支持展开的表 `viewWidth` 恒为 0，空态那几处静默退回
   * 「按整张表宽度居中」，跟没修一样（LF 2026-09-18 抓到）。
   */
  const [viewWidth, setViewWidth] = React.useState(0)
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth))
    ro.observe(el)
    setViewWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])


  // computeSticky 只对 c.width 已声明的列取宽度(见其 lefts/rights 过滤),
  // 这里的 DEFAULT_COL_WIDTH 兜底在粘性路径上不可达,仅为类型完整保留
  const widthOf = React.useCallback(
    (c: ResourceColumn<T>) => c.width ?? DEFAULT_COL_WIDTH,
    []
  )
  /**
   * 左侧控件区总宽。顺序是 **勾选 → 展开 → 首列**：
   * 全选框占表头最左角是极强的约定（邮件客户端 / GitHub / 几乎所有表格），
   * 箭头插到它左边会打破它；而且从左到右本来就有个语义梯度 —— 越往右越贴近内容
   * （勾选作用于"这一行作为一个对象"，展开作用于"这一行的内容"，首列就是内容）。
   */
  const leadWidth =
    (selectable ? SELECT_COL_WIDTH : 0) + (expandable ? EXPAND_COL_WIDTH : 0)

  /**
   * 表格总宽下限 = 声明了 width 的列按声明值计入；未声明的**弹性列**只计
   * 可读下限（MIN_AUTO_COL_WIDTH），不按 140 满额兜底。
   *
   * 3383985c 之后未声明列在 colgroup 里不再写死宽 —— 它们本来就会伸缩吃掉
   * 富余，min-width 再按 140/列 兜底就过于保守：容器 1200、七列全未声明时
   * 50+7×140+132=1162 勉强放下，列再多或密度调高一档就被这个虚构的下限
   * **顶出横向滚动条**，而内容其实根本不需要那么宽。滚动条本身有成本（固定
   * 列阴影、滚轮劫持），不该在内容放得下的时候出现。
   *
   * 语义边界：声明宽 = 硬约束（用户说了要这么宽）；未声明 = 弹性（伸缩是
   * 它的本职），只需要保住「再窄就读不了」的底线。
   */
  const tableMinWidth =
    leadWidth +
    visibleColumns.reduce((n, c) => n + (c.width ?? MIN_AUTO_COL_WIDTH), 0) +
    (rowActions ? actionsColWidth : 0)

  const sticky = React.useMemo(
    () =>
      computeSticky(
        visibleColumns,
        widthOf,
        leadWidth,
        rowActions && actionsFixed === "right" ? actionsColWidth : 0
      ),
    [visibleColumns, widthOf, leadWidth, rowActions, actionsFixed, actionsColWidth]
  )

  // 固定列没给宽度算不出偏移，会静默错位 —— 静默是最难查的那种坏
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    const bad = visibleColumns.filter((c) => c.fixed && !c.width)
    if (bad.length) {
      console.warn(
        `[ResourceTable] 固定列缺少 width，已降级为普通列：${bad.map((c) => c.key).join(", ")}`
      )
    }
  }, [visibleColumns])

  const hasFilterArea = !!filters || !!scopeFilter
  const hasChips = activeFilters.length > 0
  const inlineToolbar = toolbarLayout === "inline"
  const showFilterToggle = filterToggle ?? !inlineToolbar
  const hasBatchActions = selectable && (batchActions?.length ?? 0) > 0
  /** 只有实际会落进操作行的节点才让它占位，避免仅开启选择等组合留下空灰条。 */
  const hasActionRow =
    (inlineToolbar && hasFilterArea) ||
    (inlineToolbar && hasChips && !!onClearFilters) ||
    (!inlineToolbar && hasFilterArea && showFilterToggle) ||
    !!toolbarLeft || !!toolbarRight || showColumnToggle || showRefresh || !!onExport ||
    hasBatchActions
  /**
   * 整个工具栏区域在不在。卡头据此决定画不画自己的分隔线 —— 灰带在，底色一换就是分隔，
   * 再画线就是隔两次。筛选行、chip 行、操作行任一存在都算。
   */
  const hasToolbarRow = hasFilterArea || (!inlineToolbar && hasChips) || hasActionRow
  // 作用域筛选 + 分隔线：叠放时进筛选行，单行时进操作行，都在最前
  const scopeNode = scopeFilter && (
    <>
      {scopeFilter}
      {filters && <span className="h-5 w-px shrink-0 bg-border" aria-hidden />}
    </>
  )
  const fill = height === "fill"

  // ── inline 排布下「操作区掉行了吗」（LF 2026-09-07）──────────────────────────
  // 没掉行：操作区贴在筛选项右边（ml-auto）。掉行：它独占一行，要摊开成「创建 / 批量
  // 靠左、图标钮靠右」—— 和三层叠放的操作行一个样。CSS 判断不了"我是不是掉行了"，
  // 只能量：筛选项占了几行、最后一项右缘到容器右缘还剩多少、操作区自然宽度是多少。
  // ResizeObserver 挂在这一行上；结果稳定（掉行 → w-full 仍掉行；不掉 → ml-auto 仍不掉），
  // 不会来回抖。
  const inlineRowRef = React.useRef<HTMLDivElement>(null)
  const inlineActionsRef = React.useRef<HTMLDivElement>(null)
  const [actionsWrapped, setActionsWrapped] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!inlineToolbar) return
    const row = inlineRowRef.current
    const act = inlineActionsRef.current
    if (!row || !act) return
    const GAP_X = 20 // 与 gap-x-5 一致
    const measure = () => {
      const rowRect = row.getBoundingClientRect()
      const items = Array.from(row.children).filter((el) => el !== act) as HTMLElement[]
      if (items.length === 0) { setActionsWrapped(false); return }
      const rects = items.map((el) => el.getBoundingClientRect())
      // 「掉行」= 某一项的顶边落到了第一项的**底边**之下。此前比的是顶边差 1px，而作用域
      // 筛选后面那条 h-5 分隔线在 items-center 下顶边天然比 32px 的控件低 6px —— 于是只要
      // 传了 scopeFilter，操作区就被误判成掉行、永远独占一行（LF 2026-09-09 截图）。
      const firstBottom = rects[0].bottom
      const multiRow = rects.some((r) => r.top >= firstBottom - 1)
      const lastRight = Math.max(...rects.map((r) => r.right))
      // 操作区的自然宽度 = 两组子块之和 + 组间 gap-2
      const groups = Array.from(act.children) as HTMLElement[]
      const need = groups.reduce((w, g) => w + g.getBoundingClientRect().width, 0) + 8 * Math.max(0, groups.length - 1)
      setActionsWrapped(multiRow || lastRight - rowRect.left + GAP_X + need > rowRect.width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [inlineToolbar, hasActionRow])
  const colSpan =
    visibleColumns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0) + (rowActions ? 1 : 0)

  // 加载态分两种，由组件自己判断，调用方只传一个 loading：
  //   首次（还没有数据）→ 骨架屏，保住布局，不让页面塌陷再撑开
  //   刷新/翻页（已有数据）→ 顶部细进度条，表格保持可见、不丢滚动位置
  const isInitialLoading = loading && data.length === 0

  // ── 「刷新中」是延迟 180ms 才生效的 ─────────────────────────────────────
  // 直接用 loading 的话，一次 80ms 的快刷新会让进度条和蒙灰**闪一下**——
  // 那种闪比没有反馈更烦。180ms 以内完成的刷新用户感知不到，就不该给反馈。
  const [loadingSettled, setLoadingSettled] = React.useState(false)
  React.useEffect(() => {
    if (!loading) {
      setLoadingSettled(false)
      return
    }
    const id = window.setTimeout(() => setLoadingSettled(true), 180)
    return () => window.clearTimeout(id)
  }, [loading])
  /** 已有数据 + 正在刷新（首次加载走骨架屏，不算这一档） */
  const refreshing = loadingSettled && data.length > 0

  /*
    「视图控制」组：收起筛选 / 列显隐 / 刷新 / 导出 / toolbarRight。
    抽成常量只是为了让上面那段工具栏 JSX 短一些，落点仍然只有一个 —— 工具栏的操作行。
  */
  const viewControls = (
    <>
            {hasFilterArea && showFilterToggle && (
              // 用 outline 而不是 ghost：它和右边那排图标钮是同一组「视图控制」，
              // 一个有框一个没框会让这排看着不齐
              <Button variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
                {filtersOpen ? t("resourceTable.filters.collapse") : t("resourceTable.filters.expand")}
              </Button>
            )}

            {showColumnToggle && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="icon" aria-label={t("resourceTable.columns.toggle")}>
                      <Columns3 className="h-4 w-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-44">
                  {/* GroupLabel 必须包在 Group 里 —— 它靠 Group 建立 aria-labelledby
                      关联，裸用会在打开菜单时抛错（表现为「点一下就报错」）。
                      这是 Base UI Menu 的结构要求，Radix 时代没有这条。 */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t("resourceTable.columns.label")}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  {columns.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={!hidden.has(c.key)}
                      disabled={c.hideable === false}
                      onCheckedChange={(v) => setColumnVisible(c.key, v)}
                    >
                      {typeof c.title === "string" ? c.title : c.key}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 刷新 + 自动刷新间隔。这段原本内建在这里，抽成 RefreshButton 后
                监控页等场景可以复用同一个 —— 抄一份过去就是两处各自演化的开始。 */}
            {showRefresh && (
              <RefreshButton
                onRefresh={onRefresh}
                loading={loading}
                intervals={refreshIntervals}
              />
            )}

            {/* 导出：组件只发起回调，创建任务 / 提示 / 跳转导出中心都在页面侧 ——
                本包不发网络请求，也不做导出能力探测。 */}
            {onExport && (
              <Button
                variant="outline"
                size="icon"
                aria-label={t("resourceTable.export")}
                disabled={exporting}
                onClick={() => {
                  void onExport()
                }}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}

            {toolbarRight}
    </>
  )

  return (
    <TooltipProvider>
      {/*
        **内容坐在一块板上时**（`data-surface="board"`）：工具栏脱出容器，
        只有表体保留描边圆角。

        默认是「工具栏 + 表体共处一个描边容器」；而板本身已经是容器了，再套一层
        就是框中框。所以整块去掉外框与底色，让工具栏直接摆在板上，由**表体自己**
        画那一圈描边。

        ── 为什么是 `data-surface` 而不是布局名 ──────────────────────────
        本包是通用设计系统，不认识消费方有哪些布局。`board` 说的是一个**外观事实**，
        由宿主在合适的时候打上 —— 宿主换布局名、加删布局，本包一行不用动。
        写成 `data-layout=<某个布局名>` 就是把消费方的布局清单焊进设计系统。
      */}
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-card",
          // 铺满：根容器撑满父级并成为竖向 flex 列；工具栏与分页 shrink-0、表体那层 flex-1 滚
          fill && "flex h-full min-h-0 flex-col",
          // ⚠️ **不要改 overflow** —— 这一层的 `overflow-hidden` 裁的是子级溢出
          // （表格横向滚动尤其依赖它），与"有没有框"无关。脱框时顺手改成 visible
          // 会让内容冲出板边。
          "[[data-surface=board]_&]:rounded-none",
          "[[data-surface=board]_&]:border-0",
          "[[data-surface=board]_&]:bg-transparent",
          className
        )}
      >
        {/* ══ 卡头 —— 标题 / 摘要 / 说明性插槽；画在工具栏之上，带贯穿分隔线 ══ */}
        {cardTitle != null && (
          /*
            ⚠️ **这一行与 `SectionCard` 的卡头逐字同款**（见 `section-card.tsx` 的 `<header>`）：
            同一页上表格和图表卡并排，卡头长得不一样就立刻看得出是两个东西 —— 间距 `gap-3`、
            内边距 `px-4 py-3`、标题 `h3 text-sm font-medium`、摘要降一档灰且可截断、
            `-my-1` 让行高由**文字**决定而不是由里面塞了什么控件决定。改这里时对着那个文件改。

            **下面紧跟着工具栏时不画分隔线**：工具栏自己是一条灰带（`bg-surface-toolbar`），
            底色一换就已经是分隔；再画一条线就是隔两次，线与灰带上沿挨在一起，读起来是
            「贴住了」（LF 2026-09-11）。同 `SectionCard` 的 `headerDivider` —— 那个口子存在
            的理由就是这个。工具栏整块都不存在时才画线，否则卡头会和表头糊在一起。
          */
          <header
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              !hasToolbarRow && "border-b border-border/60",
              fill && "shrink-0"
            )}
          >
            {titleIcon && <span className="shrink-0 text-muted-foreground">{titleIcon}</span>}
            <h3 className="shrink-0 text-sm font-medium text-foreground">{cardTitle}</h3>
            {titleSummary != null && (
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{titleSummary}</p>
            )}
            {titleActions != null && (
              <div className={cn("-my-1 flex items-center gap-2", titleSummary == null && "ml-auto")}>{titleActions}</div>
            )}
          </header>
        )}

        {/* ══ 筛选行（可收起，超出换行）—— inline 排布下筛选项进操作行，这里不画 ══ */}
        {hasFilterArea && !inlineToolbar && (
          <div
            // hidden 而非卸载：卸载会丢掉用户打了一半没提交的输入
            hidden={!filtersOpen}
            // 筛选行与下面的 chip 行、操作行**同属一个工具栏区块**，内部不画分隔线 ——
            // 三条并排的横线会把它切成「三条窄带」，看着碎。分组靠间距，
            // 只有工具栏与表格之间保留一条线。
            // 各筛选项之间固定 20px（gap-5）—— 用固定值而非 gap-x-8 那种"看着差不多"的档位，
            // 多行换行时上下两行的水平节奏才一致
            className={cn(
              "flex flex-wrap items-center gap-x-5 gap-y-3 bg-surface-toolbar px-4 pt-3.5 pb-3",
              fill && "shrink-0",
              // ⚠️ 板形态下**不要**再把这里的上内边距归零。宿主已经把页面容器的
              // `padding-top` 抹掉了（console globals.css「板形态 · 内容区顶部留白」），
              // 两边都归零 = 工具栏直接贴死顶栏，一点呼吸都没有。
              // 卡头在上面时同理：那一行已经把上沿的距离出了
              cardTitle != null && "pt-3",
              // 板上：工具栏不是"另一块表面"，就长在板上 —— 去底色、左右边距归零
              "[[data-surface=board]_&]:bg-transparent",
              "[[data-surface=board]_&]:px-0"
            )}
          >
            {scopeNode}
            {filters}
          </div>
        )}

        {/* ══ chip 行 —— 收起筛选后它仍在 ══ */}
        {/* 这是「收起筛选」能成立的前提：收起后筛选仍在生效，若不可见，用户过一会
            回来会困惑「列表怎么只有 3 条」。chip 常驻则始终看得见筛的是什么值。
            没有任何筛选时整行消失，不占位。 */}
        {hasChips && !inlineToolbar && (
          <div className={cn("flex flex-wrap items-center gap-2 bg-surface-toolbar px-4 pb-2.5", fill && "shrink-0")}>
            {activeFilters.map((f) => (
              <span
                key={f.key}
                // rounded-md 而不是裸 rounded：本仓的 borderRadius 没有 DEFAULT 档，
                // 裸 `rounded` 会掉回 Tailwind 内置的 0.25rem —— 那是个**不跟 token**
                // 的写死值，主题改圆角它不动。rounded-md = calc(var(--radius) - 2px)。
                className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs"
              >
                <span className="text-muted-foreground">{t("resourceTable.activeFilter.label", { label: f.label })}</span>
                <span className="text-foreground">{f.display}</span>
                {onRemoveFilter && (
                  <button
                    type="button"
                    aria-label={t("resourceTable.activeFilter.remove", { label: f.label })}
                    onClick={() => onRemoveFilter(f.key)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {/* 不用 link 变体：它的 hover 是下划线，与本仓「可点文本悬停用淡底色」
                的规范冲突（见 ValueText 的 HOVER_BASE）。ghost 正好是底色反馈。 */}
            {onClearFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-primary"
                onClick={onClearFilters}
              >
                {t("shared.clearAll")}
              </Button>
            )}
          </div>
        )}

        {/* ══ 操作行 ══ */}
        {/*
          上边距按「**上面此刻还有没有东西**」分两档，不是按「配没配筛选」分：

            有上文（筛选区展开 / 有 chip 行）→ `pt-1`，两块之间只要一点间隙
            没上文（都收起了）              → `pt-3.5`，自己承担卡片上沿的留白

          判据必须是 `filtersOpen` 而不是 `hasFilterArea`：筛选区靠 `hidden` 收起，
          收起后它 display:none、不占任何高度，但 `hasFilterArea`（= 配了筛选）仍为
          true —— 只看它的话，一收起工具栏就贴死在卡片上沿。

          `pt-3.5` 与筛选区展开时的上边距同值，两种状态下「卡片上沿到第一行控件」
          的距离才一致，收起/展开时视觉上不会跳。
        */}
        {hasActionRow && (
          <div
            ref={inlineRowRef}
            data-slot="resource-table-toolbar"
            className={cn(
              'flex flex-wrap items-center border-b border-border bg-surface-toolbar px-4 pb-3',
              fill && 'shrink-0',
              // inline：筛选项之间沿用筛选行的 20px 节奏；stacked：操作项之间 8px
              inlineToolbar ? 'gap-x-5 gap-y-3' : 'gap-2',
              // 同上，且**去掉底部那条线** —— 表体自己有框，两者之间靠间距分开
              '[[data-surface=board]_&]:border-b-0',
              '[[data-surface=board]_&]:bg-transparent',
              '[[data-surface=board]_&]:px-0',
              // 有卡头时工具栏不再承担卡片上沿的留白 —— 卡头已经出了那段距离，再留就空一大截
              // ⚠️ 板形态不在这里做例外，理由同筛选行上面那条。
              !inlineToolbar && ((hasFilterArea && filtersOpen) || hasChips) ? 'pt-1' : cardTitle != null ? 'pt-3' : 'pt-3.5'
            )}
          >
          {/* ══ inline 排布：作用域筛选 + 筛选项在这一行的最左 ══ */}
          {inlineToolbar && scopeNode}
          {inlineToolbar && filters}
          {inlineToolbar && hasChips && onClearFilters && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-primary" onClick={onClearFilters}>
              {t("shared.clearAll")}
            </Button>
          )}
          {/* 右侧操作区：创建 + 批量 + 图标钮。
              stacked 下这两层都是 display: contents，直接参与父级 flex（DOM 结构与此前等价）；
              inline 下合成**一个** `ml-auto` 块 —— 筛选项放不下换行时，这整块掉到最后一行仍靠右
              （LF 2026-09-07：两组分开各掉各的会左对齐、错开两行）。 */}
          <div
            ref={inlineActionsRef}
            className={cn(
              !inlineToolbar && 'contents',
              inlineToolbar && !actionsWrapped && 'ml-auto flex items-center gap-2',
              // 掉行：独占一行并摊开 —— 创建 / 批量靠左、图标钮靠右
              inlineToolbar && actionsWrapped && 'flex w-full items-center justify-between gap-2'
            )}
          >
          <div className={cn(inlineToolbar ? 'flex flex-wrap items-center gap-2' : 'contents')}>
          {toolbarLeft}

          {/* ══ 批量动作：常驻在创建按钮旁边 ══
              三个选择都是有意的：

              **常驻**而不是勾选后才出现 —— 出现/消失会让工具栏在勾第一行时整体跳一下，
              而且用户在勾之前根本不知道这张表支持哪些批量动作。常驻等于把能力摆明。

              **平铺**而不是收进一个「批量操作」按钮 + 浮层 —— 藏一层等于多两次点击，
              而且勾完行眼睛还在表格上，动作却跑进浮层，勾选和执行被拆成两个场景。

              **紧挨 toolbarLeft** 而不是另起一条操作条 —— 勾完就在同一行点，视线不用移。

              未选中时置灰，数量直接标在按钮上（不另摆「已选 N 项」——
              同一个数字在一屏里出现两次，用户会去想这俩是不是不同的东西）。 */}
          {selectable && batchActions && batchActions.length > 0 && (
            <>
              {/* 竖线把「新建」和「对选中项做什么」分开 —— 两者作用对象不同：
                  一个作用于列表，一个作用于选中项。挨着放但要看得出是两组。 */}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              {batchActions.map((a) => {
                // 逐项判定：算出这个动作实际会作用到几项，以及为什么跳过其余的
                const judged = selectedRows.map((r) => a.applicableTo?.(r) ?? true)
                const okRows = selectedRows.filter((_, i) => judged[i] === true)
                const skipped = selectedRows.length - okRows.length
                // 跳过原因取第一条非空的 —— 同一批里原因通常一样，列全反而吵
                const reason = judged.find((j) => typeof j === "string") as string | undefined
                const empty = selectedRows.length === 0
                const none = okRows.length === 0
                const btn = (
                  // 默认 size（h-8）：工具栏按钮与同一条线上的 Input / FilterSelect 同高同字号
                  // （PATTERNS §5 尺寸表：按钮 / 输入框 32px）。此前的 `sm` 是三层叠放时代
                  // 「操作行想轻一档」的例外，单行形态把两组放到一条基线上就露馅（LF 2026-09-06）
                  <Button
                    variant="outline"
                    disabled={none || running === a.key}
                    className={cn(a.danger && !none && "text-destructive")}
                    onClick={() =>
                      a.danger ? setConfirm({ action: a, rows: okRows }) : run(a, okRows)
                    }
                  >
                    {running === a.key ? <Loader2 className="animate-spin" /> : a.icon}
                    {a.label}
                    {/* 数量是这里唯一的选中反馈（跨页勾选时尤其要紧 —— 选中的行
                        分散在多页，主列表上数不出来）。标的是**实际会执行的项数**，
                        所以有跳过时它会小于选中数，正好把差异摆出来。 */}
                    {!none && (
                      <Badge variant="secondary" className="ml-1">
                        {okRows.length}
                      </Badge>
                    )}
                  </Button>
                )
                // 置灰或有跳过都必须给原因 —— 否则用户不知道为什么点不动 / 为什么只做了一半。
                // trigger 套 span：disabled 的按钮不派发指针事件，直接挂 tooltip 会弹出来不消失
                if (!none && skipped === 0) return <React.Fragment key={a.key}>{btn}</React.Fragment>
                return (
                  <Tooltip key={a.key}>
                    <TooltipTrigger
                      render={<span className={cn("inline-flex", none && "cursor-not-allowed")} />}
                    >
                      {btn}
                    </TooltipTrigger>
                    <TooltipContent>
                      {empty
                        ? t("resourceTable.batch.selectFirst")
                        : none
                          ? t("resourceTable.batch.noneApplicable", { n: selectedRows.length }) + (reason ? t("resourceTable.batch.reason", { reason }) : "")
                          : t("resourceTable.batch.willSkip", { n: skipped }) + (reason ? t("resourceTable.batch.reason", { reason }) : "")}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </>
          )}

          </div>
          <div className={cn('flex items-center gap-2', !inlineToolbar && 'ml-auto')}>
            {viewControls}
          </div>
          </div>
          </div>
        )}

        {/* ══ 刷新进度条（已有数据时的加载态）══ */}
        <div className="relative h-0">
          {refreshing && (
            <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/20">
              <div className="h-full w-1/3 animate-loading-slide bg-primary" />
            </div>
          )}
        </div>

        {/* ══ 表格 ══ */}
        {/* 刷新期间禁掉表格交互，但**不加遮罩层**：
              - 遮罩会挡住内容 —— 刷新时用户往往还在读当前数据
              - 快刷新下遮罩一闪而过，比没反馈更烦（所以还叠了 180ms 延迟）
            改为 `pointer-events-none` + 降透明度：看得见、点不动。
            关键是这两个类加在 `<table>` 上而不是外层滚动容器上 ——
            加在容器上会连滚动一起禁掉，长表格刷新时就动不了了。
            `aria-busy` 让读屏知道这块内容正在更新。 */}
        {/* `isolate` 不能省：固定列用 `position: sticky` + `z-index: 2`，
            没有它这些 z-index 会参与**根层叠上下文**的比较，和 Portal 出去的浮层
            （下拉菜单 z-50）撞在一起 —— 表现为「打开行操作菜单时，后面几列的内容
            压在菜单上面透出来」。isolate 建一个新的层叠上下文，把 2 关在里面，
            之后不管浮层用多少 z-index 都稳赢。 */}
        <div className={cn("isolate", fill && "flex min-h-0 flex-1 flex-col")}>
          {/* ── table-layout: fixed + colgroup ────────────────────────────
              固定列的粘性偏移是按**声明宽度**累加算出来的（左固定列的 left =
              它前面各列宽度之和）。而默认的 `table-layout: auto` 下，width 只是
              个建议值 —— 浏览器按内容实际排版，内容宽的列会被撑开。
              一旦实际宽度 > 声明宽度，算出来的偏移就偏小，固定列会钉进前一列
              内部：既盖住前一列的尾巴，滚动时又像在往左漂。

              所以宽度必须是**权威的**：colgroup 声明 + fixed 布局，浏览器严格照办。
              代价是没声明宽度的列拿兜底值，而不是按内容自适应。

              ── 富余宽度只进数据列 ──────────────────────────────────────────
              表格是 w-full（容器多宽它多宽）。若每列都写显式 width，容器宽于声明
              总宽时，fixed 布局会把富余按比例摊进每一列 —— 勾选列 50 → ~95、
              操作列 132 → ~250，内容左锚、右侧大片空白。所以 colgroup 里数据列只在
              声明了 width 时才写死；没声明的列不写，让浏览器把富余分给它。
              容器比 minWidth 还窄时：表格压到 minWidth 出横向滚动，此时未声明列
              在 colgroup 没有宽可拿，fixed 布局按 DEFAULT_COL_WIDTH=140 均分余量
              （widthOf 的兜底只在这条路径上生效）。minWidth 本身只给未声明列计
              MIN_AUTO_COL_WIDTH=80 的可读下限，不再按 140 满额累计 —— 否则列数
              稍多就被虚构下限顶出滚动条（见 tableMinWidth 注释）。 */}
          <Table
            containerRef={scrollRef}
            // group/scroll：固定列的边界阴影靠 group-data-[scroll-l|r] 取这里的状态
            containerClassName={cn(
              "group/scroll",
              // 铺满：表体是唯一的滚动层（横竖都在这里滚）。**只收缩不撑开**（min-h-0 + shrink，
              // 不给 flex-1）：行少时表体只占内容高度，横向滚动条、固定列分隔线、板上的描边框
              // 都贴着最后一行，多出来的是空白，分页照样钉底（LF 2026-09-07 对照老 console）。
              // 给 flex-1 的话行少时这些都被拉到底，一条数据下面拖着整屏的框。
              fill && "min-h-0 shrink overflow-auto",
              // 外层容器脱框之后，**由表体自己画那一圈** —— 目标形态是
              // 「裸工具栏 + 描边表格」，不是「什么框都没有」。
              //
              // 不加上外边距：工具栏最后一行本来就带 `pb-3`，再补一段就成了两倍间距。
              // （初版加了 `mt-3`，实测下来工具栏与表格离得太开，LF 反馈）
              //
              // ⚠️ **这里不能加 `overflow-hidden`**（初版加了，为的是裁圆角）—— 它盖掉
              // `Table` 基类的 `overflow-x-auto`，宽表从此横向滚不动（LF 2026-09-06 抓到）。
              // 圆角裁剪不需要它：`overflow-x-auto` 已让另一轴按 auto 计算，圆角照样裁。
              "[[data-surface=board]_&]:rounded-lg",
              "[[data-surface=board]_&]:border",
              "[[data-surface=board]_&]:border-border",
              "[[data-surface=board]_&]:bg-card",
              // 最后一行不画分隔线 —— `TableRow` 恒带 `border-b`，默认布局下它被外层
              // 容器的圆角裁掉了看不见；极简下表体自己描边，那条线就贴在容器下边框
              // 上方露出来，看着像"多了一条"（LF 截图抓到）。
              "[[data-surface=board]_&]:[&_tbody_tr:last-child]:border-b-0",
              // ⚠️ **固定列那条要单独抹**：`STICKY_CELL` 给每个粘性单元格自带了一条
              // `border-b`（它的背景会盖掉 <tr> 的折叠边框，不补的话横向滚动时固定列
              // 那一段没有分隔线）。只抹 tr 的话，最后一行会在**左右两端的固定列**各
              // 留下一小截线，中间却没有 —— 比整条线还显眼（LF 2026-09-18 截图抓到）。
              "[[data-surface=board]_&]:[&_tbody_tr:last-child>td]:border-b-0",
              SCROLLBAR
            )}
            aria-busy={refreshing || undefined}
            style={{ tableLayout: "fixed", minWidth: sp(tableMinWidth) }}
            className={cn(refreshing && "pointer-events-none cursor-wait opacity-60")}
          >
            <colgroup>
              {selectable && <col style={{ width: sp(SELECT_COL_WIDTH) }} />}
              {expandable && <col style={{ width: sp(EXPAND_COL_WIDTH) }} />}
              {visibleColumns.map((c) => (
                <col key={c.key} style={c.width ? { width: sp(c.width) } : undefined} />
              ))}
              {rowActions && <col style={{ width: sp(actionsColWidth) }} />}
            </colgroup>
            {/* 铺满时表头吸在滚动层顶部。z-3 压过固定列的 z-2（同一个 isolate 上下文里），
                竖着滚时表头盖住固定列单元格而不是被它顶穿；表头行自带 bg-card 不透明。 */}
            <TableHeader className={cn(fill && "sticky top-0 z-3")}>
              {/* 表头行同样要不透明背景 —— 固定表头单元格也靠 bg-inherit */}
              <TableRow className="bg-card hover:bg-card">
                {selectable && (
                  <TableHead
                    style={{ width: sp(SELECT_COL_WIDTH), position: "sticky", left: 0, zIndex: 2 }}
                    className={cn(
                      STICKY_CELL,
                      // 左粘性区的边界阴影只画在**最后一个**粘性元素上。
                      // 优先级：左固定列 > 展开列 > 勾选列 —— 谁在最右谁画。
                      !hasLeftFixed && !expandable && STICKY_EDGE_LEFT
                    )}
                  >
                    <Checkbox
                      checked={pageAllSelected}
                      indeterminate={!pageAllSelected && pageSomeSelected}
                      disabled={selectablePageRows.length === 0}
                      onCheckedChange={(v) => toggleAllOnPage(v === true)}
                      aria-label={t("resourceTable.selectPage")}
                    />
                  </TableHead>
                )}
                {expandable && (
                  <TableHead
                    style={{
                      width: sp(EXPAND_COL_WIDTH),
                      position: "sticky",
                      left: sp(selectable ? SELECT_COL_WIDTH : 0),
                      zIndex: 2,
                    }}
                    className={cn(STICKY_CELL, !hasLeftFixed && STICKY_EDGE_LEFT)}
                  >
                    {/*
                      **空着，没有「全部展开」总开关**（LF 2026-09-09 实看否掉）。
                      展开是**逐行**的动作：读者要看的是某一行的内情，一次把整页摊开
                      得到的是一屏没人读的面板 + 一个要再点一次收回去的烂摊子。
                      而那个箭头摆在表头上还有第二重坏处 —— 它和下面每一行的箭头长得
                      一模一样、位置在同一列，读起来像「第一行」而不是「所有行」。
                    */}
                  </TableHead>
                )}
                {visibleColumns.map((c) => {
                  const sKey = c.sortKey ?? c.key
                  const active = sort?.key === sKey
                  const st = sticky.get(c.key)
                  return (
                    <TableHead
                      key={c.key}
                      style={{ ...(c.width ? { width: sp(c.width) } : null), ...st?.style }}
                      // aria-sort 是表格排序的无障碍契约，读屏靠它播报当前排序方向
                      aria-sort={active ? (sort!.order === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        st && STICKY_CELL,
                        st?.edge === "left" && STICKY_EDGE_LEFT,
                        st?.edge === "right" && STICKY_EDGE_RIGHT
                      )}
                    >
                      {c.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c)}
                          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                        >
                          {c.title}
                          {/* 未排序：↑↓（LF 2026-09-09 定），与激活态的单箭头同一族，不再用 ⌃⌄ */}
                          {!active && <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                          {active && sort!.order === "asc" && <ArrowUp className="h-3.5 w-3.5" />}
                          {active && sort!.order === "desc" && <ArrowDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        c.title
                      )}
                    </TableHead>
                  )
                })}
                {rowActions && (
                  <TableHead
                    style={{
                      width: sp(actionsColWidth),
                      ...(actionsFixed === "right"
                        ? { position: "sticky", right: 0, zIndex: 2 }
                        : null),
                    }}
                    className={cn(
                      actionsAlign === "right" && "text-right",
                      actionsAlign === "center" && "text-center",
                      actionsFixed === "right" && cn(STICKY_CELL, STICKY_EDGE_RIGHT)
                    )}
                  >
                    {t("resourceTable.actions")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>

            <TableBody>
              {/* 首次加载：骨架屏。用真实列数撑出骨架，布局不跳 */}
              {isInitialLoading &&
                Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: colSpan }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {/* 三种「没内容」的处境完全不同，文案与行动号召也不同 */}
              {!isInitialLoading && error && (
                <TableRow>
                  <TableCell colSpan={colSpan} className={cn("px-0", emptySize === "compact" ? "py-6" : "py-14")}>
                    {/*
                      `sticky left-0` + 可视宽度：这个 td 的宽度是**整张表**的宽度
                      （列多时远宽于可视区），里面 text-center 是在那个宽度里居中的，
                      于是空态图标与按钮偏到滚动内容的中间、视觉上不居中（LF 2026-09-18）。
                      与行展开面板同一套解法，`viewWidth` 也是同一个 ResizeObserver 量的。
                    */}
                    <div className="sticky left-0" style={{ width: viewWidth ? `${viewWidth}px` : "100%" }}>
                    <Empty className={emptySize === "compact" ? "gap-3 p-0 md:p-0" : undefined}>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <TriangleAlert className="text-destructive" />
                        </EmptyMedia>
                        <EmptyTitle>{t("shared.loadFailed")}</EmptyTitle>
                        <EmptyDescription>
                          {typeof error === "string" ? error : error.message}
                        </EmptyDescription>
                      </EmptyHeader>
                      {onRetry && (
                        <EmptyContent>
                          <Button onClick={onRetry}>{t("shared.retry")}</Button>
                        </EmptyContent>
                      )}
                    </Empty>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!isInitialLoading && !error && pageRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} className={cn("px-0", emptySize === "compact" ? "py-6" : "py-14")}>
                    {/* 同上：不包一层 sticky 的话，空态会按整张表的宽度居中（理由见上一处） */}
                    <div className="sticky left-0" style={{ width: viewWidth ? `${viewWidth}px` : "100%" }}>
                    {hasChips ? (
                      // 有筛选 → 是「筛没了」，该给「清除筛选」而不是「去创建」
                      <Empty className={emptySize === "compact" ? "gap-3 p-0 md:p-0" : undefined}>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <SearchX />
                          </EmptyMedia>
                          <EmptyTitle>{t("resourceTable.noMatch.title")}</EmptyTitle>
                          <EmptyDescription>{t("resourceTable.noMatch.description")}</EmptyDescription>
                        </EmptyHeader>
                        {onClearFilters && (
                          <EmptyContent>
                            <Button variant="outline" onClick={onClearFilters}>
                              {t("resourceTable.noMatch.clear")}
                            </Button>
                          </EmptyContent>
                        )}
                      </Empty>
                    ) : (
                      <Empty className={emptySize === "compact" ? "gap-3 p-0 md:p-0" : undefined}>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Inbox />
                          </EmptyMedia>
                          <EmptyTitle>{emptyTitleText}</EmptyTitle>
                          {emptyDescription && (
                            <EmptyDescription>{emptyDescription}</EmptyDescription>
                          )}
                        </EmptyHeader>
                        {emptyAction && <EmptyContent>{emptyAction}</EmptyContent>}
                      </Empty>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!isInitialLoading &&
                !error &&
                pageRows.map((row, i) => {
                  const k = keyOf(row)
                  const isSel = selected.has(k)
                  const canExpand = expandable && expandable.rowExpandable?.(row) !== false
                  const isOpen = expandedSet.has(k)
                  const actions =
                    typeof rowActions === "function" ? rowActions(row) : rowActions
                  const canActivateRow = isRowActivationEnabled(
                    row,
                    onRowClick,
                    isRowActivatable
                  )
                  return (
                    <React.Fragment key={k}>
                    <TableRow
                      data-selected={isSel || undefined}
                      data-expanded={isOpen || undefined}
                      onClick={
                        canActivateRow && onRowClick
                          ? (event) => {
                              if (shouldActivateRowFromPointer(event.target, event.currentTarget)) {
                                onRowClick(row)
                              }
                            }
                          : undefined
                      }
                      onKeyDown={
                        canActivateRow && onRowClick
                          ? (event) => activateRowFromKeyboard(event, row, onRowClick)
                          : undefined
                      }
                      tabIndex={canActivateRow ? 0 : undefined}
                      aria-keyshortcuts={canActivateRow ? "Enter Space" : undefined}
                      className={cn(
                        "group/row",
                        ROW_BG,
                        canActivateRow &&
                          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      )}
                    >
                      {selectable && (
                        <TableCell
                          style={{ position: "sticky", left: 0, zIndex: 2 }}
                          className={cn(
                            STICKY_CELL,
                            !hasLeftFixed && !expandable && STICKY_EDGE_LEFT
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSel}
                            disabled={isRowSelectable?.(row) === false}
                            onCheckedChange={(v) => handleRowCheck(row, i, v === true, false)}
                            // Shift 范围选择：长列表里选连续一段的高频操作。
                            // 挂在 click 上而不是 onCheckedChange —— 后者拿不到修饰键。
                            onClick={(e: React.MouseEvent) => {
                              if (e.shiftKey) {
                                e.preventDefault()
                                handleRowCheck(row, i, !isSel, true)
                              }
                            }}
                            aria-label={t("resourceTable.selectRow", { key: k })}
                          />
                        </TableCell>
                      )}
                      {expandable && (
                        <TableCell
                          style={{
                            position: "sticky",
                            left: sp(selectable ? SELECT_COL_WIDTH : 0),
                            zIndex: 2,
                          }}
                          className={cn(STICKY_CELL, !hasLeftFixed && STICKY_EDGE_LEFT)}
                          // 展开是行内控件，不该触发 onRowClick（跳详情）
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canExpand && (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? t("resourceTable.row.collapse", { key: k }) : t("resourceTable.row.expand", { key: k })}
                              className={EXPAND_BTN}
                              onClick={() => toggleExpand(k)}
                            >
                              <ChevronRight
                                strokeWidth={2.5}
                                className={cn(EXPAND_ICON, isOpen && "rotate-90")}
                              />
                            </button>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.map((c) => {
                        const st = sticky.get(c.key)
                        return (
                          <TableCell
                            key={c.key}
                            style={st?.style}
                            className={cn(
                              c.align === "right" && "text-right",
                              c.align === "center" && "text-center",
                              st && STICKY_CELL,
                              st?.edge === "left" && STICKY_EDGE_LEFT,
                              st?.edge === "right" && STICKY_EDGE_RIGHT
                            )}
                          >
                            {/*
                              居中把这一层做成 flex 容器，**不是**给直接子元素 mx-auto：
                              后者只对块级子元素有效，页面多包一层 <span>（比如挂 title 放
                              故障原因）就静默失效——inline 元素不吃 mx-auto / w-fit，里面的
                              StatusIndicator（根节点是 flex）照样撑满、内容靠左。
                              `text-center` 也救不了：它只管行内内容，管不到块级 flex 盒子。
                              （LF 2026-09-09 定状态 / 标记列居中；2026-09-15 修包一层就失效）
                            */}
                            <div
                              className={cn(CELL_INNER, c.align === "center" && "flex justify-center [&>*]:min-w-0")}
                              onMouseEnter={overflowTitle}
                            >
                              {c.render ? c.render(row, i) : (row[c.key] as React.ReactNode)}
                            </div>
                          </TableCell>
                        )
                      })}
                      {rowActions && (
                        <TableCell
                          style={
                            actionsFixed === "right"
                              ? { position: "sticky", right: 0, zIndex: 2 }
                              : undefined
                          }
                          className={cn(
                            actionsFixed === "right" && cn(STICKY_CELL, STICKY_EDGE_RIGHT)
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowActionCell row={row} actions={actions ?? []} align={actionsAlign} />
                        </TableCell>
                      )}
                    </TableRow>

                    {/* ══ 展开面板 ══
                        用条件渲染而不是 CSS 隐藏：面板里常是指标图 / 表格，
                        藏着不卸载会持续占内存、图表还会继续跑动画和 resize 监听。
                        与 SectionCard 的折叠同一条取舍。 */}
                    {expandable && isOpen && canExpand && (
                      <TableRow
                        data-expanded=""
                        // hover 不跟随：面板不是"一行数据"，鼠标扫过去不该亮
                        className={cn(ROW_BG, "hover:bg-inherit")}
                      >
                        <TableCell colSpan={colSpan} className="p-0">
                          {/*
                            `sticky left-0` + 显式宽度 = 面板贴住**可视区左沿**、
                            始终占满看得见的宽度。横向滚动时上面各列在动，面板原地不动。
                            不这么做的话它会按整张表的宽度（可能 1800px）排版，
                            右半边在视口外，读个属性还要横向滚 —— 那是 bug 不是体验问题。

                            宽度兜底成 100%：ResizeObserver 首帧还没量到时不至于塌成 0。
                          */}
                          <div
                            className="sticky left-0"
                            style={{ width: viewWidth ? `${viewWidth}px` : "100%" }}
                          >
                            {/*
                              ── 面板不加任何装饰（LF 2026-09-15 定）────────────────────
                              历经三版：`bg-muted` 灰底 → 左竖线 `border-l-2 border-primary/30`
                              → 现在什么都不加。理由是面板里装的通常是一张**从属表**，它该读成
                              上一行的延续，而不是「一块别的东西」：底色、竖线、左内边距都在
                              反着说，还把子表往右推、与外表的列对不齐。

                                · **四边都不留内边距**：子表用的是同一个 `Table`，单元格自带
                                  px-2 与行高，零内边距下它的行就是外表行的延续 —— 逐列对齐、
                                  行距一致（配额管理那页即按此对齐）。上下留白会把这一组切成
                                  「一行 + 一块附属物」，正是要避免的读法。
                                · 上下都不画线：行自己的下边框已经在那儿，再加就是粗缝。

                              ── 底色：两个 token 拼出**两边都是 2.2%** 的一跳（LF 2026-09-15）──
                              曾经用过 `muted`，被判太重（浅色下离 card 3.0%，在白表格中间
                              横出一条明显的色带）。目标是那一跳的四成左右：看得出「这一段是一组」，
                              又不抢行里的字。

                              但**没有哪个单 token 在两种模式下都给得出这个量**（实测与 card 的差）：

                                surface-section   浅 2.2%  暗 0.1%  ← 暗色下等于没有底色
                                surface-toolbar   浅 1.2%  暗 2.2%
                                muted             浅 3.0%  暗 6.4%
                                surface-page      浅 3.3%  暗 3.5%

                              所以浅色取 section、暗色取 toolbar —— 两边都落在 2.2%，
                              **视觉上是同一跳**。这不是拿 hex 绕 token，是这把尺子在暗色端缺一档
                              （PATTERNS §「层次」对 surface-section 的暗色警告说的就是这件事）。
                              要调深浅别改透明度，在这四个里换。

                              ⚠️ **面板里的卡片要自带描边**：白卡片在这层底色上浮不出来；
                              非表格内容（属性行这类）自己给内边距。
                              **页面不要自己画外壳**（底色 / 边框 / 竖线一律由这里给）。
                            */}
                            <div className="bg-surface-section dark:bg-surface-toolbar">
                              {expandable.render(row)}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </React.Fragment>
                  )
                })}
            </TableBody>
          </Table>
        </div>

        {/* ══ 分页 ══ */}
        {pagination && total > 0 && (
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3',
              // 铺满：分页钉在底部（根容器是 flex 列，它是最后一个 shrink-0 子项）
              fill && 'shrink-0',
              // 板上没有分隔线，与表体的距离靠留白：上方固定 20px（LF 2026-09-07），
              // 下方不留 —— 页面的 p-4 已经出了底部那一段
              '[[data-surface=board]_&]:pt-5',
              '[[data-surface=board]_&]:pb-0',
              // 板上：表体自己已经描了一圈框，这条 border-t 就成了**框外孤立的一道线**
              // （LF 截图抓到）。默认档下它是容器内的分隔线，那时是对的。
              // 左右内边距一并归零 —— 分页此时和工具栏一样直接摆在板上。
              '[[data-surface=board]_&]:border-t-0',
              '[[data-surface=board]_&]:px-0'
            )}
          >
            {/* 左：**数据的规模**（一共多少、怎么分块、选了几个）
                右：**导航**（翻到第几页）

                每页条数原来贴在翻页器左边 —— 一个带边框的方块紧挨着无边框的页码，
                读起来像翻页器的一部分，但它其实回答的是「怎么分块」不是「翻到哪」。
                挪到左边与「共 N 条」同组之后，中间那片空白也被填上了。 */}
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{t("resourceTable.pagination.total", { n: total })}</span>
              {/* 分页和每页条数在刷新期间也要禁 —— 它们在表格外面，pointer-events-none
                  管不到。放着不禁的话连点翻页会发出多个请求，回来顺序不定，
                  表格可能显示的是**上一页**的数据（竞态）。 */}
              <DataSelect
                  // min-w-[120px] 是 DataSelect 的默认下限，这里覆写掉：
                  // 「10 条/页」只有五个字符，120px 会让它左边空一大块
                  className="!min-w-0 h-8 w-[104px]"
                  options={pageSizeOptions.map((s) => ({ value: String(s), label: t("resourceTable.pagination.pageSize", { n: s }) }))}
                  value={String(pageSize)}
                  disabled={refreshing}
                  onValueChange={(v) => setSize(Number(v))}
                />
              {/* 这里不再重复选中状态：选中数量已经标在工具栏的批量动作按钮上。
                  同一个数字在一屏里出现两处，用户会去想"这俩是不是不同的东西"。 */}
            </div>
            <Pager
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={refreshing}
              onChange={setPage}
            />
          </div>
        )}
      </div>

      {/* 危险动作的确认：列出全部将要操作的对象。
          这是原来那个预览抽屉唯一不可替代的部分 —— 跨页勾选之后，
          「我到底选了哪些」在主列表上已经核对不了了（选中的行分散在多页）。 */}
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t("resourceTable.batch.confirmTitle", { action: confirm.action.label, n: confirm.rows.length })}
          description={t("resourceTable.batch.confirmDescription")}
          action={confirm.action.label}
          tone="destructive"
          items={confirm.rows.map((r) => keyOf(r))}
          // 批量动作的闸门由动作声明决定（requireTypeConfirm），不由组件默认值决定 —— 4.1
          confirm={!!confirm.action.requireTypeConfirm}
          loading={running === confirm.action.key}
          onConfirm={async () => {
            const { action, rows } = confirm
            setConfirm(null)
            await run(action, rows)
          }}
        />
      )}
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 行操作单元格
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 展示规则：
 *
 *   ≤ 2 个  →  全部内联平铺
 *   > 2 个  →  第一个内联（通常是最高频的「详情」），其余收进 ⋯
 *
 * 为什么不全折进 ⋯：最高频那个动作值得省一次点击。
 * 为什么不全平铺：动作一多，操作列会把表格挤窄，而且各行动作数不一时列宽会跳。
 *
 * 内联按钮用 link 形态而不是 outline —— 一行里并排两三个带框按钮，视觉重量
 * 会盖过数据本身；这一列是次要动作区，不该抢戏。
 */
function RowActionCell<T>({
  row,
  actions,
  align = "left",
}: {
  row: T
  actions: RowAction<T>[]
  align?: "left" | "center" | "right"
}) {
  const t = useUiT()
  // 置灰理由的 sr-only 文本要有唯一 id。放在提前 return 之前 —— hooks 不能在
  // 条件之后调用。本组件按行渲染，所以每行天然拿到不同前缀。
  const reasonUid = React.useId().replace(/:/g, "")

  if (actions.length === 0) return null

  const inline = actions.length <= 2 ? actions : actions.slice(0, 1)
  const folded = actions.length <= 2 ? [] : actions.slice(1)

  const renderInline = (a: RowAction<T>) => {
    const d = a.disabled?.(row)
    const btn = (
      <Button
        key={a.key}
        // ghost 而非 link：link 的 hover 是下划线，本仓规范是淡底色
        variant="ghost"
        size="sm"
        disabled={!!d}
        className={cn(
          // 行操作走「辅助」档 xs（12px）+ 字重 500（LF 2026-09-09 定）：比一行 14px 的数据小一号，
          // 字重与 Button 基类一致。
          "h-7 px-1.5 text-xs font-medium",
          // 悬停只让颜色**变浅一点**，不变黑、不铺底（LF 2026-09-09 对着 console-ui 老版定）：
          // ghost 基类的「灰底 + 正文色」在一列全是同一个词的操作列里太重，而且默认主题下
          // 主色本就近黑，「变黑」等于没反馈。压 tailwind-merge 同组覆盖 ghost 的 hover。
          "enabled:hover:bg-transparent",
          a.danger
            ? "text-destructive enabled:hover:text-destructive/70"
            : "text-primary enabled:hover:text-primary/70"
        )}
        onClick={() => a.onClick(row)}
      >
        {a.icon}
        {a.label}
      </Button>
    )
    // 置灰必须给原因 —— 不给的话用户不知道为什么点不动
    if (typeof d !== "string") return btn
    return (
      <Tooltip key={a.key}>
        {/* disabled 的按钮不触发鼠标事件，得套一层能接事件的元素，否则 tooltip 永不出现 */}
        <TooltipTrigger render={<span className="inline-flex cursor-not-allowed">{btn}</span>} />
        <TooltipContent>{d}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      // `data-slot` 供列宽测量按它取节点（见 useActionsWidth）；`whitespace-nowrap`
      // 保证量到的是**自然宽度**而不是被列宽逼出来的换行后宽度
      data-slot="row-actions"
      className={cn(
        "flex w-max items-center gap-0.5 whitespace-nowrap",
        align === "left" && "justify-start",
        align === "center" && "justify-center",
        align === "right" && "ml-auto justify-end"
      )}
    >
      {inline.map(renderInline)}
      {folded.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t("shared.moreActions")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-36">
            {folded.map((a) => {
              const d = a.disabled?.(row)
              const reason = typeof d === "string" && d ? d : undefined
              const reasonId = `${reasonUid}-${a.key}-reason`
              return (
                // 禁用原因**不占一行**：菜单项本来是一行一个动作，多出来的小字会把整个
                // 菜单撑高、也让"能点的"和"不能点的"看起来不是同一类东西。置灰本身已经
                // 说明"现在不能做"，原因走 `title`，悬停可见 —— 这是规范里「置灰必须给
                // 原因」在**菜单内**的落法（菜单项里挂 Tooltip 会和菜单自己的浮层打架，
                // 所以用原生 title）。
                //
                // title 必须挂在**外层 span**：项一旦 disabled 就带
                // data-disabled:pointer-events-none，挂在它自己身上收不到 hover，理由永远
                // 弹不出来；pointer-events 只作用在项本身，外面这层照常接事件。
                // role="none" 是必需的 —— menu 与 menuitem 之间插了一层普通元素，读屏就
                // 数不清「第几项／共几项」。
                <span
                  key={a.key}
                  role="none"
                  title={reason}
                  className={cn("block", d && "cursor-not-allowed")}
                >
                  <DropdownMenuItem
                    disabled={!!d}
                    variant={a.danger ? "destructive" : undefined}
                    // 折进 ⋯ 的动作与平铺的同一档：12px、字重 500（LF 2026-09-09）。
                    // 悬停 / 键盘高亮时文字染主色（console-ui 老版的手感，LF 2026-09-09 指出）：
                    // 默认中性主题下它就是近黑，与底色一起表达「这一项被选中了」；
                    // 彩色主题下变成主色，与侧栏 / 顶栏的选中态同一套。危险项仍保持红。
                    // 行高与左右留白放到 py-1.5 px-2.5 —— 上游的 py-1 px-1.5 是给带图标的
                    // 紧凑菜单定的，纯文字动作项一行 24px 太挤，指针容易滑到相邻项。
                    // 文字直接当子节点、不套 span：基类 `focus:**:text-accent-foreground` 会把
                    // 所有后代元素压回 accent 色，文本节点不受它管。
                    className="px-2.5 py-1.5 text-xs font-medium whitespace-nowrap not-data-[variant=destructive]:focus:text-primary"
                    // title 只服务鼠标：外层 span 带 role="none"，已从无障碍树摘掉，
                    // 它的 title 不会被朗读。读屏那一半靠 aria-describedby 指到下面的
                    // sr-only 文本 —— 否则「置灰必须给原因」只对鼠标用户成立
                    //（freeland#166）。
                    aria-describedby={reason ? reasonId : undefined}
                    onClick={() => a.onClick(row)}
                  >
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                  {/* role="none" 只摘掉它自己，后代仍在无障碍树里，所以引用得到。 */}
                  {reason && (
                    <span id={reasonId} className="sr-only">
                      {reason}
                    </span>
                  )}
                </span>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 分页器 —— 基于 shadcn Pagination
// ─────────────────────────────────────────────────────────────────────────────

function Pager({
  page,
  pageSize,
  total,
  disabled,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  onChange: (p: number) => void
}) {
  const t = useUiT()
  const last = Math.max(1, Math.ceil(total / pageSize))
  // 页码窗口：首页、末页、当前页 ±1，中间用省略号。
  // 不做「输入页码跳转」—— 13 页的列表用不上，几百页的列表说明该用筛选而不是翻页。
  const nums = React.useMemo(() => {
    const out: (number | "…")[] = []
    const push = (n: number) => out.push(n)
    const window = new Set([1, last, page - 1, page, page + 1].filter((n) => n >= 1 && n <= last))
    let prev = 0
    for (const n of [...window].sort((a, b) => a - b)) {
      if (prev && n - prev > 1) out.push("…")
      push(n)
      prev = n
    }
    return out
  }, [page, last])

  return (
    <Pagination className={cn("mx-0 w-auto", disabled && "pointer-events-none opacity-50")}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            // 官方默认是 "Previous" —— 在调用处传入 ui 词表的文案，不改 ui/pagination.tsx
            // 的默认值（与 shadcn 官方逐字节一致，shadcn-diff 在盯）。
            text={t("shared.prevPage")}
            aria-disabled={disabled || page <= 1}
            className={cn((disabled || page <= 1) && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault()
              onChange(page - 1)
            }}
          />
        </PaginationItem>
        {nums.map((n, i) =>
          n === "…" ? (
            <PaginationItem key={`e-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={n}>
              <PaginationLink
                isActive={n === page}
                onClick={(e) => {
                  e.preventDefault()
                  onChange(n)
                }}
              >
                {n}
              </PaginationLink>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            text={t("shared.nextPage")}
            aria-disabled={disabled || page >= last}
            className={cn((disabled || page >= last) && "pointer-events-none opacity-50")}
            onClick={(e) => {
              e.preventDefault()
              onChange(page + 1)
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
