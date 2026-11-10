"use client"

// FloatingField —— label 浮在控件框内的表单字段（floating label）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 2026-09-03 团队定案：**这是表单字段的最终形态**，`FloatingField` 就是**最终名** ——
// 不会再改名去接管 `Field`。现行的 `Field`（label 在控件外面上方，shadcn 生成件）
// 进入冻结：只修严重缺陷、不加能力，新页面一律用本文件这一族。
//
// **两者彻底无关**：本文件不 import `Field` 一族的任何东西，`Field` 也不知道本文件
// 存在。这是**新老组件交替**，不是「改名替换」—— 旧的迁完之后可删可留（它是生成件，
// 留着零成本），无论怎么处置都不牵动本文件一行代码。
//
// 这样安排省掉了一整步：不必等迁移完成后再做第二次全仓重命名，也不会因为
// 「契约只增不减」而留下一个永久的 ADD-ONLY 别名。插件迁移时写的就是最终名。
//
// 血缘：**自研**。内部用的是 shadcn 的 `Input` / `Label` / `Textarea`，但浮动判据、
// context 上报、三档排布、placeholder 时机全是本仓写的 —— 按「行为逻辑归谁」的判据
// （freeland#21 第二节）不算组合。上游没有 floating label 形态的字段。
//
// ── label 是**浮动**的 ────────────────────────────────────────────────────
//
//   空 + 未聚焦     label 落在**值该在的位置**（垂直居中、正常字号）—— 它此刻
//                   兼任 placeholder，所以框里只有一行东西，不留空行
//   聚焦 / 有值     label **上移并缩小**到框内顶部，让出值行
//
// 两态之间走 200ms 过渡。位移与缩放**都在 `transform` 上**（`translate-y` +
// `scale` + `origin-top-left`），不过渡 `top` / `font-size` —— 后两者逐帧触发
// 重排、字号在亚像素上会抖，而 transform 走合成层。
//
// ── 「有没有值」由控件自己上报，调用方不传 ────────────────────────────────
// 浮不浮起要知道当前有没有值。插件里的原型是让调用方传 `value`，那意味着每个
// 字段都要把子控件的 value 再写一遍 —— 529 个调用点 × 一次重复，而且写岔了
// label 就不浮或不落，还不报错。
//
// 现在改成：`FloatingField` 经 context 广播自己，下面的控件薄壳（`FieldInput` 等）
// 各自把「我有没有值」报上来。调用点因此只写一遍值：
//
//   <FloatingField label="名称"><FieldInput value={v} onChange={…} /></FloatingField>
//
// ── **自给自足：删掉本文件不牵动任何东西** ────────────────────────────────
// 本文件不依赖 `Field` 一族（`ui/field.tsx`）、不依赖 `form.tsx`、也不依赖
// `InputGroup` —— id / error / ARIA 绑定、label、描述、错误行、框，全在这里自己实现。
//
// 这是刻意的：filled 与旧 `Field` 是**两套并存**的东西，任何一方的删除都应该是
// 「删掉一个文件」，而不是先拆一堆共用件。共用件省下的那几十行，抵不上两套形态
// 互相纠缠的代价。
//
// 顺带甩掉了 `InputGroup`：为了适配它写过一大串覆写，而那些坑里有两个
// （`has-disabled:` 嗅探太宽、`has-[input-group-control]` 太窄）根本就是它带来的 ——
// 自己画框比对抗它更短。
//
// ── 为什么还需要一层控件薄壳 ──────────────────────────────────────────────
// 框由字段画，控件必须把自己那一份**边框 / 底色 / 焦点环 / placeholder 时机**交出去。
// 这件事无法靠调用方传 className 完成 —— 走这条路踩了五个坑，每个都不报错：
//
//   `h-full` 盖不住 `data-[size=default]:h-8`（属性选择器特异性更高，
//                                             tailwind-merge 也不认为它们冲突）
//   `focus` / `focus-visible` / `focus-within` 三套伪类要分别抹，漏一个就多一圈环
//   `placeholder` 是默认参数，传 undefined 反而触发默认值
//   `has-disabled:` 嗅探太宽 —— 一个到界禁用的步进按钮就把整个字段刷成灰
//   `has-[[data-slot=input-group-control]]` 太窄 —— 只认 Input，下拉聚焦时框不亮
//
// 所以这些结论固化在薄壳里，写一次、所有调用点白拿。这一层是「放进字段框里的控件」，
// 不是第二套控件 —— 它们内部就是 `Input` / `Textarea` / `DataSelect` / `NumberField` /
// `HierarchySelect`。
// ModelSphere 本地改动：去掉了层级单选 `FieldHierarchy`（依赖 hierarchy-select，console 用不到）。

import * as React from "react"
import { cn } from "../utils"
import { useUiT } from "../i18n/index"
import { DataSelect } from "./data-select"
import { comboboxChoices, comboboxDisplay, type ComboboxOption } from "./field-combobox-model"
import { atLimit, countEnabled, countReserveCh, countText, syncOnFormReset, valueLength } from "./field-count-model"
import { FieldHint } from "./field-hint"
import {
  FIELD_GAP_CLS, MSG_LINE_CLS, MSG_PAD_CLS, MSG_RESERVE_CLS, MSG_TIGHTEN_CLS,
  NOTICE_SHIFT_CLS, OPTION_GAP_CLS,
} from "./field-message-metrics"
import { NumberField } from "./number-field"
import { SelectOptionContent } from "./select-option-content"
import { Alert, AlertDescription } from "./ui/alert"
import {
  Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList,
} from "./ui/combobox"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"

// ─── 字段 ↔ 控件之间的插槽 ───────────────────────────────────────────────────

interface FieldSlot {
  /** label 是否已浮起。控件据此决定显不显示自己的 placeholder。 */
  floated: boolean
  /** 控件上报「我有没有值」。按 id 记账，一个字段里放多个控件也不会互相覆盖。 */
  report: (id: string, hasValue: boolean) => void
  /** 字段 id —— 控件挂到自己身上，`<label for>` 才指得到真正的输入元素。 */
  fieldId: string
  /** 当前错误。控件据此置 `aria-invalid` / `aria-describedby`。 */
  error?: string
  /**
   * 字段是不是必填。**给行列表类控件用**（`FieldKeyValue` / `FieldRepeater`）——
   * 它们的「必填」不只是标个星号，还决定空态摆不摆一行、最后一行删不删得掉。
   *
   * 走插槽而不是让调用方两边各传一次：`<FloatingField required>` 标了星号、
   * 里面的列表却还能删到零条，是必然会发生的一种不一致。
   */
  required: boolean
  /** 单行框行尾有没有 `action` 按钮 —— 字数计数据此排到按钮左侧。 */
  action: boolean
}

