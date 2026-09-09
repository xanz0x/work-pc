'use client'

import './chat-markdown.css'
import {
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconCheck, IconClip } from '../icons'

/**
 * Полноценный markdown-рендер ответа модели (react-markdown + remark-gfm):
 * заголовки, списки, таблицы, ссылки, цитаты и блоки кода с подписью языка
 * и кнопкой копирования. Сноски источников [1], [2] остаются кнопками —
 * они проходят отдельной заменой по текстовым узлам, как и раньше.
 * Сырой HTML не рендерится: react-markdown без rehype-raw его выбрасывает.
 */

const FOOTNOTE_RE = /\[(\d+)\]/g

type FootnoteCtx = {
  onPick: (n: number) => void
  onHover: (n: number | null) => void
  active: number | null
}

function FootnoteButton({ n, ctx }: { n: number; ctx: FootnoteCtx }) {
  return (
    <button
      type="button"
      className={`fn${ctx.active === n ? ' is-active' : ''}`}
      onClick={() => ctx.onPick(n)}
      onMouseEnter={() => ctx.onHover(n)}
      onMouseLeave={() => ctx.onHover(null)}
      onFocus={() => ctx.onHover(n)}
      onBlur={() => ctx.onHover(null)}
      aria-label={`Источник ${n}`}
    >
      {n}
    </button>
  )
}

/** Строка → фрагмент, где сноски [n] стали кнопками. */
function footnotesInString(s: string, keyBase: string, ctx: FootnoteCtx): ReactNode[] {
  if (!/\[\d+\]/.test(s)) return [s]
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  FOOTNOTE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FOOTNOTE_RE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(<FootnoteButton key={`${keyBase}-fn-${i++}`} n={Number(m[1])} ctx={ctx} />)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/** Рекурсивный обход дерева React-детей: строки правим, элементы клонируем. */
function augmentFootnotes(nodes: ReactNode, keyBase: string, ctx: FootnoteCtx, depth = 0): ReactNode {
  if (depth > 24 || nodes === null || nodes === undefined || typeof nodes === 'boolean') return nodes
  if (typeof nodes === 'string') return footnotesInString(nodes, keyBase, ctx)
  if (typeof nodes === 'number') return footnotesInString(String(nodes), keyBase, ctx)
  if (Array.isArray(nodes)) {
    return nodes.map((child, i) => augmentFootnotes(child, `${keyBase}-${i}`, ctx, depth + 1))
  }
  if (isValidElement(nodes)) {
    const el = nodes as ReactElement<{ children?: ReactNode }>
    if (el.props.children === undefined || el.props.children === null) return el
    const inner = augmentFootnotes(el.props.children, `${keyBase}-el`, ctx, depth + 1)
    if (inner === el.props.children) return el
    return cloneElement(el, undefined, inner)
  }
  return nodes
}

/** Блок кода: подпись языка + копирование одним щелчком. */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* буфер недоступен — молча ничего не делаем */
    }
  }, [code])
  return (
    <div className="md-code" data-testid="md-code-block">
      <div className="md-code-head">
        <span className="md-code-lang mono">{lang || 'код'}</span>
        <button type="button" className="md-code-copy" onClick={copy} data-testid="md-code-copy">
          {copied ? <IconCheck aria-hidden="true" /> : <IconClip aria-hidden="true" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  /* Блок кода рисует сам CodeBlock: pre остаётся только обёрткой. */
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const raw = String(children ?? '')
    const m = /language-([\w#+-]+)/.exec(className ?? '')
    if (!m && !raw.includes('\n')) return <code className="m-code">{raw}</code>
    return <CodeBlock lang={m?.[1] ?? ''} code={raw.replace(/\n$/, '')} />
  },
  /* Ссылки открываются снаружи; протокол уже отфильтрован react-markdown. */
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
      {children}
    </a>
  ),
}

export function AiMarkdown({
  text,
  onFootnote,
  onHoverFootnote,
  activeFootnote,
}: {
  text: string
  onFootnote?: (n: number) => void
  onHoverFootnote?: (n: number | null) => void
  activeFootnote?: number | null
}) {
  const ctx: FootnoteCtx = {
    onPick: (n) => onFootnote?.(n),
    onHover: (n) => onHoverFootnote?.(n),
    active: activeFootnote ?? null,
  }
  return (
    <div className="md-body" data-testid="md-body">
      {augmentFootnotes(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>,
        'md',
        ctx,
      )}
    </div>
  )
}
