'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { IconNode, IconRefresh, IconCheck, IconClip, IconTarget } from '../icons'
import { useVault } from '@/lib/vault-store'
import { useRedacted } from '@/lib/redact-context'
import { RetrievalTrace, TraceSummary } from './retrieval-trace'
import type { AiMsg, ChatSource, TraceStage } from './types'

/** Разбирает [1] в тексте на кликабельные сноски. */
function withFootnotes(
  text: string,
  onPick: (n: number) => void,
  onHover: (n: number | null) => void,
  active: number | null,
): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[(\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const n = Number(m[1])
    out.push(
      <button
        key={`fn-${key++}`}
        type="button"
        className={`fn${active === n ? ' is-active' : ''}`}
        onClick={() => onPick(n)}
        onMouseEnter={() => onHover(n)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(n)}
        onBlur={() => onHover(null)}
        aria-label={`Источник ${n}`}
      >
        {n}
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export type LiveState = {
  text: string
  stages: TraceStage[]
  shown: number
  tracing: boolean
  /**
   * Сколько источников этого живого ответа лежит под файловым ключом (п.10.3):
   * трассировка рисует вместо них красакт-строки.
   */
  lockedSources?: number
}

/**
 * Ответ модели. Слева от текста — «хребет происхождения»: по одной засечке на
 * источник. Засечка, сноска в тексте и карточка справа — это один и тот же
 * объект, поэтому наведение подсвечивает всю цепочку сразу.
 */
export function MessageAi({
  msg,
  live,
  activeSource,
  onSource,
  onRegenerate,
  onPinSource,
}: {
  msg: AiMsg
  live?: LiveState
  activeSource: { msgId: string; n: number } | null
  onSource: (msgId: string, n: number) => void
  onRegenerate?: (msgId: string) => void
  onPinSource?: (fileId: string) => void
}) {
  const { viewById } = useVault()
  const { redactIds } = useRedacted()
  const [hover, setHover] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState(false)

  const text = live ? live.text : msg.text
  const streaming = Boolean(live)

  /** п.10.3: источники под ключом не отдают ни цитату, ни упоминание содержимого. */
  const srcLocked = streaming
    ? (live?.lockedSources ?? 0)
    : msg.sources.filter((s) => {
        const f = viewById(s.fileId)
        return Boolean(f && redactIds.has(f.id))
      }).length
  const activeN = activeSource?.msgId === msg.id ? activeSource.n : null
  const lit = hover ?? activeN

  /** Больше ~12 строк текста — сворачиваем, иначе поток перестаёт читаться. */
  const long = text.length > 620
  const clamp = long && !full && !streaming

  const body = useMemo(
    () => withFootnotes(text, (n) => onSource(msg.id, n), setHover, lit),
    [text, lit, msg.id, onSource],
  )

  /** Источник, чей файл ушёл из сейфа, больше не показывается как ссылка. */
  const sources = useMemo(
    () => msg.sources.filter((s) => Boolean(viewById(s.fileId))),
    [msg.sources, viewById],
  )
  const lostSources = msg.sources.length - sources.length

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* буфер недоступен — молча ничего не делаем */
    }
  }

  return (
    <article className={`m-ai${streaming ? ' is-live' : ''}`} aria-label="Ответ локальной модели">
      <header className="m-ai-head">
        <span className="m-ai-mark" aria-hidden="true">
          <IconNode />
        </span>
        <span className="m-ai-who">Локальная модель</span>
        <span className="m-ai-dot" aria-hidden="true" />
        <span className="m-ai-time mono">{msg.time}</span>
        <span className="grow" />
        {streaming && live?.tracing ? <span className="label-mono">ищет…</span> : null}
      </header>

      {streaming && live ? (
        <RetrievalTrace stages={live.stages} shown={live.shown} running lockedSources={srcLocked} />
      ) : null}

      <div className="m-ai-body">
        <div className="spine" aria-hidden={sources.length === 0}>
          {sources.map((s) => (
            <button
              key={s.n}
              type="button"
              className={`spine-tick${lit === s.n ? ' is-lit' : ''}`}
              style={{ opacity: 0.45 + (s.weight / 100) * 0.55 }}
              onClick={() => onSource(msg.id, s.n)}
              onMouseEnter={() => setHover(s.n)}
              onMouseLeave={() => setHover(null)}
              aria-label={`Источник ${s.n}: ${viewById(s.fileId)?.name ?? ''}`}
            >
              <span className="mono">{s.n}</span>
            </button>
          ))}
        </div>

        <div className="m-ai-col">
          {text ? (
            <p className={`m-ai-text${clamp ? ' is-clamped' : ''}`}>
              {body}
              {streaming ? <span className="caret" aria-hidden="true" /> : null}
            </p>
          ) : null}

          {long && !streaming ? (
            <button
              type="button"
              className="m-more"
              onClick={() => setFull((v) => !v)}
              aria-expanded={full}
            >
              {full ? 'Свернуть ответ' : 'Показать полностью'}
            </button>
          ) : null}

          {msg.stopped ? (
            <p className="m-note is-stop">Ответ остановлен вами — показано то, что успело прийти.</p>
          ) : null}

          {!msg.grounded && !streaming ? (
            <p className="m-note is-infer">
              Совпадений в архиве нет. Это вывод модели, а не цитата из файла.
            </p>
          ) : null}

          {lostSources > 0 && !streaming ? (
            <p className="m-note is-infer">
              {lostSources === 1
                ? 'Один источник этого ответа удалён из сейфа — проверить цитату больше нельзя.'
                : `${lostSources} источника этого ответа удалены из сейфа — проверить цитаты больше нельзя.`}
            </p>
          ) : null}

          {!streaming && sources.length ? (
            <SourceStrip
              sources={sources}
              lit={lit}
              onHover={setHover}
              onPick={(n) => onSource(msg.id, n)}
              onPin={onPinSource}
            />
          ) : null}

          {!streaming ? (
            <div className="m-ai-foot">
              <TraceSummary
                stages={msg.stages}
                scanned={msg.scanned}
                picked={msg.picked}
                cited={sources.length}
                ms={msg.ms}
                lockedSources={srcLocked}
              />
              <span className="grow" />
              <button type="button" className="m-act" onClick={copy}>
                {copied ? <IconCheck aria-hidden="true" /> : <IconClip aria-hidden="true" />}
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
              {onRegenerate ? (
                <button type="button" className="m-act" onClick={() => onRegenerate(msg.id)}>
                  <IconRefresh aria-hidden="true" />
                  Переспросить
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/** Полоса источников: имя файла, локатор, вес совпадения. */
function SourceStrip({
  sources,
  lit,
  onHover,
  onPick,
  onPin,
}: {
  sources: ChatSource[]
  lit: number | null
  onHover: (n: number | null) => void
  onPick: (n: number) => void
  onPin?: (fileId: string) => void
}) {
  const { viewById } = useVault()
  return (
    <ul className="src-strip" aria-label="Источники ответа">
      {sources.map((s) => {
        const f = viewById(s.fileId)
        if (!f) return null
        const Icon = f.Icon
        return (
          <li key={s.n}>
            <button
              type="button"
              className={`src-chip${lit === s.n ? ' is-lit' : ''}`}
              onClick={() => onPick(s.n)}
              onMouseEnter={() => onHover(s.n)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="src-n mono">{s.n}</span>
              <Icon aria-hidden="true" />
              <span className="src-name ellipsis">{f.name}</span>
              {s.locator ? <span className="src-loc mono">{s.locator}</span> : null}
              <span className="src-weight mono">{s.weight}%</span>
            </button>
            {onPin ? (
              <button
                type="button"
                className="src-pin"
                onClick={() => onPin(s.fileId)}
                aria-label={`Закрепить ${f.name} в контексте`}
                title="Закрепить в контексте"
              >
                <IconTarget aria-hidden="true" />
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