const FieldSlotContext = React.createContext<FieldSlot | null>(null)

/**
 * 复合控件（如 `QuantityInput` 内部的单位下拉）用它把插槽**挡住**，
 * 免得内部零件也去脱框、也去上报值。
 */
export function FieldSlotBoundary({ children }: { children: React.ReactNode }) {
  return (
    <FieldSlotContext.Provider value={null}>{children}</FieldSlotContext.Provider>
  )
}

/**
 * 读外层字段的「必填」。没有外层字段时返回 `false`（组件也能单独用）。
 *
 * 行列表类控件（`FieldKeyValue` / `FieldRepeater`）用它拿默认值，自己的
 * `required` prop 仍然优先 —— 独立使用、或想让行为与星号不一致时还有得覆盖。
 */
export function useFieldRequired(): boolean {
  return React.useContext(FieldSlotContext)?.required ?? false
}

/**
 * 控件薄壳用的钩子：上报自己有没有值，拿回「要不要显示 placeholder」。
 *
 * 卸载时上报 `false` —— 条件渲染的控件消失后若不清账，label 会一直浮着。
 */
function useFieldSlot(hasValue: boolean) {
  const slot = React.useContext(FieldSlotContext)
  const id = React.useId()
  const report = slot?.report
  React.useEffect(() => {
    if (!report) return
    report(id, hasValue)
    return () => report(id, false)
  }, [report, id, hasValue])
  return slot
}

/** 空串 / undefined / null / 空数组都算「没有值」。 */
function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return v !== undefined && v !== null && v !== ""
}

// ─── 样式常量 ────────────────────────────────────────────────────────────────

/** 值区与 label 共用的左内边距。**必须同一个值**，否则 label 浮起时会横向漂。 */
const PAD_X = "px-3"

/** 单行档的框高。值行 + 浮起后的 label 行，两者都要放得下。 */
const ROW_H = "h-14"

/** 值行的内边距。有的控件把它给内部输入框（`inputClassName`），所以单独抽出来。 */
const ROW_PAD = cn("pt-6 pb-1.5", PAD_X)

/**
 * 固定前缀 / 后缀块（`infer-` 前缀、`.svc.cluster.local` 后缀这类平台替用户补的一截）。
 *
 * **画在框里、带底色、整高**，不是框下的一行说明 —— 说明读起来像「顺带一提」，
 * 而它是值的一部分：用户要据此判断最终名字。底色取 `--surface-disabled`，与禁用面
 * 同一档：它同样是"这块不由你填"的意思。
 *
 * **必须由 `FloatingField` 渲染，不能做在 `FieldInput` 上。** label 是绝对定位、
 * 锚在框的 `left-3`；前缀做在控件层的话两者会叠字（实测「in服务名称」糊成一团）。
 * 放在框这一层，值区成为 label 的定位父级，label 自然排到前缀之后。
 *
 * 同理**不用 `InputGroup`** —— 本文件刻意不依赖它（见文件头）。
 */
function FieldAffix({ side, children }: { side: "start" | "end"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex shrink-0 select-none items-center self-stretch",
        "bg-surface-disabled px-3 text-sm leading-5 text-muted-foreground",
        // 圆角只给贴着框外沿的那一侧，另一侧是分隔线
        side === "start" ? "rounded-l-md border-r border-input" : "rounded-r-md border-l border-input",
      )}
    >
      {children}
    </span>
  )
}

/** 值区铺满整个框 —— label 是 `pointer-events-none` 的，点框内任意处都要落到控件上。 */
const ROW_FILL = cn("h-full w-full", ROW_PAD)

/**
 * 框。**自己画** —— 底色与 `Input` / `SelectTrigger` 同口径（亮 `bg-background`、
 * 暗 `dark:bg-input/30`，PATTERNS 5.1 的 surface token 表末条）。
 */
const FRAME = cn(
  "relative flex w-full rounded-lg border border-input bg-background text-sm transition-colors",
  "dark:bg-input/30",
  // 状态要连续：静默 → 悬停边框先加深 → 聚焦再变主色。中间不留硬跳。
  //
  // `not-focus-within:` 不能省：聚焦态与悬停态特异度相同（都是 0,2,0），谁赢只看
  // 生成的 CSS 里谁靠后 —— Tailwind 把 hover 排在 focus-within 之后，于是「聚焦 + 悬停」
  // 显示的是**更浅**的悬停色，鼠标移开才露出聚焦色，阶梯在顶端反过来。
  // 聚焦时直接让悬停规则不匹配，与顺序无关。
  "not-focus-within:hover:border-ring/40",
  // 聚焦**只让边框变色，不套环**：`ring-3` + `ring-ring/50` 在主色跟了 neutral 之后
  // 是三像素的深灰环箍在框外，又厚又脏。filled 的框本身就是视觉主体，
  // 边框变深 + label 上移 + 光标出现，信号已经够了。
  //
  // 用 `focus-within` 而不是 `:has(控件:focus-visible)` 那种按类型挑的写法 ——
  // 挑类型必然漏（下拉的触发器是 button、数字是复合件），表现是同一个表单里
  // 有的字段聚焦会亮、有的不亮。
  "focus-within:border-ring",
)

/** 错误态：只有红边，不套红环 —— 同上，环太重。 */
const FRAME_INVALID = "border-destructive hover:border-destructive focus-within:border-destructive"

/**
 * 禁用 / 只读态。三件事，各有各的理由：
 *
 * **不降透明度** —— `opacity-50` 会让文字发虚，读作「坏了」而非「不给改」。
 *
 * **底色比分区标题条更深，不是更浅。** `--muted` 是本仓复用最狠的 token：页签轨道、
 * 悬停底、`FormSection` 分区标题条都读它。禁用字段若也落在 muted 一档，就和标题条
 * 分不开，一列灰块糊成一片（LF 2026-09-17 反馈）；而压到 40% 叠白又淡到看不见。
 * 往深了拉开才成立 —— 浅到看不见等于没有禁用态。
 *
 * 底色走专用的 `--surface-disabled`（不复用 `muted`，也不借 `input` 的边框色）——
 * 调边框色不该把禁用底一起带偏。
 *
 * **`cursor-not-allowed` 挂在框上** —— 里面的原生控件自己带这个光标，但框有内边距，
 * 指针落在padding 上时还是普通箭头，看着像「这儿能点」。
 */
