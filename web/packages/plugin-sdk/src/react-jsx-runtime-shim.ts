import { readHostSDK } from "./host-global";
/*
`react/jsx-runtime` 的 shim —— 与 react-shim 同一个目的：让插件 bundle 里所有
对 React 的引用都落到**宿主那一个 React 实例**上。

── 为什么单独一个文件，不能靠 react-shim 兜住 ────────────────────────────

构建预设把 `react` alias 到 react-shim。esbuild 的 alias 是**前缀替换**，于是
`react/jsx-runtime` 会被拼成 `<react-shim.mjs>/jsx-runtime` —— 一个不存在的
路径，报错长这样：

    ✘ Cannot read directory ".../react-shim.mjs": not a directory
    ✘ Could not resolve ".../react-shim.mjs/jsx-runtime" (originally "react/jsx-runtime")

而**现在发布的库大多编译到 automatic runtime**（`import {jsx} from
'react/jsx-runtime'`，不再是 `React.createElement`），react-markdown 就是。
所以少了这一个 alias，这类库一个都进不了插件 bundle，而错误信息指向的是
依赖库里的一行 import，插件作者根本不知道从哪查起 —— 与 react-shim 文件头
记的那个「报在依赖库里」是同一类坑。

── 为什么用 createElement 实现，而不是转发宿主的 jsx-runtime ─────────────

宿主通过 `window.__RISE_SDK__.React` 暴露的是 React 主入口，**没有**
jsx-runtime 那个子模块。而 automatic runtime 的语义可以用 createElement 完整
表达（下面三行就是全部），所以自己实现比要求宿主再多暴露一个入口简单得多，
也不用两边同步版本。
*/
const host = readHostSDK()
const R = host?.React as any
if (!R) throw new Error('[modelsphere-plugin-sdk] React not found in __RISE_SDK__ — is this running inside Rise Console?')

export const Fragment = R.Fragment

/**
 * automatic runtime 的 `jsx(type, config, maybeKey)`。
 *
 * 与 createElement 的差别只有两点：children 在 config 里（不是尾随参数），
 * key 单独作为第三个参数传。`createElement(type, props)` 本来就会把 config 里的
 * children 原样收进 props，把 key 从 props 里摘出来 —— 所以直接转发即可。
 */
function jsxImpl(type: any, config: any, maybeKey?: any) {
  if (maybeKey === undefined) return R.createElement(type, config)
  return R.createElement(type, { ...config, key: maybeKey })
}

const runtime = host?.ReactJSXRuntime as { jsx?: typeof jsxImpl; jsxs?: typeof jsxImpl } | undefined
export const jsx = runtime?.jsx ?? jsxImpl
// jsxs 只是「children 已知是数组」的版本，语义与 jsx 相同。
export const jsxs = runtime?.jsxs ?? jsxImpl
// 开发态入口。构建预设把 NODE_ENV 定成 production，正常走不到这里；
// 导出它是为了别在某个库显式 import 时炸成 "No matching export"。
export const jsxDEV = (host?.ReactJSXDevRuntime as { jsxDEV?: typeof jsxImpl } | undefined)?.jsxDEV ?? jsxImpl
