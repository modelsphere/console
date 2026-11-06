"use client"

// CodeBlock —— 只读的轻量代码块：curl 示例、argv、docker run 命令、几行 YAML 片段。
//
// ── 与 CodeEditor 的分工 ──────────────────────────────────────────────────
// CodeEditor 是 Monaco（2MB+ 运行时 + worker），给一段三行的命令上编辑器不成比例，
// 于是页面各自手搓 `<pre>`（全仓 66 处，深底色值都写死了）。本组件就是那个缺口：
//   要编辑，或者长的结构化内容（要行号 / 折叠 / 校验的 YAML、JSON）→ CodeEditor
//   短的只读片段                                                    → CodeBlock
//   日志                                                            → LogViewer
//
// ── 与 CodeEditor 长得一样，靠的是同一份 token 而不是眼睛核对 ────────────
// 字体 `--font-code`、字号 `--code-font-size`、行高 `--code-line-height`、底色 / 前景 /
// 五种语法色 `--code-*` 都在 tokens 里定一份：Monaco 主题在运行时读它们生成，这里直接
// var() 引用 —— 改一处两边同时变，暗色自然跟随。右上角同一个 CodeToolbar。
//
// ── 高亮只做五类 ──────────────────────────────────────────────────────────
// 注释 / 字符串 / 数字 / 键（YAML、JSON 的 key）/ 关键字（shell 的常用命令与 YAML 布尔）。
// 正则分词，不是解析器：短片段够用，要精确高亮的内容本来就该是 CodeEditor。

import * as React from "react"
import { cn } from "../utils"
import { CodeToolbar } from "./code-toolbar"

export type CodeBlockLanguage = "shell" | "yaml" | "json" | "plaintext" | (string & {})

export interface CodeBlockProps {
  value: string
  /** 默认 shell；plaintext 不高亮 */
  language?: CodeBlockLanguage
  /** 显示行号。默认不显示 —— 短片段不需要，长内容该用 CodeEditor */
  lineNumbers?: boolean
  /** 给了就有「下载」 */
  downloadName?: string
  /** 超过就滚动。默认 `20rem` */
  maxHeight?: string | number
  /** 不要工具栏（极短的行内命令旁边已有复制键时） */
  toolbar?: boolean
  className?: string
}

type Tok = { t: "c" | "s" | "n" | "k" | "w" | "" ; v: string }

const SHELL_WORDS = new Set([
  "curl", "docker", "kubectl", "helm", "python", "python3", "pip", "bash", "sh", "export", "cd", "echo",
  "sudo", "apt", "yum", "npm", "pnpm", "node", "git", "if", "then", "fi", "for", "do", "done", "while",
])

function tokenizeLine(line: string, lang: string): Tok[] {
  if (lang === "plaintext") return [{ t: "", v: line }]
  const out: Tok[] = []
  let i = 0
  const n = line.length
  // 行首缩进原样
  const m0 = /^\s*/.exec(line)!
  if (m0[0]) { out.push({ t: "", v: m0[0] }); i = m0[0].length }
  // YAML / JSON 的键：`key:` / `"key":` / `- key:`
  if (lang === "yaml" || lang === "json") {
    const mk = /^(-\s+)?("[^"]*"|'[^']*'|[A-Za-z0-9_.\-/]+)(\s*:)(?=\s|$)/.exec(line.slice(i))
    if (mk) {
      if (mk[1]) out.push({ t: "", v: mk[1] })
      out.push({ t: "k", v: mk[2] })
      out.push({ t: "", v: mk[3] })
      i += mk[0].length
    }
  }
  while (i < n) {
    const rest = line.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^(#.*|\/\/.*)$/.exec(rest)) && (lang !== "json")) { out.push({ t: "c", v: m[0] }); break }
    if ((m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(rest))) { out.push({ t: "s", v: m[0] }); i += m[0].length; continue }
    if ((m = /^(?<![\w.-])(-?\d+(?:\.\d+)?)(?![\w.-])/.exec(rest))) { out.push({ t: "n", v: m[0] }); i += m[0].length; continue }
    if ((m = /^[A-Za-z_][\w-]*/.exec(rest))) {
      const w = m[0]
      const kw = lang === "shell" ? SHELL_WORDS.has(w) : lang === "yaml" ? /^(true|false|null|yes|no)$/.test(w) : lang === "json" ? /^(true|false|null)$/.test(w) : false
      out.push({ t: kw ? "w" : "", v: w }); i += w.length; continue
    }
    out.push({ t: "", v: rest[0]! }); i += 1
  }
  return out
}

const COLOR: Record<Exclude<Tok["t"], "">, string> = {
  c: "var(--code-comment)",
  s: "var(--code-string)",
  n: "var(--code-number)",
  k: "var(--code-key)",
  w: "var(--code-keyword)",
}

/** 一行的高亮，与 CodeBlock 画法相同。token 拼回去就是原文，所以可以垫在透明 textarea 下面做可编辑的高亮。 */
export function highlightLine(line: string, language: CodeBlockLanguage = "shell"): React.ReactNode[] {
  return tokenizeLine(line, language).map((tok, j) =>
    tok.t ? <span key={j} style={{ color: COLOR[tok.t] }}>{tok.v}</span> : <React.Fragment key={j}>{tok.v}</React.Fragment>,
  )
}

export function CodeBlock({
  value,
  language = "shell",
  lineNumbers = false,
  downloadName,
  maxHeight = "20rem",
  toolbar = true,
  className,
}: CodeBlockProps) {
  const lines = React.useMemo(() => value.replace(/\n$/, "").split("\n"), [value])
  const width = String(lines.length).length
  return (
    <div
      className={cn("relative overflow-hidden rounded-md border border-input", className)}
      style={{ background: "var(--code-bg)", color: "var(--code-fg)" }}
    >
      {toolbar ? <CodeToolbar value={value} downloadName={downloadName} className="absolute top-1.5 right-1.5 z-10" /> : null}
      <pre
        className="m-0 overflow-auto px-3 py-2 font-code whitespace-pre"
        style={{ fontSize: "var(--code-font-size)", lineHeight: "var(--code-line-height)", maxHeight }}
      >
        {lines.map((line, idx) => (
          <div key={idx} className="flex">
            {lineNumbers ? (
              <span
                aria-hidden
                className="mr-3 shrink-0 select-none text-right"
                style={{ color: "var(--code-line-number)", width: `${width}ch` }}
              >
                {idx + 1}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              {highlightLine(line, language)}
              {line === "" ? "​" : null}
            </span>
          </div>
        ))}
      </pre>
    </div>
  )
}