const FRAME_DISABLED = "cursor-not-allowed border-input bg-surface-disabled"

/**
 * 控件交出自己那一份框 —— 边框、底色、阴影、**三套聚焦伪类**、错误红边。
 *
 * ⚠️ `focus` / `focus-visible` / `focus-within` 一个都不能少：仓里的控件各用各的
 * （combobox 触发器用 `focus`、Input 用 `focus-visible`、NumberField 是容器用
 * `focus-within`），抹漏哪个，哪个控件聚焦时就会在字段框里再套一圈环，且不报错。
 */
const BARE = cn(
  "rounded-none border-0 bg-transparent shadow-none outline-none",
  "ring-0 ring-offset-0",
  "focus:ring-0 focus:ring-offset-0 focus:outline-none",
  "focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none",
  "focus-within:border-0 focus-within:ring-0 focus-within:ring-offset-0",
  "aria-invalid:border-0 aria-invalid:ring-0",
  "has-[[aria-invalid=true]]:border-0 has-[[aria-invalid=true]]:ring-0",
  "disabled:bg-transparent disabled:opacity-100",
  "dark:bg-transparent dark:disabled:bg-transparent",
)

/**
 * 警示条：「这件事有个前提 / 有个代价，你得知道」。极淡琥珀底 + 琥珀字，无边框、无图标
 * （边框会成框中框，警告三角会把语气放大到与内容不相称）。行高 `leading-relaxed` ——
 * 这条通常是两句话。
 *
 * **字色由本组件统一给，调用方不要在 children 里再套 `text-muted-foreground`** ——
 * 字色来自 `Alert` warning 档的 `*:data-[slot=alert-description]:text-warning/90`，
 * 那是「类 + 属性」的子选择器（特异度 0,2,0），压得过 `AlertDescription` 上的 `text-*`，
 * 但只够到 `AlertDescription` 这一层：调用方在里面再套一个带颜色的 `<span>`，
 * 那一句就会比同一屏的其它提示浅一档。
 *
 * **导出是为了让字段之外的地方也用同一份**（`TransferList` 的列提示就是），抄 class 会漂。
 */
export function FieldNotice({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="warning" className="border-transparent bg-warning/8 px-3 py-2 text-xs">
      <AlertDescription className="text-xs leading-relaxed">{children}</AlertDescription>
    </Alert>
  )
}

// ─── 字段 ────────────────────────────────────────────────────────────────────

