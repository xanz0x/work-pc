'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { IconNode, IconRefresh, IconCheck, IconClip, IconTarget } from '../icons'
import { useVault } from '@/lib/vault-store'
import { useRedacted } from '@/lib/redact-context'
import { RetrievalTrace, TraceSummary } from './retrieval-trace'
import { ToolCards } from './tool-card'
import { describeAiError } from '@/lib/ai-errors'
import type { AiMsg, ChatSource, TraceStage } from './types'

/** Инлайновая разметка строки: сноски [1], **выделение**, `код`. */
function renderInline(
  line: string,
  keyBase: string,
  onPick: (n: number) => void,
  onHover: (n: number | null) => void,
  active: number | null,
): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[(\d+)\]|\*\*([^*]+?)\*\*|`([^`]+?)`/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[1]) {
      const n = Number(m[1])
      out.push(
        <button
          key={`${keyBase}-fn-${key++}`}
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
    } else if (m[2] !== undefined) {
      out.push(<strong key={`${keyBase}-b-${key++}`}>{m[2]}</strong>)
    } else if (m[3] !== undefined) {
      out.push(
        <code key={`${keyBase}-c-${key++}`} className="m-code">
          {m[3]}
        </code>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** Лёгкая разметка ответа: строки, списки через дефис, сноски, выделение. */
function withFootnotes(
  text: string,
  onPick: (n: number) => void,
  onHover: (n: number | null) => void,
  active: number | null,
): ReactNode[] {
  return text.split('\n').map((ln, i) => {
    const bullet = /^\s*[-•*]\s+/.test(ln)
    const clean = bullet ? ln.replace(/^\s*[-•*]\s+/, '') : ln
    return (
      /* eslint-disable-next-line react/no-array-index-key -- строки статичны в рамках текста */
      <span key={`ln-${i}`} className={`m-line${bullet ? ' is-li' : ''}${clean.trim() ? '' : ' is-gap'}`}>
        {renderInline(clean, `ln-${i}`, onPick, onHover, active)}
      </span>
    )
  })
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
  onAllow,
  onDeny,
  onOpenFile,
}: {
  msg: AiMsg
  live?: LiveState
  activeSource: { msgId: string; n: number } | null
  onSource: (msgId: string, n: number) => void
  onRegenerate?: (msgId: string) => void
  onPinSource?: (fileId: string) => void
  onAllow?: () => void
  onDeny?: () => void
  onOpenFile?: (fileId: string) => void
}) {
  const { viewById, engineView, openSetting } = useVault()
  const { redactIds } = useRedacted()
  const [hover, setHover] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState(false)

  const text = live ? live.text : msg.text
  const streaming = Boolean(live)

  /* UX-1: автор берётся из фактического источника хода, а не из настройки. */
  const viaCloud = streaming ? engineView.isCloud : (msg.via ?? (engineView.isCloud ? 'cloud' : 'local')) === 'cloud'
  const author = viaCloud ? `${engineView.model} · облако` : 'Локальная модель'
  const failure = !streaming && (msg.errorCode || msg.error) ? describeAiError(msg.errorCode) : null

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
    <article className={`m-ai${streaming ? ' is-live' : ''}`} aria-label={`Ответ: ${author}`}>
      <header className="m-ai-head">
        <span className="m-ai-mark" aria-hidden="true">
          <IconNode />
        </span>
        <span className="m-ai-who" data-testid="ai-author">
          {author}
        </span>
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
          {msg.tools?.length ? (
            <ToolCards tools={msg.tools} onAllow={onAllow} onDeny={onDeny} onOpenFile={onOpenFile} />
          ) : null}
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

          {failure ? (
            <div className="m-err" data-testid="ai-error-note">
              <p className="m-err-title">{failure.title}</p>
              <p className="m-err-hint">{failure.hint}</p>
              <div className="m-err-acts">
                {failure.code === 'AUTH_REQUIRED' ? (
                  <a className="btn btn-primary btn-sm" href="/login" data-testid="ai-error-login">
                    Войти
                  </a>
                ) : null}
                {failure.code === 'ENGINE_NOT_CONFIGURED' ? (
                  <button
                    type="button"
                    className="btn btn-tertiary btn-sm"
                    onClick={() => openSetting('engine')}
                    data-testid="ai-error-engine"
                  >
                    Сменить движок
                  </button>
                ) : null}
                {onRegenerate ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onRegenerate(msg.id)}
                    data-testid="ai-error-retry"
                  >
                    <IconRefresh aria-hidden="true" />
                    Повторить
                  </button>
                ) : null}
                <span className="m-err-code mono">код {failure.code}</span>
              </div>
            </div>
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
