'use client'

import './cloud-viewer.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCheck,
  IconClip,
  IconClose,
  IconDetails,
  IconDoc,
  IconDocPreview,
  IconExternal,
  IconFolder,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconScale,
  IconTag,
} from './icons'
import { AiMarkdown } from './chat/markdown'
import { originalFor } from '@/lib/indexer/originals'
import { fmtBytes } from '@/lib/data'

/**
 * Просмотрщик файлов библиотеки: большую часть форматов человек читает
 * не выходя из программы. Текст и код — читаемо, markdown — отрендеренный,
 * PDF и картинки — встроенно (картинка с зумом и поворотом), .docx —
 * разметкой с сервера, аудио и видео — плеером, ZIP — списком записей.
 * Справа — паспорт файла: что сказал о нём ИИ-архивариус, метки, размер
 * и путь в папке хранения.
 */

/** Контракт моста desktop-приложения. */
type WorkspaceXBridge = {
  openExternal?: (url: string) => void
  revealInExplorer?: (absPath: string) => void
  openPath?: (absPath: string) => void
}

const bridge = (): WorkspaceXBridge | undefined => {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { workspacexDesktop?: WorkspaceXBridge }).workspacexDesktop
}

export type LibraryViewerTarget = {
  /** Локальный id файла в сейфе. */
  id: string
  name: string
  bytes?: number
  /** id объекта на общем диске: байты идут через /ai-api/cloud/file/[id]. */
  cloudId?: string | null
  /** Абсолютный путь на ПК — только из метаданных, заполняется мостом. */
  absPath?: string | null
  /** Что сказал о файле ИИ-архивариус. */
  description?: string
  tags?: string[]
  analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
  /** Имя файла на диске, если в библиотеке показано название от ИИ. */
  fileName?: string
}

type Kind = 'image' | 'pdf' | 'md' | 'text' | 'zip' | 'audio' | 'video' | 'docx' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  image: 'изображение',
  pdf: 'pdf',
  md: 'markdown',
  text: 'текст',
  zip: 'архив',
  audio: 'аудио',
  video: 'видео',
  docx: 'документ word',
  other: 'файл',
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const MD_RE = /\.(md|markdown|mdown)$/i
const TEXT_RE =
  /\.(txt|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|php|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cs|sh|bash|zsh|bat|cmd|ps1|sql|graphql|gitignore|dockerfile|makefile|lock)$/i
const ZIP_RE = /\.zip$/i
const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a)$/i
const VIDEO_RE = /\.(mp4|webm|mov|mkv)$/i
const DOCX_RE = /\.(docx|docm)$/i

const TEXT_PREVIEW_LIMIT = 512 * 1024