export interface FloatingFieldProps {
  /** 字段名。显示在框内 —— 空且未聚焦时它就在值的位置上，兼任 placeholder。 */
  label: React.ReactNode
  /** 必填 —— label 后跟红 `*`。选填**不加任何标记**。 */
  required?: boolean
  /** `?` 里的解释。只放「不懂时才看」的内容，一两句、40 字以内。 */
  hint?: React.ReactNode
  /**
   * 常驻描述。每次都要看的信息才用它，只在不懂时才看的解释用 `hint`。
   *
   * ⚠️ **只有 `inline`（开关）这一档有它，而且在框内。** 其余档位传了会被忽略并
   * 在 dev 模式下警告。
   *
   * ── 为什么框外不再有常驻灰字（2026-09-04 收窄）──────────────────────────
   * **框外下方只留两样东西：校验错误（红字）和警示条。** 两样都是「此刻需要你做点
   * 什么」——改掉这个值、或者知道有个代价。灰色的解释句混在它们中间，就把一个
   * 有信号的位置变成了一片总有字的地方：一列字段每个下面都挂一句灰字，真正出错的
   * 那一条就淹了。
   *
   * 于是解释性文字一律进 `?`（`hint`）—— 不懂的人点开看，懂的人眼里那一列干干净净。
   * 「留空则由平台分配」「创建后不可修改」这类都归这里。真正带代价、必须让人看见
   * 的（配额会翻倍、改完要同步安全组）走 `notice`，那是警示条不是描述。
   *
   * 开关是唯一的例外，因为它的描述在**框内**紧跟 label：那是这一项自己的内容，
   * 不占框外那个信号位。⚠️ 也**只放一行放得下的**（约 20 字）——框内那行被撑成
   * 两三行之后，这一项就比周围的字段高一截，一列开关的节奏就断了。
   */
  description?: React.ReactNode
  /** 校验错误。有值时框变红边 + 框下出红字。 */
  error?: string
  /**
   * 校验反馈的**非错误态** —— 「正在检查别名是否可用…」「别名可用」这一类。
   *
   * 和 `error` **共用框下那一行**，有 `error` 时被盖掉。它不是 `description` 的
   * 后门：判据是**它会消失**。校验反馈跟着这一次输入来去，看完就没了；描述是
   * 从头到尾都在的那种句子，那种一律进 `?`。
   *
   * 异步校验必须有「进行中」和「通过」两个态，否则用户填完只能盯着一个不动的框
   * 猜有没有在查 —— 于是他会去点提交，而那正是校验想替他省掉的一趟。
   */
  /**
   * 🧊 **已冻结，不要再传**（freeland#1433）。框外只有两样：`error`（你这次填错了）与
   * `notice`（你得知道的一件事）。
   *
   * 它原本承载「异步校验的进行中 / 通过」，但那个场景在本产品里不存在：字段级异步校验
   * 一个都没有，重名查重是同步的，唯一的真异步（配额预检）是一次业务动作、归 `notice`。
   * 留下的只是一个长得像「框下随便写一句话的地方」的槽，被误用 11 次、正确用 2 次。
   *
   * 将来真出现字段级异步校验：**进行中走框内**（与候选加载同一套），错误仍走 `error`。
   *
   * 传了不渲染，dev 模式下报一次。prop 暂留是因为 `SDK.components` 是只增不减的面，
   * 存量插件传了不该编译不过；全仓迁完再删。
   */
  status?: React.ReactNode
  /**
   * 框内行尾的一个动作按钮（密码明文切换、清空、生成…）。
   *
   * 做成插槽而不是让页面自己在框上绝对定位一个按钮：那样每处都要写死
   * `absolute right-1 h-8 w-8`，既是手搓又把尺寸钉死，换密度就错位。
   * （2026-09-11 重置密码抽屉 filled 化时，明文开关正是因为没有这个槽位被删掉的。）
   *
   * 值区会自动让出右边的位置，按钮垂直居中。只给单行档用 —— 多行值区没有「行尾」。
   */
  /** 固定前缀（`infer-`、`http://`）。画在框内左侧、带底色，是值的一部分，不计入 `value`。 */
  prefix?: React.ReactNode
  /** 固定后缀（`.svc.cluster.local`）。同 `prefix`，画在框内右侧。 */
  suffix?: React.ReactNode
  action?: React.ReactNode
  /** 跟在 `?` 后面的一段弱化文字，如字段的示例值。 */
  aside?: React.ReactNode
  /**
   * 警示条 —— 「什么情况下应该开启/填写这一项」。
   *
   * 与 `description` / `error` 的分工：
   *   `description`  这个字段是什么、不填会怎样        —— 中性
   *   `error`        你这次填错了                      —— 出错才有
   *   `notice`       什么情况下该开/该填、有什么代价    —— **常驻，不被 error 盖掉**
   *
   * 后两者说的是两件事，所以**同时显示**，警示条排在错误**下面**。
   *
   * 位置：`inline` 档在框**内**，其余在框**外**、排在错误下面。
   *
   * 它和 `error` 是**框外仅有的两样东西** —— 别拿它当加粗版 description 用：
   * 一列字段全挂着黄条，等于一条都没有。
   */
  notice?: React.ReactNode
  /**
   * `inline` 档的**框内展开区** —— 开关打开后才出现的从属内容。
   *
   * 放进框里而不是平铺在下面，是因为框的边界正好表达「这几样属于这个开关」。
   * 判据见 PATTERNS 3「开关带框、勾选无框」。
   */
  expandedContent?: React.ReactNode
  /**
   * 展开区显不显示。**通常不用传** —— 默认读 `children` 上的 `checked`，
   * 所以同一个布尔值只在 `<Switch>` 上写一遍。
   *
   * 只有当值区不是一个直接的开关元素（外面包了层、或用了别的控件）时才需要显式传。
   */
  expanded?: boolean
  /**
   * 整个字段禁用（框变灰底、去边框）。
   * **要显式传** —— 靠 `has-disabled:` 嗅探后代会被步进按钮的到界禁用误伤。
   * 控件自身的 `disabled` 照常传给控件，两件事。
   */
  disabled?: boolean
  /**
   * 当前值 —— **通常不用传**：`float` 档的控件会经 context 自己上报。
   * 只有在值区放了不上报的东西（第三方控件、纯展示节点）时才用它兜底。
   */
  value?: unknown
  /**
   * 排布。判据见文件头。
   *
   * - `float`（默认）值是**一行**
   * - `block`  值是**一块**
   * - `inline` **开关**：label 在左、控件贴右，整行一个框
   * - `option` **勾选项**：勾选框在左、文字紧跟在右，**没有框**
   *
   * ⚠️ `inline` 与 `option` 的区别不是随意的：
   *
   *   `Switch` 是**设置项** —— 「某某功能 ————— [开关]」是它的标准形态，
   *   两端分列、中间留白，一眼扫下来能对齐一列开关。
   *
   *   `Checkbox` 是**勾选项** —— 勾选框和它的文字是一体的（点文字也该切换）。
   *   拆成两端之后，一行 500px 宽时文字在最左、勾选框在最右，
   *   视线要横跨整行才能确认勾没勾，一组连续的勾选项更是完全读不成一组。
   *
   * @default 'float'
   */
  layout?: "float" | "block" | "inline" | "option"
  /**
   * `float` 档的值区是多行（Textarea）。
   *
   * 只影响 label **未浮起时**落在哪：单行框里它落在框的垂直中心；多行框高好几行，
   * 居中就掉到第二行去了 —— 必须对齐**第一行文字**，因为它此刻扮演的是 placeholder。
   */
  multiline?: boolean
  children: React.ReactNode
  className?: string
}

