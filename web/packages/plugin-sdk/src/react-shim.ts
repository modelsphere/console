import { readHostSDK } from "./host-global";
// @modelsphere/plugin-sdk — React shim for UMD plugins
// 插件 bundle 里的所有 `import React / react-dom` 都被构建预设 alias 到这里，
// 实际取宿主的 React 实例（单宿主唯一 React，见 ADR 插件模块格式选型）。
//
// 导出面是 React 公开 API 的**完整常用面**，不是"目前被引用到的几个"：
// 少导一个就是构建期 "No matching export" 硬报错 —— 但报在**依赖库**里（recharts 要
// Component / PureComponent，lucide 要 forwardRef），插件作者看到的是一个自己没写过的
// import 挂了。各插件此前各自维护一份 shim 补这个洞（observe 的最全），把 47 份配置
// 收敛到 definePluginConfig 之后（freeland#179），这一份必须是它们的超集。
const R = readHostSDK()?.React as any
if (!R) throw new Error('[modelsphere-plugin-sdk] React not found in __RISE_SDK__ — is this running inside Rise Console?')

export default R
export const {
  // hooks
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useContext,
  useReducer,
  useLayoutEffect,
  useImperativeHandle,
  useDebugValue,
  useId,
  useTransition,
  useDeferredValue,
  useSyncExternalStore,
  useInsertionEffect,
  // 元素与组件
  createElement,
  cloneElement,
  createContext,
  createRef,
  forwardRef,
  memo,
  lazy,
  Suspense,
  Fragment,
  StrictMode,
  Children,
  Component,
  PureComponent,
  isValidElement,
  startTransition,
  version,
} = R
