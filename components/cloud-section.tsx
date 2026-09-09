'use client'

/* ============================================================
   РАЗДЕЛ НАСТРОЕК «ОБЩЕЕ ОБЛАКО»
   Управление общим диском: приглашение по коду, загрузка файлов и
   папки. САМИ файлы здесь не показываются — они появляются в
   «Библиотеке» и на «Карте» с пометкой «общий диск». Удалять файл
   можно из инспектора файла в библиотеке.
   ============================================================ */

import './cloud-section.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheck,
  IconChevronLeft,
  IconClose,
  IconCopy,
  IconDatabase,
  IconExternal,
  IconFolder,
  IconKey,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconTrash,
} from './icons'
import { useToast } from '@/lib/vault-store'

type DriveView = {
  isAdmin: boolean
  member: boolean
  inviteCode?: string
  membersCount?: number
  /** Папка хранения на ПК (пусто — внутреннее хранилище). */
  storageRoot?: string | null
  folders: string[]
}

/** Отчёт о переносе существующих файлов в выбранную папку (PUT storage-root). */
type MigrationReport = { copied: number; failed: number; errors: string[] }

/** Мост Electron-обёртки: методы появляются по мере реализации desktop-части. */
type WorkSpaceXDesktopBridge = {
  openExternal?: (url: string) => void
  revealInExplorer?: (absPath: string) => void
  openPath?: (absPath: string) => void
  /** Нативный диалог выбора папки: путь или null (отменено). */
  pickFolder?: (current?: string | null) => Promise<string | null>
}

declare global {
  interface Window {
    workspacexDesktop?: WorkSpaceXDesktopBridge
  }
}

type AnalysisState = 'analyzing' | 'done' | 'partial' | 'failed'

/** Ответ GET /ai-api/analyze?objectId=… (контракт конвейера анализа). */
type AnalyzeStatus = {
  status?: string
  title?: string
  description?: string
  error?: string
}

/** Строка статуса анализа для недавно загруженного файла. */
type UploadTrack = {
  id: string
  name: string
  state: AnalysisState
  title?: string
  description?: string
  error?: string
}

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
const nameOf = (p: string) => p.split('/').slice(-1)[0]

const ANALYZE_POLL_MS = 1500
const ANALYZE_POLL_ATTEMPTS = 60
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`/ai-api/cloud${path}`, { cache: 'no-store', ...init })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error || `Ошибка ${r.status}`)
  return body
}

/** Сообщаем библиотеке/карте, что состав общего диска изменился. */
const notifyChanged = () => window.dispatchEvent(new Event('wsx:cloud-changed'))