export function FloatingField({
  label,
  required,
  hint,
  description,
  status,
  prefix,
  suffix,
  action,
  aside,
  error,
  notice,
  expandedContent,
  expanded,
  disabled,
  value,
  layout = "float",
  multiline,
  children,
  className,
}: FloatingFieldProps) {
  const fieldId = React.useId()
  const messageId = `${fieldId}-message`
  // 聚焦态：`focus` 不冒泡，但 React 合成事件用的是 `focusin` / `focusout`，
  // 挂在框上就能收到内部任意控件的聚焦。
  const [focused, setFocused] = React.useState(false)
  const [reported, setReported] = React.useState<Record<string, boolean>>({})

  const report = React.useCallback((id: string, hasValue: boolean) => {
    setReported((prev) => (prev[id] === hasValue ? prev : { ...prev, [id]: hasValue }))
  }, [])

  const hasValue =
    value !== undefined ? isFilled(value) : Object.values(reported).some(Boolean)
  // `block` 档的值区始终占着位置（编辑器、列表），label 没有落下去的余地，恒浮起。
  const floated = layout === "block" || focused || hasValue

  /**
   * 展开区显不显示。**默认从 `children` 上读 `checked`** —— 开关的状态本来就在
   * 那儿，再让调用方传一遍 `expanded` 等于同一个布尔值写两处，还会写岔。
   *
   * 只在值区不是一个直接的开关元素时（外面包了层、换了控件）才需要显式传 `expanded`。
   */
  const childChecked =
    React.isValidElement<{ checked?: unknown }>(children) && children.props.checked === true
  const open = expanded ?? childChecked

  const hasAction = !!action && !multiline
  const slot = React.useMemo<FieldSlot>(
    () => ({ floated, report, fieldId, error, required: !!required, action: hasAction }),
    [floated, report, fieldId, error, required, hasAction],
  )

  const labelBody = (
    <>
      {label}
      {required ? (
        <span className="-ml-1 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
      {/* `?` 要单独把鼠标事件收回来 —— 浮动档的 label 整体是 `pointer-events-none`，
          不捞回来的话悬停没有任何反应，且不报错。 */}
      {hint ? (
        <span className="pointer-events-auto">
          <FieldHint>{hint}</FieldHint>
        </span>
      ) : null}
      {aside ? <span className="text-muted-foreground">{aside}</span> : null}
    </>
  )

  /**
   * 框外的附属文字 —— **只有校验反馈（错误 / 检查中 / 通过）和警示条**。
   *
   * 两样都是「此刻需要你做点什么」。常驻的解释句不在这儿（见 `description` 的
   * 注释）：一列字段每个下面都挂一句灰字，真正出错的那一条就淹了。
   *
   * 错误在上、警示在下，且**警示不被错误盖掉** —— 「什么情况下该填」和「你这次
   * 填错了」是两件事，两条都该看见。
   */
  /**
   * 校验反馈（错误 / 检查中 / 通过）。
   *
   * **它是外层的在流子元素，但用 `MSG_RESERVE_CLS` 把自己占的第一行抵回去** ——
   * 单行反馈的外框高度与没有反馈时逐像素一致（出错不会「一报错整张表跳一下」，
   * LF 2026-09-15 截图抓到的就是那个抖动），换行时只按超出的部分把下方推开。
   * 数字与类名的对应关系在 `field-message-metrics.ts`，由它的单测钉住。
   *
   * 早先是 `absolute top-full` 贴在框上、完全不参与布局：单行没问题，但文案一换行
   * 第二行起就被下一个字段盖住（LF 2026-09-22 截图抓到）。校验文案要引用用户数据
   * （域名、模型名）时长度不由我们定，「改文案」不是出路，所以改成在流 + 抵消。
   *
   * 外层另留 `pb-1.5`（6px）当余量：那 6px 不能换成 `margin`，调用方多数是
   * `space-y-*` 容器（普通块流），相邻兄弟外边距会折叠成较大的那个，6px 会被整个
   * 吃掉 —— `padding` 不参与折叠，才加得上去。
   */
  const MSG_CLS = cn("pointer-events-none text-xs font-normal", MSG_LINE_CLS, MSG_RESERVE_CLS)

  /**
   * `tighten` 只有带框那几档要传（外层 `gap-2`，收到 4px）；`option` 档外层就是
   * `gap-1`，再收就贴到上一行了。
   *
   * 带框那几档同时传 `PAD_X`：错误行要与**框内的 label / 值**、以及下面警示条里的文字
   * 对齐在同一条竖线上（三者都缩 12px）。不缩的话错误行贴容器左边缘，比上下两行各突出
   * 一截。`option` 档没有框，不缩。
   */
  const renderMessage = (tighten?: string) =>
    error ? (
      <div id={messageId} role="alert" className={cn(MSG_CLS, tighten, "text-destructive")}>
        {error}
      </div>
    ) : null

  /** 有没有反馈行 —— 警示条要不要让位看它。 */
  const hasMessage = !!error

  /**
   * 警示条是常驻内容，正常占位。
   *
   * **两条同时在时要给错误行让位。** 错误行用负下外边距抵掉了自己的第一行
   * （20px），不让位的话警示条会直接压在它上面（LF 2026-09-18 截图抓到）。
   *
   * `mt-3`（12px）+ 外层的 `gap-2`（8px）= 20px，正好补回被抵掉的那一行 ——
   * 所以**换行的长文案也对齐**：多出来的行是在流的，警示条跟着往下走。
   */
  const footer = notice
    ? <div className={cn(hasMessage && NOTICE_SHIFT_CLS)}><FieldNotice>{notice}</FieldNotice></div>
    : null

  /**
   * `description` 只有 `inline` 档吃（框内）。其余档位传了就是写了没效果 ——
   * 这类"传了没反应"的约定不当场说一声就会被反复踩，所以做成 dev 警告。
   */
  // 英文：本文件的写死中文由 cjk-ratchet 按文件计数，dev 警告也算在内（它不分用途）。
  if (process.env.NODE_ENV !== "production" && status) {
    console.warn(
      "[FloatingField] `status` is retired and no longer rendered (freeland#1433). " +
        "Outside the box there are only `error` and `notice`. " +
        "Validation results -> `error`; explanations -> `hint`; platform-supplied segments -> " +
        "`prefix` / `suffix`; empty candidate lists -> the select's own empty state. " +
        `(label: ${typeof label === "string" ? label : "?"})`,
    )
  }
  if (process.env.NODE_ENV !== "production" && description && layout !== "inline") {
    console.warn(
      `[FloatingField] \`${layout}\` 档不显示 description —— ` +
        "框外只留校验错误和警示条。解释性文字改用 `hint`（?），" +
        "真有代价、必须让人看见的用 `notice`（警示条）。" +
        `（label: ${typeof label === "string" ? label : "?"}）`,
    )
  }

  if (layout === "option") {
    // description 的 dev 警告在上面统一发（`inline` 之外的档一律不吃）。
    return (
      // 余量只在有反馈行时加：无条件加会让所有现存勾选项凭空高一截
      <div className={cn("relative flex flex-col", OPTION_GAP_CLS, hasMessage && MSG_PAD_CLS)}>
        <div
          className={cn(
            "flex items-center gap-1.5",
            // 这一档**没有框**，禁用态由勾选框自己表达（淡化的勾选框 + 灰文字），
            // 不在它背后垫灰底 —— 垫底会读成「这是一个带底色的块」，而它只是一行选项。
            //
            // 曾经垫过：那时 `Checkbox` 只写了 `disabled:opacity-50`，而 Base UI 给的是
            // `data-disabled`，这档样式从不生效，只好拿灰底补。现在勾选框补了
            // `data-disabled:` 变体，补丁可以撤了。
            disabled && "cursor-not-allowed",
          )}
        >
          {/*
            用原生 `<label>` **包住**勾选框和文字（而不是 htmlFor 指过去）——
            包裹式不需要 id，点文字也能切换，这正是勾选项该有的行为。
          */}
          <label className="flex cursor-pointer items-center gap-2">
            <FieldSlotBoundary>{children}</FieldSlotBoundary>
            <span
              className={cn(
                "text-sm leading-snug",
                // label 是**选项名**不是值，禁用时变灰是标准做法 ——
                // 「换底不降透明度」那条针对的是值（用户要能读到当前值是什么）
                disabled && "text-muted-foreground",
              )}
            >
              {label}
              {required ? (
                <span className="ml-1 text-destructive" aria-hidden>
                  *
                </span>
              ) : null}
            </span>
          </label>
          {/*
            `?` 放在 `<label>` **外面** —— 包在里面的话点它会连带切换勾选框，
            用户只是想看一眼说明。
          */}
          {hint ? <FieldHint>{hint}</FieldHint> : null}
        </div>
        {/* 框外只有反馈行。⚠️ 这一档不渲染 notice（既有行为，且没有 dev 警告） */}
        {renderMessage()}
      </div>
    )
  }

  if (layout === "inline") {
    // 框内除了头一行还有没有别的（描述 / 展开区 / 警示条）
    const hasBody = !!description || !!notice || !!(open && expandedContent)
    return (
      <div role="group" className={cn("relative flex w-full flex-col", FIELD_GAP_CLS, MSG_PAD_CLS)}>
        <div
          className={cn(
            FRAME,
            // 框是**纵向**容器：头一行是 label + 开关，下面依次是描述、展开区、警示条。
            // 只有头一行时仍固定单行高，形态与最简单的那个一行开关一致。
            "flex-col",
            !hasBody && ROW_H,
            error && FRAME_INVALID,
            disabled && FRAME_DISABLED,
            className,
          )}
        >
          {/*
            头一行**只放 label 和开关**。描述不在这一行里 —— 放进去的话 label 那一列
            会变成两行高，`items-center` 就把开关按两行居中，开关看起来往下掉半行
            （2026-09-04 实测）。描述归下面的内容区，横跨整宽。
          */}
          <div className={cn("flex w-full items-center", hasBody ? "pt-3" : "h-full")}>
            <div className={cn("min-w-0 flex-1", PAD_X)}>
              <Label
                htmlFor={fieldId}
                className={cn(
                  "flex w-fit gap-1.5 leading-snug font-normal",
                  disabled && "text-muted-foreground",
                )}
              >
                {labelBody}
              </Label>
            </div>
            <div className="flex shrink-0 items-center pr-3">
              {/* inline 档的值区放的是开关 —— 它不该脱框，也没有「值」可上报 */}
              <FieldSlotBoundary>{children}</FieldSlotBoundary>
            </div>
          </div>

          {/*
            内容区：描述 → 展开区 → 警示条。都在**框内** —— 框的边界正好表达
            「这几样属于这个开关」。
            警示条**关掉也留着**（它说的是「什么情况下该开」，正是关着的时候最该看见），
            展开区跟着开关走。
          */}
          {hasBody ? (
            <div className={cn("mt-1 flex flex-col gap-2.5 pb-3", PAD_X)}>
              {description ? (
                <p className="text-sm leading-normal text-muted-foreground">{description}</p>
              ) : null}
              {open && expandedContent ? expandedContent : null}
              {notice ? <FieldNotice>{notice}</FieldNotice> : null}
            </div>
          ) : null}
        </div>
        {/* 反馈行是框的**在流兄弟**：换行时把下方推开，而不是盖住它（见 renderMessage） */}
        {renderMessage(cn(MSG_TIGHTEN_CLS, PAD_X))}
      </div>
    )
  }

  return (
    <div role="group" className={cn("relative flex w-full flex-col", FIELD_GAP_CLS, MSG_PAD_CLS)}>
      <div
        data-floated={floated ? "true" : "false"}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
        className={cn(
          FRAME,
          "items-stretch",
          // 多行的高度由 Textarea 的 rows 撑，固定框高会把它截掉。
          layout === "float" && !multiline ? ROW_H : "h-auto flex-col",
          error && FRAME_INVALID,
          disabled && FRAME_DISABLED,
          className,
        )}
      >
        {prefix ? <FieldAffix side="start">{prefix}</FieldAffix> : null}
        {/*
          有前缀时值区自成定位父级 —— label 的 `left-3` 从此相对值区，
          自然排在前缀之后；没有前缀时不加这层，保持原有 DOM 不变。
        */}
        {/*
          单行档值区是横向 flex，子元素默认按内容收缩：调用方给控件包一层 div（提交后聚焦等）时，
          里面 `w-full` 的触发器会缩到 `min-w`。直接子元素一律占满；绝对定位的 label / 行尾按钮不受影响。
        */}
        <div
          className={cn(
            prefix || suffix ? "relative flex min-w-0 flex-1 items-stretch" : "contents",
            layout === "float" && !multiline && "*:min-w-0 *:flex-1",
          )}
        >
        {/* `pointer-events-none`：label 盖在控件上方，不能吃掉点击 —— 点框内任意处
            都该落到控件自己身上。代价是点 label 不再聚焦，但 label 此刻**就在控件
            正上方**，点它等于点控件。`htmlFor` 仍在，读屏的关联没丢。 */}
        <Label
          htmlFor={fieldId}
          className={cn(
            "pointer-events-none absolute top-0 left-3 z-10 flex w-fit gap-1.5 font-normal",
            "origin-top-left leading-5 transition-transform duration-200 ease-out",
            // label 是**辅助信息**，值才是主体 —— 两行同色会互相争注意力。
            // 未浮起时它兼任 placeholder，muted 正是 placeholder 该有的颜色。
            error ? "text-destructive" : "text-muted-foreground",
            floated
              ? "translate-y-2 scale-[0.857]"
              : multiline
                ? // 多行：对齐**第一行文字**（= 值区的 padding-top，24px）
                  "translate-y-6 scale-100"
                : // 单行：垂直居中于框，(56 − 行高 20) / 2 = 18px
                  "translate-y-[18px] scale-100",
          )}
        >
          {labelBody}
        </Label>
        {/* 值区让出行尾按钮的位置（按钮 32px + 两侧间距），不给 action 时不加这层 */}
        <FieldSlotContext.Provider value={slot}>
          {action && !multiline ? (
            <div className="[&_[data-slot=input-group-control]]:pr-11 [&_input]:pr-11">{children}</div>
          ) : (
            children
          )}
        </FieldSlotContext.Provider>
        {action && !multiline && (
          <div className="absolute top-1/2 right-2 z-10 -translate-y-1/2">{action}</div>
        )}
        </div>
        {suffix ? <FieldAffix side="end">{suffix}</FieldAffix> : null}
      </div>
      {/* 反馈行是框的**在流兄弟**：换行时把下方推开，而不是盖住它（见 renderMessage） */}
      {renderMessage(cn(MSG_TIGHTEN_CLS, PAD_X))}
      {footer}
    </div>
  )
}

// ─── 值区控件 ────────────────────────────────────────────────────────────────

/** 字数计数的开关。只在同时给了 `maxLength` 时生效，显示 `当前字数/上限`。 */
interface FieldCountProps {
  showCount?: boolean
}

/**
 * 计数用的当前字数。受控读 `value`；非受控时自己记一份，随 `onChange` 与所属表单的 reset 更新。
 * 返回包过的 `onChange` 与 `ref`，调用方的回调和 ref 照常生效。
 */
function useCountedLength<E extends { target: { value: string } }, T extends HTMLInputElement | HTMLTextAreaElement>(
  enabled: boolean,
  value: unknown,
  defaultValue: unknown,
  onChange: ((e: E) => void) | undefined,
  ref: React.Ref<T> | undefined,
) {
  const [uncontrolled, setUncontrolled] = React.useState(() => valueLength(defaultValue))
  const controlled = value !== undefined
  const node = React.useRef<T | null>(null)
  const handleChange = React.useCallback(
    (e: E) => {
      if (!controlled) setUncontrolled(e.target.value.length)
      onChange?.(e)
    },
    [controlled, onChange],
  )
  const handleRef = React.useCallback(
    (el: T | null) => {
      node.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) (ref as React.MutableRefObject<T | null>).current = el
    },
    [ref],
  )
  React.useEffect(() => {
    if (!enabled || controlled || !node.current) return
    return syncOnFormReset(node.current, setUncontrolled)
  }, [enabled, controlled])
  return { length: controlled ? valueLength(value) : uncontrolled, onChange: handleChange, ref: handleRef }
}

/**
 * 计数本身。读屏隐藏 —— 每敲一个字播报一次太吵，上限由原生 `maxLength` 传达。
 * 达到上限用警示色而不是错误色：原生 `maxLength` 已经拦住多余输入，此刻不是错。
 */
function FieldCount({ length, max, className }: { length: number; max: number; className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 text-xs tabular-nums",
        atLimit(length, max) ? "text-warning" : "text-muted-foreground",
        className,
      )}
    >
      {countText(length, max)}
    </span>
  )
}

