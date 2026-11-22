import { test } from "vitest"
import assert from "node:assert/strict"
import { resolveContainerSituation, resolveEmptyParts, type EmptyPartsInput } from "./empty-state-model.ts"

test("容器处境按固定顺序判定", () => {
  assert.equal(resolveContainerSituation({ loading: true, error: "x", isEmpty: true }), "loading")
  assert.equal(resolveContainerSituation({ forbidden: true, error: "x" }), "forbidden")
  assert.equal(resolveContainerSituation({ unavailable: { description: "d" }, error: "x" }), "unavailable")
  assert.equal(resolveContainerSituation({ error: "x", isEmpty: true }), "error")
  assert.equal(resolveContainerSituation({ isEmpty: true, filtered: true }), "noMatch")
  assert.equal(resolveContainerSituation({ isEmpty: true }), "empty")
  assert.equal(resolveContainerSituation({ filtered: true }), null)
  assert.equal(resolveContainerSituation({ unavailable: null, error: null }), null)
})

const base: EmptyPartsInput = {
  situation: "empty",
  size: "block",
  hasTitle: false,
  hasDescription: false,
  hasError: false,
  hasAction: false,
  hasRetry: false,
  hasClearFilters: false,
}

test("只有大档显示图标", () => {
  assert.equal(resolveEmptyParts({ ...base, size: "block" }).showIcon, true)
  assert.equal(resolveEmptyParts({ ...base, size: "compact" }).showIcon, false)
  assert.equal(resolveEmptyParts({ ...base, size: "inline" }).showIcon, false)
})

test("默认标题与说明按处境取词表", () => {
  assert.equal(resolveEmptyParts(base).titleKey, "shared.noData")
  const noMatch = resolveEmptyParts({ ...base, situation: "noMatch" })
  assert.equal(noMatch.titleKey, "resourceTable.noMatch.title")
  assert.equal(noMatch.descriptionKey, "resourceTable.noMatch.description")
  const forbidden = resolveEmptyParts({ ...base, situation: "forbidden" })
  assert.equal(forbidden.titleKey, "emptyState.forbidden.title")
  assert.equal(forbidden.descriptionKey, "emptyState.forbidden.description")
  assert.equal(resolveEmptyParts({ ...base, hasTitle: true }).titleKey, null)
  assert.equal(resolveEmptyParts({ ...base, situation: "noMatch", hasDescription: true }).descriptionKey, null)
})

test("操作只给 empty、unavailable 与 forbidden（去别处的入口）；noMatch 与 error 忽略 action", () => {
  assert.equal(resolveEmptyParts({ ...base, hasAction: true }).showAction, true)
  assert.equal(resolveEmptyParts({ ...base, situation: "unavailable", hasAction: true }).showAction, true)
  assert.equal(resolveEmptyParts({ ...base, situation: "noMatch", hasAction: true }).showAction, false)
  assert.equal(resolveEmptyParts({ ...base, situation: "forbidden", hasAction: true }).showAction, true)
  assert.equal(resolveEmptyParts({ ...base, situation: "forbidden", hasRetry: true }).showRetry, false)
  assert.equal(resolveEmptyParts({ ...base, situation: "error", hasAction: true }).showAction, false)
})

test("失败给重试、用错误文本作说明、语气为 destructive", () => {
  const p = resolveEmptyParts({ ...base, situation: "error", hasError: true, hasRetry: true })
  assert.equal(p.showRetry, true)
  assert.equal(p.errorAsDescription, true)
  assert.equal(p.tone, "destructive")
  assert.equal(resolveEmptyParts({ ...base, hasRetry: true }).showRetry, false)
})

test("筛没了给清除筛选，行内档不给", () => {
  assert.equal(resolveEmptyParts({ ...base, situation: "noMatch", hasClearFilters: true }).showClearFilters, true)
  assert.equal(
    resolveEmptyParts({ ...base, situation: "noMatch", size: "inline", hasClearFilters: true }).showClearFilters,
    false,
  )
})

test("行内档沿用下拉口径：默认标题「暂无可选项」，只有按钮时省掉标题，不出默认说明", () => {
  assert.equal(resolveEmptyParts({ ...base, size: "inline" }).titleKey, "selectEmpty.title")
  assert.equal(resolveEmptyParts({ ...base, size: "inline", hasAction: true }).titleKey, null)
  assert.equal(resolveEmptyParts({ ...base, size: "inline", situation: "noMatch" }).descriptionKey, null)
  assert.equal(resolveEmptyParts({ ...base, size: "inline", situation: "noMatch" }).titleKey, "selectCombobox.noMatch")
})