export function CloudSection() {
  const { flash } = useToast()
  const [data, setData] = useState<DriveView | null>(null)
  const [loading, setLoading] = useState(true)
  const [dir, setDir] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploads, setUploads] = useState<UploadTrack[]>([])
  /** Фолбэк выбора папки без моста: ручной ввод пути (window.prompt в Electron всегда null). */
  const [showManualRoot, setShowManualRoot] = useState(false)
  const [manualRoot, setManualRoot] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData((await api('')) as DriveView)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function join() {
    if (!joinCode.trim()) return
    setBusy(true)
    try {
      await api('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: joinCode.trim() }) })
      flash('Вы подключены к общему облаку')
      setJoinCode('')
      await load()
      notifyChanged()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    setBusy(true)
    try {
      const r = (await api('/invite', { method: 'POST' })) as { inviteCode: string }
      setData((d) => (d ? { ...d, inviteCode: r.inviteCode } : d))
      flash('Код-приглашение обновлён')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось обновить код')
    } finally {
      setBusy(false)
    }
  }

  /** Запустить анализ загруженного файла и тянуть статус до результата. */
  async function trackAnalysis(objectId: string, name: string) {
    setUploads((u) => [...u.filter((x) => x.id !== objectId), { id: objectId, name, state: 'analyzing' }])
    try {
      const r = await fetch('/ai-api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
        cache: 'no-store',
      })
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string }
        const error = b.error || `Анализ недоступен (ошибка ${r.status})`
        setUploads((u) => u.map((x) => (x.id === objectId ? { ...x, state: 'failed', error } : x)))
        return
      }
    } catch {
      setUploads((u) => u.map((x) => (x.id === objectId ? { ...x, state: 'failed', error: 'Анализ недоступен: сервер не отвечает' } : x)))
      return
    }
    for (let i = 0; i < ANALYZE_POLL_ATTEMPTS; i++) {
      await sleep(ANALYZE_POLL_MS)
      let s: AnalyzeStatus | null = null
      try {
        const r = await fetch(`/ai-api/analyze?objectId=${encodeURIComponent(objectId)}`, { cache: 'no-store' })
        s = r.ok ? ((await r.json()) as AnalyzeStatus) : null
      } catch {
        s = null
      }
      const status = s?.status
      if (status === 'done' || status === 'partial' || status === 'failed') {
        setUploads((u) =>
          u.map((x) =>
            x.id === objectId
              ? { ...x, state: status as AnalysisState, title: s?.title, description: s?.description, error: s?.error }
              : x,
          ),
        )
        notifyChanged() // в библиотеке появятся название и описание файла
        return
      }
    }
    setUploads((u) => u.map((x) => (x.id === objectId ? { ...x, state: 'failed', error: 'Анализ длится дольше ожидаемого — попробуйте ещё раз' } : x)))
  }

  async function onUpload(files: FileList | null) {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    setBusy(true)
    try {
      for (const f of list) {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('dir', dir)
        const saved = (await api('/upload', { method: 'POST', body: fd })) as { file?: { id: string; name: string } }
        if (saved?.file?.id) void trackAnalysis(saved.file.id, saved.file.name || f.name)
      }
      flash(list.length === 1 ? `Загружен «${list[0].name}» — ищите его в Библиотеке` : `Загружено файлов: ${list.length} — они в Библиотеке`)
      notifyChanged()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Загрузка не удалась')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Задать/изменить/очистить папку хранения. Пустой путь — отключить
   * (прежнее поведение). При migrate:true сервер после выбора папки
   * переносит в неё все существующие файлы и возвращает отчёт.
   */
  async function changeRoot(nextRoot: string, migrate: boolean, successNote: (root: string | null) => string) {
    setBusy(true)
    try {
      const r = (await api('/storage-root', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: nextRoot, ...(nextRoot && migrate ? { migrate: true } : {}) }),
      })) as { root: string | null; migrated?: MigrationReport }
      setData((d) => (d ? { ...d, storageRoot: r.root } : d))
      setShowManualRoot(false)
      setManualRoot('')
      const m = r.migrated
      if (r.root && m) {
        flash(
          m.failed > 0
            ? `Папка выбрана. Перенесено файлов: ${m.copied}, не удалось: ${m.failed} (${m.errors[0] ?? 'см. журнал'})`
            : `Папка выбрана. Существующие файлы перенесены: ${m.copied}`,
        )
      } else {
        flash(successNote(r.root))
      }
      notifyChanged()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось изменить папку хранения')
    } finally {
      setBusy(false)
    }
  }

  const rootNote = (root: string | null) =>
    root ? `Файлы будут сохраняться в «${root}»` : 'Папка хранения отключена — файлы снова идут во внутреннее хранилище'

  async function pickRoot() {
    /* Нативный диалог — через мост рабочего стола: window.prompt в
       Electron возвращает null, поэтому он больше не используется. */
    const pick = window.workspacexDesktop?.pickFolder
    if (typeof pick === 'function') {
      setBusy(true)
      let picked: string | null = null
      try {
        picked = await pick(data?.storageRoot ?? null)
      } finally {
        setBusy(false)
      }
      if (!picked || !picked.trim()) return // диалог отменён — ничего не меняем
      await changeRoot(picked.trim(), true, rootNote)
      return
    }
    /* Фолбэк (браузер без моста): ручной ввод пути в поле. */
    setManualRoot(data?.storageRoot ?? '')
    setShowManualRoot(true)
  }

  async function submitManualRoot() {
    await changeRoot(manualRoot.trim(), true, rootNote)
  }

  function openStorageFolder(root: string) {
    // Мост рабочего стола появится позже — зовём через optional chaining.
    const bridge = window.workspacexDesktop
    if (typeof bridge?.revealInExplorer === 'function') bridge.revealInExplorer(root)
    else flash('Открыть папку можно из приложения WorkSpaceX на ПК')
  }

  async function newFolder() {
    const name = window.prompt('Имя новой папки')
    if (!name || !name.trim()) return
    setBusy(true)
    try {
      await api('/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: dir, name: name.trim() }) })
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось создать папку')
    } finally {
      setBusy(false)
    }
  }

  async function delFolder(path: string) {
    if (!window.confirm(`Удалить папку «${nameOf(path)}» со всем содержимым?`)) return
    setBusy(true)
    try {
      await api('/folder', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
      if (dir === path || dir.startsWith(`${path}/`)) setDir(parentOf(path))
      await load()
      notifyChanged()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось удалить папку')
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="sec-head">
      <span className="sec-icon">
        <IconDatabase />
      </span>
      <div className="sec-head-text">
        <h2 className="setting-title" data-testid="settings-cloud-title">Общее облако</h2>
        <div className="setting-note">Общий диск для участников. Файлы появляются в Библиотеке и на Карте с пометкой «общий диск»</div>
      </div>
      <span className="sec-meta label-mono">общий диск</span>
    </div>
  )

  if (loading) {
    return (
      <section className="sec panel" id="set-cloud" data-testid="cloud-section">
        {header}
        <div className="setting-note cloud-empty" role="status" data-testid="cloud-loading">Загрузка…</div>
      </section>
    )
  }

  /* Не участник — приглашаем ввести код. */
  if (!data || !data.member) {
    return (
      <section className="sec panel" id="set-cloud" data-testid="cloud-section">
        {header}
        <div className="cloud-join">
          <IconKey width={18} height={18} stroke="currentColor" strokeWidth={1.5} />
          <div className="cloud-join-text">
            <b>Подключиться к общему облаку</b>
            <span className="setting-note">Введите секретный код-приглашение, который дал администратор диска.</span>
          </div>
          <div className="tm-actions">
            <input
              className="input input-sm mono"
              placeholder="код-приглашение"
              aria-label="Код-приглашение в общее облако"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join()
              }}
              data-testid="cloud-join-input"
            />
            <button className="btn btn-primary btn-sm" disabled={busy || !joinCode.trim()} onClick={() => void join()} data-testid="cloud-join-btn">
              Войти
            </button>
          </div>
        </div>
      </section>
    )
  }

  const crumbs = dir ? dir.split('/') : []
  const subfolders = data.folders.filter((f) => parentOf(f) === dir)
  const shareUrl = data.inviteCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?cloud=${data.inviteCode}` : ''

  return (
    <section className="sec panel" id="set-cloud" data-testid="cloud-section">
      {header}

      {/* Код-приглашение виден только администратору */}
      {data.isAdmin && data.inviteCode && (
        <div className="cloud-invite" data-testid="cloud-invite">
          <div className="cloud-invite-text">
            <span className="label-mono">Код-приглашение для друга</span>
            <b className="mono cloud-code" data-testid="cloud-invite-code">
              {data.inviteCode}
            </b>
            <span className="setting-note">Участников: {data.membersCount ?? 0}. Ссылка сразу подключает к диску — код вводить не нужно.</span>
          </div>
          <div className="tm-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void navigator.clipboard?.writeText(data.inviteCode!).then(() => flash('Код скопирован'))}
              data-testid="cloud-invite-copy"
            >
              <IconCopy width={12} height={12} aria-hidden="true" /> Копировать код
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void navigator.clipboard?.writeText(shareUrl).then(() => flash('Ссылка-приглашение скопирована'))}
              data-testid="cloud-invite-link"
            >
              <IconExternal width={12} height={12} aria-hidden="true" /> Ссылка
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void rotate()} data-testid="cloud-invite-rotate">
              <IconRefresh width={12} height={12} aria-hidden="true" /> Сменить
            </button>
          </div>
        </div>
      )}

      {/* Папка хранения — куда физически пишутся новые файлы (только админ). */}
      {data.isAdmin && (
        <div className="cloud-storage" data-testid="cloud-storage">
          <IconFolder width={18} height={18} stroke="currentColor" strokeWidth={1.5} aria-hidden="true" />
          <div className="cloud-storage-text">
            <span className="label-mono">Папка хранения</span>
            <b className="mono cloud-storage-path" data-testid="cloud-storage-path" title={data.storageRoot ?? undefined}>
              {data.storageRoot || 'Не выбрана — файлы хранятся во внутреннем хранилище программы'}
            </b>
            <span className="setting-note">Новые загрузки физически записываются в эту папку на ПК под исходными именами.</span>
          </div>
          <div className="tm-actions">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void pickRoot()} data-testid="cloud-storage-change">
              <IconFolder width={12} height={12} aria-hidden="true" /> {data.storageRoot ? 'Изменить' : 'Выбрать папку'}
            </button>
            {data.storageRoot && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => openStorageFolder(data.storageRoot!)} data-testid="cloud-storage-open">
                  <IconExternal width={12} height={12} aria-hidden="true" /> Открыть папку
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void changeRoot('', false, rootNote)}
                  data-testid="cloud-storage-clear"
                >
                  Отключить
                </button>
              </>
            )}
          </div>
          {/* Фолбэк без моста Electron: путь вводится вручную (НЕ window.prompt — он в Electron всегда null). */}
          {showManualRoot && (
            <div className="cloud-storage-manual" data-testid="cloud-storage-manual">
              <input
                className="input input-sm mono"
                placeholder="C:\Users\Имя\WorkSpaceX"
                aria-label="Путь к папке хранения на этом ПК"
                value={manualRoot}
                autoFocus
                onChange={(e) => setManualRoot(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitManualRoot()
                }}
                data-testid="cloud-storage-input"
              />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submitManualRoot()} data-testid="cloud-storage-save">
                Сохранить
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setShowManualRoot(false)}>
                Отмена
              </button>
            </div>
          )}
        </div>
      )}

      {/* Управление диском — только для администратора. */}
      {data.isAdmin && (
        <>
          {/* Панель действий и хлебные крошки */}
          <div className="cloud-bar">
        <div className="cloud-crumbs" data-testid="cloud-crumbs">
          <button className={`crumb${dir === '' ? ' on' : ''}`} onClick={() => setDir('')}>
            <IconDatabase width={13} height={13} aria-hidden="true" /> Диск
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/')
            return (
              <button key={p} className={`crumb${dir === p ? ' on' : ''}`} onClick={() => setDir(p)}>
                <span className="crumb-sep">/</span>
                {c}
              </button>
            )
          })}
        </div>
        <span className="grow" />
        {dir && (
          <button className="btn btn-ghost btn-sm" onClick={() => setDir(parentOf(dir))} data-testid="cloud-up">
            <IconChevronLeft width={13} height={13} aria-hidden="true" /> Назад
          </button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void newFolder()} data-testid="cloud-new-folder">
          <IconFolder width={13} height={13} aria-hidden="true" /> Папка
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="cloud-upload-btn">
          <IconPlus width={13} height={13} aria-hidden="true" /> {busy ? 'Загрузка…' : 'Загрузить'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            void onUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* Папки (для организации загрузок). Сами файлы — в Библиотеке. */}
      {subfolders.length > 0 && (
        <div className="cloud-folders" data-testid="cloud-folders">
          {subfolders.map((f) => (
            <div key={f} className="cloud-folder" data-testid="cloud-folder">
              <button className="cloud-folder-open" onClick={() => setDir(f)}>
                <IconFolder width={16} height={16} aria-hidden="true" />
                <span className="ellipsis">{nameOf(f)}</span>
              </button>
              <button className="cloud-mini danger" title="Удалить папку" onClick={() => void delFolder(f)} data-testid="cloud-folder-del">
                <IconTrash width={12} height={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Статус анализа последних загрузок: спиннер «Анализ…», затем результат. */}
      {uploads.length > 0 && (
        <div className="cloud-uploads" data-testid="cloud-uploads">
          {uploads.map((u) => (
            <div key={u.id} className="cloud-upload" data-state={u.state} data-testid="cloud-upload-row">
              <span className={`cloud-upload-icon${u.state === 'analyzing' ? ' cloud-spin' : ''}${u.state === 'failed' ? ' danger' : ''}`}>
                {u.state === 'analyzing' ? (
                  <IconRefresh width={14} height={14} aria-hidden="true" />
                ) : u.state === 'failed' ? (
                  <IconClose width={14} height={14} aria-hidden="true" />
                ) : (
                  <IconCheck width={14} height={14} aria-hidden="true" />
                )}
              </span>
              <div className="cloud-upload-text">
                <b className="ellipsis">{u.state === 'analyzing' ? 'Анализ…' : u.title || u.name}</b>
                <span className="setting-note">
                  {u.state === 'analyzing' && u.name}
                  {u.state === 'done' && (u.description || u.name)}
                  {u.state === 'partial' && (u.error || 'Содержимое разобрано частично')}
                  {u.state === 'failed' && (u.error || 'Не удалось проанализировать содержимое')}
                </span>
              </div>
              {u.state !== 'analyzing' && (
                <button className="btn btn-ghost btn-sm" onClick={() => void trackAnalysis(u.id, u.name)} data-testid="cloud-reanalyze">
                  <IconRefresh width={12} height={12} aria-hidden="true" /> Переанализировать
                </button>
              )}
            </div>
          ))}
        </div>
      )}
        </>
      )}

      <div className="cloud-hint" data-testid="cloud-hint">
        <IconLibrary width={16} height={16} aria-hidden="true" />
        <span>
          {data.isAdmin ? (
            <>
              Загруженные файлы не показываются здесь — они появляются в <b>Библиотеке</b> и на <b>Карте</b> с пометкой
              <span className="cloud-hint-badge">общий диск</span>. Удалить файл можно из его карточки в библиотеке.
            </>
          ) : (
            <>
              Вы участник с правом <b>только просмотра</b>. Общие файлы открываются в <b>Библиотеке</b> и на <b>Карте</b> с пометкой
              <span className="cloud-hint-badge">общий диск</span> — их можно смотреть и скачивать. Загрузка и удаление доступны администратору.
            </>
          )}
        </span>
      </div>
    </section>
  )
}