export function FieldInput({
  className,
  placeholder,
  showCount,
  style,
  ...props
}: React.ComponentProps<typeof Input> & FieldCountProps) {
  // placeholder 只在浮起后出现 —— 没浮起时 label 就在值行上，两者会叠字。
  // 做成「不传」而不是「染透明」：透明字仍然占位、仍能被读屏念到、仍会被全选复制走，
  // 那是把「不该出现」做成了「看不见」。
  const slot = useFieldSlot(isFilled(props.value))
  const counting = countEnabled(showCount, props.maxLength)
  const counted = useCountedLength(counting, props.value, props.defaultValue, props.onChange, props.ref)
  const input = (
    <Input
      id={slot?.fieldId}
      aria-invalid={slot?.error ? true : undefined}
      aria-describedby={slot?.error ? `${slot.fieldId}-message` : undefined}
      className={cn(BARE, ROW_FILL, className)}
      placeholder={!slot || slot.floated ? placeholder : undefined}
      {...props}
      {...(counting
        ? {
            onChange: counted.onChange,
            ref: counted.ref,
            // 行内样式压过 `FloatingField` 给 action 让位的 `[&_input]:pr-11`：计数 + 间距 + 计数右侧的偏移
            style: {
              ...style,
              paddingRight: `calc(${countReserveCh(props.maxLength as number)}ch + ${slot?.action ? "3.25rem" : "1.25rem"})`,
            },
          }
        : { style })}
    />
  )
  if (!counting) return input
  return (
    <div className="relative h-full w-full min-w-0">
      {input}
      {/* 与值行同一行：值区 `pt-6` + `leading-5`，计数取同样的起点与行高 */}
      <FieldCount
        length={counted.length}
        max={props.maxLength as number}
        className={cn("top-6 leading-5", slot?.action ? "right-11" : "right-3")}
      />
    </div>
  )
}