function kindOf(name: string): Kind {
  if (IMAGE_RE.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (MD_RE.test(name)) return 'md'
  if (DOCX_RE.test(name)) return 'docx'
  if (ZIP_RE.test(name)) return 'zip'
  if (AUDIO_RE.test(name)) return 'audio'
  if (VIDEO_RE.test(name)) return 'video'
  if (TEXT_RE.test(name)) return 'text'
  return 'other'
}

/** Текстовые записи архива можно показать прямо в просмотрщике. */
const entryIsText = (name: string): boolean =>
  /\.(txt|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|js|mjs|jsx|ts|tsx|py|rb|php|java|go|rs|c|h|cpp|cs|sh|sql|md|markdown)$/i.test(name)

type ZipEntry = { name: string; dir: boolean; size: number }
type EntryView = { name: string; text: string; truncated: boolean }

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export function LibraryViewer({
  target,
  onClose,
}: {
  target: LibraryViewerTarget
  onClose: () => void
}) {
  const kind = useMemo(() => kindOf(target.fileName || target.name), [target.fileName, target.name])
  const [loading, setLoading] = useState(true)
  const [fail, setFail] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<{ body: string; truncated: boolean } | null>(null)
  const [docHtml, setDocHtml] = useState<string | null>(null)
  const [entries, setEntries] = useState<ZipEntry[] | null>(null)
  const [entriesTruncated, setEntriesTruncated] = useState(false)
  const [entryView, setEntryView] = useState<EntryView | null>(null)
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryFail, setEntryFail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [info, setInfo] = useState(true)
  const [zoom, setZoom] = useState(3)
  const [rotate, setRotate] = useState(0)
  const [fit, setFit] = useState(true)
  const urlRef = useRef<string | null>(null)

  const desktop = useMemo(() => bridge(), [])
  const absPath = target.absPath?.trim() || null
  const bridgeReady = Boolean(desktop && (desktop.openPath || desktop.revealInExplorer))

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const setBlobUrl = useCallback(
    (blob: Blob) => {
      revoke()
      const u = URL.createObjectURL(blob)
      urlRef.current = u
      setUrl(u)
    },
    [revoke],
  )

  /** Байты объекта: общий диск через объектный роут, локальный — из оригинала. */
  const fetchBlob = useCallback(async (): Promise<Blob> => {
    if (target.cloudId) {
      const res = await fetch(`/ai-api/cloud/file/${encodeURIComponent(target.cloudId)}?inline=1`)
      if (!res.ok) throw new Error('Объект недоступен на общем диске.')
      return res.blob()
    }
    const file = await originalFor(target.id)
    if (!file) throw new Error('NO_ORIGINAL')
    return file
  }, [target.cloudId, target.id])

  const load = useCallback(async () => {
    setLoading(true)
    setFail(null)
    setEntryView(null)
    setEntryFail(null)
    setText(null)
    setDocHtml(null)
    setEntries(null)
    try {
      if (kind === 'zip') {
        if (!target.cloudId) {
          /* Распаковка живёт на сервере (adm-zip): локальному архиву нужен общий диск. */
          setEntries([])
          setLoading(false)
          return
        }
        const res = await fetch('/ai-api/cloud/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectId: target.cloudId }),
        })
        if (!res.ok) throw new Error('Архив не прочитан.')
        const j = (await res.json()) as { entries?: ZipEntry[]; truncated?: boolean }
        setEntries(j.entries ?? [])
        setEntriesTruncated(j.truncated === true)
      } else if (kind === 'docx') {
        if (!target.cloudId) throw new Error('Предпросмотр Word работает для файлов в папке хранения.')
        const res = await fetch('/ai-api/cloud/docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectId: target.cloudId }),
        })
        const j = (await res.json()) as { html?: string; error?: string }
        if (!res.ok) throw new Error(j.error ?? 'Документ не прочитан.')
        setDocHtml(j.html ?? '')
      } else if (kind === 'text' || kind === 'md') {
        const blob = await fetchBlob()
        const buf = await blob.slice(0, TEXT_PREVIEW_LIMIT).arrayBuffer()
        const body = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '')
        setText({ body, truncated: blob.size > TEXT_PREVIEW_LIMIT })
      } else if (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video') {
        setBlobUrl(await fetchBlob())
      }
      /* kind === 'other' показывается без загрузки байтов. */
    } catch (e) {
      setFail(
        e instanceof Error && e.message === 'NO_ORIGINAL'
          ? 'Оригинала нет на этом устройстве: подключите папку заново или добавьте файл в библиотеку.'
          : e instanceof Error
            ? e.message
            : 'Не удалось прочитать файл.',
      )
    } finally {
      setLoading(false)
    }
  }, [kind, fetchBlob, setBlobUrl, target.cloudId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (kind !== 'image') return
      if (e.key === '+' || e.key === '=') {
        setFit(false)
        setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))
      }
      if (e.key === '-') {
        setFit(false)
        setZoom((z) => Math.max(0, z - 1))
      }
      if (e.key.toLowerCase() === 'r') setRotate((r) => (r + 90) % 360)
      if (e.key.toLowerCase() === 'f') setFit((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      revoke()
    }
  }, [onClose, revoke, kind])

  /** Извлечение выбранной записи архива: текст — в просмотрщик, остальное — на диск. */
  const openEntry = useCallback(
    async (entry: ZipEntry) => {
      if (!target.cloudId || entry.dir) return
      setEntryFail(null)
      setEntryBusy(true)
      try {
        const res = await fetch('/ai-api/cloud/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectId: target.cloudId, entry: entry.name }),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'Запись не извлечена.')
        }
        const blob = await res.blob()
        const base = entry.name.split('/').pop() || entry.name
        if (entryIsText(entry.name)) {
          const body = new TextDecoder('utf-8').decode(await blob.slice(0, TEXT_PREVIEW_LIMIT).arrayBuffer())
          setEntryView({ name: entry.name, text: body, truncated: blob.size > TEXT_PREVIEW_LIMIT })
        } else {
          const u = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = u
          a.download = base
          a.click()
          setTimeout(() => URL.revokeObjectURL(u), 4000)
          setEntryView(null)
        }
      } catch (e) {
        setEntryFail(e instanceof Error ? e.message : 'Запись не извлечена.')
        setEntryView(null)
      } finally {
        setEntryBusy(false)
      }
    },
    [target.cloudId],
  )

  const copyText = useCallback(async () => {
    const body = text?.body ?? (docHtml ? docHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '')
    if (!body) return
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* буфер недоступен — молча ничего не делаем */
    }
  }, [docHtml, text])

  const openOnPc = useCallback(() => {
    if (!desktop?.openPath || !absPath) return
    desktop.openPath(absPath)
  }, [desktop, absPath])

  const reveal = useCallback(() => {
    if (!desktop?.revealInExplorer || !absPath) return
    desktop.revealInExplorer(absPath)
  }, [desktop, absPath])

  const bridgeTitle = !bridgeReady
    ? 'Доступно в приложении для Windows'
    : absPath
      ? undefined
      : 'Выберите папку хранения в настройках диска'
  const downloadHref = target.cloudId ? `/ai-api/cloud/file/${encodeURIComponent(target.cloudId)}` : (url ?? undefined)
  const fileName = target.fileName || target.name

  const imageStyle = fit
    ? { transform: `rotate(${rotate}deg)`, maxWidth: '100%', maxHeight: '100%' }
    : { transform: `scale(${ZOOM_STEPS[zoom]}) rotate(${rotate}deg)`, maxWidth: 'none', maxHeight: 'none' }

  return (
    <div className="cloud-viewer" role="dialog" aria-modal="true" data-testid="cloud-viewer" onClick={onClose}>
      <div className={`cloud-viewer-panel${info ? ' has-info' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="cloud-viewer-head">
          <span className="lv-kind" data-kind={kind}>
            {KIND_LABEL[kind]}
          </span>
          <span className="lv-title">
            <b className="ellipsis" title={target.name}>
              {target.name}
            </b>
            {target.fileName && target.fileName !== target.name && (
              <span className="lv-file mono ellipsis" title={target.fileName}>
                {target.fileName}
              </span>
            )}
          </span>
          {target.bytes ? <span className="mono lv-size">{fmtBytes(target.bytes)}</span> : null}
          <span className="grow" />

          {kind === 'image' && (
            <span className="lv-tools" data-testid="lv-image-tools">
              <button
                type="button"
                className="lv-tool"
                onClick={() => {
                  setFit(false)
                  setZoom((z) => Math.max(0, z - 1))
                }}
                title="Уменьшить (−)"
                data-testid="lv-zoom-out"
              >
                <IconMinus />
              </button>
              <span className="lv-zoom num" data-testid="lv-zoom-value">
                {fit ? 'по окну' : `${Math.round(ZOOM_STEPS[zoom] * 100)}%`}
              </span>
              <button
                type="button"
                className="lv-tool"
                onClick={() => {
                  setFit(false)
                  setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))
                }}
                title="Увеличить (+)"
                data-testid="lv-zoom-in"
              >
                <IconPlus />
              </button>
              <button type="button" className={`lv-tool${fit ? ' on' : ''}`} onClick={() => setFit((v) => !v)} title="Вписать в окно (F)" data-testid="lv-fit">
                <IconScale />
              </button>
              <button type="button" className="lv-tool" onClick={() => setRotate((r) => (r + 90) % 360)} title="Повернуть (R)" data-testid="lv-rotate">
                <IconRefresh />
              </button>
            </span>
          )}

          <button
            type="button"
            className={`btn btn-ghost btn-sm${info ? ' is-on' : ''}`}
            onClick={() => setInfo((v) => !v)}
            title="Паспорт файла и разбор ИИ"
            data-testid="lv-info-toggle"
          >
            <IconDetails />
            Паспорт
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={openOnPc}
            disabled={!bridgeReady || !absPath}
            title={bridgeTitle ?? 'Открыть файл в программе по умолчанию'}
            data-testid="lv-open-pc"
          >
            <IconExternal />
            Открыть на ПК
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={reveal}
            disabled={!bridgeReady || !absPath}
            title={bridgeTitle ?? 'Показать файл в проводнике'}
            data-testid="lv-reveal"
          >
            <IconFolder />
            В папке
          </button>
          <a
            className={`btn btn-ghost btn-sm${downloadHref ? '' : ' is-off'}`}
            href={downloadHref}
            download={target.cloudId ? undefined : fileName}
            data-testid="cloud-viewer-download"
            aria-disabled={downloadHref ? undefined : true}
            onClick={(e) => {
              if (!downloadHref) e.preventDefault()
            }}
          >
            <IconExternal />
            Скачать
          </a>
          <button className="lv-x" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)" data-testid="cloud-viewer-close">
            <IconClose />
          </button>
        </div>

        <div className="cloud-viewer-main">
          <div className={`cloud-viewer-body${kind === 'image' && !fit ? ' is-scroll' : ''}`} data-testid="lv-body">
            {loading ? (
              <div className="lv-skeleton" aria-label="Загрузка предпросмотра">
                <span className="lv-sk-line w40" />
                <span className="lv-sk-line w90" />
                <span className="lv-sk-line w80" />
                <span className="lv-sk-line w90" />
                <span className="lv-sk-line w60" />
              </div>
            ) : fail ? (
              <div className="lv-empty" data-testid="lv-error">
                <IconDocPreview width={40} height={40} stroke="currentColor" strokeWidth={1.2} />
                <p>{fail}</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} data-testid="lv-retry">
                  <IconRefresh />
                  Повторить
                </button>
              </div>
            ) : kind === 'image' && url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={target.name} style={imageStyle} className="lv-img" data-testid="lv-image" />
            ) : kind === 'pdf' && url ? (
              <iframe title={target.name} src={url} data-testid="lv-pdf" />
            ) : kind === 'audio' && url ? (
              <div className="lv-media">
                <audio controls src={url} data-testid="lv-audio" />
              </div>
            ) : kind === 'video' && url ? (
              <video controls src={url} data-testid="lv-video" />
            ) : kind === 'docx' && docHtml !== null ? (
              <div className="lv-doc">
                <div className="lv-doc-bar">
                  <span className="label-mono">документ word · разметка сохранена</span>
                  <span className="grow" />
                  <button type="button" className="m-act" onClick={() => void copyText()} data-testid="lv-copy">
                    {copied ? <IconCheck aria-hidden="true" /> : <IconClip aria-hidden="true" />}
                    {copied ? 'Скопировано' : 'Копировать текст'}
                  </button>
                </div>
                {docHtml.trim() ? (
                  <div className="lv-docx" data-testid="lv-docx" dangerouslySetInnerHTML={{ __html: docHtml }} />
                ) : (
                  <p className="lv-empty-note">Документ пуст или состоит только из картинок.</p>
                )}
              </div>
            ) : (kind === 'text' || kind === 'md') && text ? (
              <div className="lv-doc">
                <div className="lv-doc-bar">
                  <span className="label-mono">{text.truncated ? 'показано начало файла' : KIND_LABEL[kind]}</span>
                  <span className="grow" />
                  {kind === 'text' && (
                    <button type="button" className="m-act" onClick={() => setWrap((v) => !v)} data-testid="lv-wrap">
                      {wrap ? 'Не переносить строки' : 'Переносить строки'}
                    </button>
                  )}
                  <button type="button" className="m-act" onClick={() => void copyText()} data-testid="lv-copy">
                    {copied ? <IconCheck aria-hidden="true" /> : <IconClip aria-hidden="true" />}
                    {copied ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
                {kind === 'md' ? (
                  <div className="lv-md" data-testid="lv-md">
                    <AiMarkdown text={text.body} />
                  </div>
                ) : (
                  <pre className={`lv-code mono${wrap ? ' is-wrap' : ''}`} data-testid="lv-code">
                    {text.body}
                  </pre>
                )}
              </div>
            ) : kind === 'zip' ? (
              target.cloudId && entries ? (
                <div className="lv-zip" data-testid="lv-zip">
                  <div className="lv-doc-bar">
                    <span className="label-mono">
                      содержимое архива · {entries.length}
                      {entriesTruncated ? '+' : ''}
                    </span>
                  </div>
                  {entries.length === 0 ? (
                    <p className="lv-empty-note">Архив пуст.</p>
                  ) : (
                    <ul className="lv-entries">
                      {entries.map((en) => (
                        <li key={en.name}>
                          {en.dir ? (
                            <span className="lv-entry is-dir" title={en.name}>
                              <IconFolder aria-hidden="true" />
                              <span className="ellipsis">{en.name}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="lv-entry"
                              onClick={() => void openEntry(en)}
                              disabled={entryBusy}
                              title={entryIsText(en.name) ? 'Показать содержимое' : 'Скачать файл из архива'}
                              data-testid="lv-entry"
                            >
                              <IconDoc aria-hidden="true" />
                              <span className="ellipsis">{en.name}</span>
                              <span className="mono lv-entry-size">{fmtBytes(en.size)}</span>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {entryBusy ? (
                    <p className="lv-empty-note" data-testid="lv-entry-busy">
                      Извлекаю…
                    </p>
                  ) : null}
                  {entryFail ? (
                    <p className="lv-empty-note is-err" data-testid="lv-entry-error">
                      {entryFail}
                    </p>
                  ) : null}
                  {entryView ? (
                    <div className="lv-entry-view" data-testid="lv-entry-view">
                      <div className="lv-doc-bar">
                        <span className="mono ellipsis">{entryView.name}</span>
                      </div>
                      <pre className="lv-code mono">{entryView.text}</pre>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="lv-empty" data-testid="lv-zip-local">
                  <IconDocPreview width={40} height={40} stroke="currentColor" strokeWidth={1.2} />
                  <p>Просмотр ZIP-архива работает для файлов общего диска: распаковка выполняется на сервере.</p>
                  <p className="lv-empty-sub">Локальный архив можно открыть на ПК или опубликовать на общем диске.</p>
                </div>
              )
            ) : (
              <div className="lv-empty" data-testid="lv-unsupported">
                <IconDoc width={40} height={40} stroke="currentColor" strokeWidth={1.2} />
                <p>Этот формат браузер не показывает — файл можно скачать или открыть программой на ПК.</p>
                <p className="lv-empty-sub">
                  {target.bytes ? `Размер: ${fmtBytes(target.bytes)} · ` : ''}
                  разбор ИИ виден в паспорте справа.
                </p>
                {desktop && absPath ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={openOnPc}>
                    <IconExternal />
                    Открыть на ПК
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {info && (
            <aside className="lv-info" data-testid="lv-info">
              <div className="lv-info-block">
                <span className="label-mono">Название от ИИ</span>
                <p className="lv-info-title">{target.name}</p>
              </div>
              <div className="lv-info-block">
                <span className="label-mono">Что это</span>
                <p>
                  {target.description?.trim() ||
                    (target.analysisStatus === 'queued'
                      ? 'ИИ читает файл — описание появится здесь.'
                      : 'Описания пока нет. Подключите модель в настройках и добавьте файл заново.')}
                </p>
              </div>
              {target.tags && target.tags.length > 0 && (
                <div className="lv-info-block">
                  <span className="label-mono">Метки</span>
                  <div className="lv-info-tags">
                    {target.tags.map((t) => (
                      <span key={t} className="lv-info-tag">
                        <IconTag width={10} height={10} aria-hidden="true" />
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="lv-info-block">
                <span className="label-mono">Файл</span>
                <p className="mono lv-info-mono">{fileName}</p>
                {target.bytes ? <p className="mono lv-info-mono">{fmtBytes(target.bytes)}</p> : null}
                {absPath ? (
                  <p className="mono lv-info-mono" title={absPath}>
                    {absPath}
                  </p>
                ) : (
                  <p className="lv-info-dim">Папка хранения не выбрана — файл лежит во внутреннем хранилище.</p>
                )}
              </div>
              {target.analysisStatus && (
                <div className="lv-info-block">
                  <span className="label-mono">Разбор</span>
                  <p className={`lv-info-state is-${target.analysisStatus}`}>
                    {target.analysisStatus === 'done'
                      ? 'выполнен'
                      : target.analysisStatus === 'partial'
                        ? 'выполнен частично'
                        : target.analysisStatus === 'queued'
                          ? 'в очереди'
                          : 'не удался'}
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