export function FieldTextarea({
  className,
  placeholder,
  showCount,
  ...props
}: React.ComponentProps<typeof Textarea> & FieldCountProps) {
  const slot = useFieldSlot(isFilled(props.value))
  const counting = countEnabled(showCount, props.maxLength)
  const counted = useCountedLength(counting, props.value, props.defaultValue, props.onChange, props.ref)
  const textarea = (
    <Textarea
      id={slot?.fieldId}
      aria-invalid={slot?.error ? true : undefined}
      aria-describedby={slot?.error ? `${slot.fieldId}-message` : undefined}
      // 顶部内边距与单行档同为 24px —— label 浮起后停在同一条线上，
      // 一列里单行字段和多行字段的 label 才对得齐。
      // 计数在右下角，底部多留一行给它，最后一行字不被盖住。
      className={cn(BARE, "w-full pt-6 pb-2.5", PAD_X, counting && "pb-7", className)}
      placeholder={!slot || slot.floated ? placeholder : undefined}
      {...props}
      {...(counting ? { onChange: counted.onChange, ref: counted.ref } : {})}
    />
  )
  if (!counting) return textarea
  return (
    <div className="relative w-full">
      {textarea}
      <FieldCount length={counted.length} max={props.maxLength as number} className="right-3 bottom-2 leading-4" />
    </div>
  )
}

/**
 * 下拉类触发器装进框里的那一份公共处理 —— `FieldSelect` 与 `FieldHierarchy` 共用。
 *
 * 箭头**居中于整个框**，不跟着值行走 —— 它表达的是「这个框是个下拉」，
 * 属于框不属于值那一行。三个触发器的最后一个子元素分别是 `<svg>`（Select）
 * 和包着清空+箭头的 `<span>`（Combobox / HierarchySelect），所以选择器用 `*:last-child`。
 *
 * 值文本给箭头让出右边（`pr-9`），否则长值会压到箭头底下。
 */
const DROPDOWN_TAIL = cn(
  "relative",
  "[&>*:last-child]:absolute [&>*:last-child]:top-1/2 [&>*:last-child]:right-3",
  "[&>*:last-child]:-translate-y-1/2",
  "pr-9",
)

/**
 * 下拉类控件的 placeholder 时机。
 *
 * ⚠️ 未浮起时必须显式传 `""`，不能传 undefined：`DataSelect` 与 `HierarchySelect`
 * 的签名都是 `placeholder = "请选择"`（**默认参数**），undefined 恰好就是触发默认值的
 * 条件 —— 「请选择」会压在 label 底下。反过来浮起时传 undefined 是对的，那正是要它用默认值。
 */
function dropdownPlaceholder(slot: FieldSlot | null, placeholder: string | undefined) {
  return !slot || slot.floated ? placeholder : ""
}

export function FieldSelect({
  className,
  placeholder,
  ...props
}: React.ComponentProps<typeof DataSelect>) {
  const slot = useFieldSlot(isFilled(props.multiple ? props.values : props.value))
  return (
    <DataSelect
      className={cn(
        BARE,
        ROW_FILL,
        // `SelectTrigger` 的高度钉在 `data-[size=default]:h-8` 上 —— 带属性选择器的
        // 变体，**特异性压过 `h-full`，tailwind-merge 又不认为两者冲突**。不写这条，
        // 触发器永远 32px，`pt-6` 会把值顶到 label 脚下。
        "data-[size=default]:h-full",
        DROPDOWN_TAIL,
        className,
      )}
      {...props}
      placeholder={dropdownPlaceholder(slot, placeholder)}
    />
  )
}

export type { ComboboxOption } from "./field-combobox-model"

export interface FieldComboboxProps {
  value?: string
  onValueChange?: (value: string) => void
  /** 候选是**建议**不是闭集 —— 不在其中的输入值同样可以提交。 */
  options?: readonly ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  /** 有值时给一个清空按钮。 */
  clearable?: boolean
  /** 自造项那一行的文案。 */
  customLabel?: (input: string) => React.ReactNode
  /** 一条都没匹配上时的那句话。 */
  emptyText?: React.ReactNode
  className?: string
  "aria-label"?: string
}

/**
 * 可输入下拉装进 float 档 —— 候选是建议、值可以自己填的那一类字段。
 *
 * **与 `FieldSelect` 的分工**：闭集用 `FieldSelect`（值只能是给定的那几个）；
 * 候选只是省打字、用户必须能填出字典外的值时用本组件（接口路径、标签、域名后缀…）。
 * `DataSelect` 的 props 白名单不收自由输入，所以这一支不挂在它上面，直接用 Combobox 原语。
 *
 * 形态与 `FieldSelect` 一致：值行撑满框、箭头居中于框、未浮起时不给 placeholder。
 * 输入框合起来显示选中值、展开显示正在打的字（`comboboxDisplay`）。
 */
export function FieldCombobox({
  className, placeholder, value = "", onValueChange, options = [],
  disabled, clearable = true, customLabel, emptyText, ...props
}: FieldComboboxProps) {
  const t = useUiT()
  const slot = useFieldSlot(isFilled(value))
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const { matched, custom, items } = comboboxChoices(options, query)
  const showsClear = clearable && !!value && !disabled

  // 只在合起来那一刻清输入：展开时也清的话，「合着状态直接打字」会被吃掉第一个字符
  // —— 那次按键先走 onInputValueChange 存下字符，Base UI 紧接着请求 open=true。
  const toggle = (next: boolean) => {
    if (disabled) return
    setOpen(next)
    if (!next) setQuery("")
  }

  return (
    <Combobox
      open={open}
      onOpenChange={toggle}
      items={items}
      // 过滤自算（comboboxChoices 要同时算出自造项），原语内置过滤关掉
      filter={null}
      // 列表里总有一项被高亮，回车才提交得出去 —— 输入不匹配任何候选时列表只剩
      // 「使用『…』」那一条，高亮的就是它；没有它回车会落到表单提交上。
      autoHighlight
      value={value || null}
      onValueChange={(v: unknown) => {
        onValueChange?.((v as string | null) ?? "")
        toggle(false)
      }}
      inputValue={comboboxDisplay(options, value, query, open)}
      onInputValueChange={(q: string) => {
        setQuery(q)
        // 合着的时候打字要把浮层带开，但清空按钮同样会送来一个空串 —— 那时不该弹开候选。
        if (q && !open) setOpen(true)
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={slot?.fieldId}
        aria-invalid={slot?.error ? true : undefined}
        aria-describedby={slot?.error ? `${slot.fieldId}-message` : undefined}
        aria-label={props["aria-label"]}
        disabled={disabled}
        showClear={showsClear}
        className={cn(
          BARE, "h-full w-full", DROPDOWN_TAIL,
          // `ComboboxInput` 默认「有清空就藏箭头」，而本族的下拉是**清空与箭头并排**
          // （`FieldSelect` 的 clearable 档就是这样）。少了箭头，有值的框看不出是个下拉。
          "[&_[data-slot=input-group-button]]:!inline-flex",
          // 并排两个时留白得跟着加倍：addon 绝对定位（`DROPDOWN_TAIL`）不占布局宽度，
          // 长值——接口路径正是长值——会钻到左边那个按钮底下。留白只能加在**容器**上，
          // 给 input 加是加不动的：`InputGroup` 自带 `has-[>[data-align=inline-end]]:
          // [&>input]:pr-1.5`，特异性 (0,2,1) 压过任何 `[&_input]:pr-*`。
          // `pr-9` 36px（`right-3` 12 + 按钮 24）再加一个按钮 24 与 `gap-2` 8 = 68px；
          // `cn` 走 twMerge，`pr-17` 会把 `DROPDOWN_TAIL` 的 `pr-9` 顶掉。
          showsClear && "pr-17",
          className,
        )}
        render={<Input className={cn(BARE, ROW_FILL)} />}
        placeholder={!slot || slot.floated ? placeholder : undefined}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText ?? t("floatingField.noMatch")}</ComboboxEmpty>
        <ComboboxList>
          {matched.map((option) => (
            <ComboboxItem key={option.value} value={option.value}>
              <SelectOptionContent label={option.label} description={option.description} />
            </ComboboxItem>
          ))}
          {custom !== undefined && (
            <ComboboxItem key={custom} value={custom}>
              {customLabel ? customLabel(custom) : t("floatingField.useCustom", { custom })}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}


export function FieldNumber({
  className,
  ...props
}: React.ComponentProps<typeof NumberField>) {
  // 数字永远有值（`value: number`），所以恒报 true —— label 一直浮着，
  // 这正确：一个显示着 `1` 的框，label 没有落下去的余地。
  useFieldSlot(true)
  return (
    <NumberField
      // `className` 是**外层框**的，输入框和单位槽各有自己的钩子。
      className={cn(BARE, "h-full w-full items-stretch", className)}
      // 同一列里所有值的左边缘必须对齐，居中会让这一个值飘在中间。
      inputClassName={cn("text-left", ROW_PAD)}
      {...props}
    />
  )
}

/**
 * `block` 档的值区包装：label 常驻顶部，内容在下面自由长高。
 * 代码编辑器、键值对列表、"添加一条"按钮用它。
 */
export function FieldBlock({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn("w-full pt-7 pb-2.5", PAD_X, className)}>{children}</div>
}
