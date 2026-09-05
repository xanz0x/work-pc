'use client'

/* ============================================================
   РАЗДЕЛ НАСТРОЕК «ОБЩЕЕ ОБЛАКО»
   Один общий диск: администраторы и участники (вошедшие по коду)
   загружают, скачивают, переименовывают и удаляют файлы, строят
   папки. Файлы облака помечены плашкой «облако · общий», чтобы их
   нельзя было спутать с локальными файлами на этом ПК.
   ============================================================ */

import './cloud-section.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconChevronLeft,
  IconCopy,
  IconDatabase,
  IconDoc,
  IconExternal,
  IconFolder,
  IconImage,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from './icons'
import { fmtBytes } from '@/lib/data'
import { useToast } from '@/lib/vault-store'

type CloudFile = {
  id: string
  name: string
  dir: string
  contentType: string
  size: number
  by: string
  at: string
}

type DriveView = {
  isAdmin: boolean
  member: boolean
  inviteCode?: string
  membersCount?: number
  folders: string[]
  files: CloudFile[]
}

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
const nameOf = (p: string) => p.split('/').slice(-1)[0]
const isImg = (t: string) => t.startsWith('image/')

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`/ai-api/cloud${path}`, { cache: 'no-store', ...init })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error || `Ошибка ${r.status}`)
  return body
}

export function CloudSection() {
  const { flash } = useToast()
  const [data, setData] = useState<DriveView | null>(null)
  const [loading, setLoading] = useState(true)
  const [dir, setDir] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
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

  async function onUpload(files: FileList | null) {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    setBusy(true)
    try {
      for (const f of list) {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('dir', dir)
        await api('/upload', { method: 'POST', body: fd })
      }
      flash(list.length === 1 ? `Загружен «${list[0].name}»` : `Загружено файлов: ${list.length}`)
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Загрузка не удалась')
    } finally {
      setBusy(false)
    }
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
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось удалить папку')
    } finally {
      setBusy(false)
    }
  }

  async function del(id: string, name: string) {
    if (!window.confirm(`Удалить «${name}» из общего облака?`)) return
    setBusy(true)
    try {
      await api(`/file/${id}`, { method: 'DELETE' })
      flash('Файл удалён')
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  async function saveRename(id: string) {
    if (!renameVal.trim()) return
    setBusy(true)
    try {
      await api(`/file/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: renameVal.trim() }) })
      setRenaming(null)
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось переименовать')
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
        <div className="setting-title">Общее облако</div>
        <div className="setting-note">Один общий диск: файлы видят все участники, отдельно от локальных файлов на этом ПК</div>
      </div>
      <span className="sec-meta label-mono">общий диск</span>
    </div>
  )

  if (loading) {
    return (
      <section className="sec panel" id="set-cloud" data-testid="cloud-section">
        {header}
        <div className="setting-note cloud-empty">Загрузка…</div>
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
  const filesHere = data.files.filter((f) => f.dir === dir)
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
            <span className="setting-note">Участников: {data.membersCount ?? 0}. Кто знает код — получает доступ к этому же диску.</span>
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

      {/* Папки */}
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

      {/* Файлы */}
      {filesHere.length === 0 && subfolders.length === 0 ? (
        <div className="setting-note cloud-empty" data-testid="cloud-empty">
          Здесь пока пусто. Загрузите файл или создайте папку — всё это увидят другие участники облака.
        </div>
      ) : (
        <div className="cloud-grid" data-testid="cloud-files">
          {filesHere.map((f) => (
            <article key={f.id} className="cloud-card" data-testid="cloud-file" data-file-id={f.id}>
              <span className="cloud-badge" title="Файл из общего облака">
                <IconDatabase width={10} height={10} aria-hidden="true" /> облако · общий
              </span>
              <div className="cloud-thumb">
                {isImg(f.contentType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/ai-api/cloud/file/${f.id}?inline=1`} alt={f.name} loading="lazy" />
                ) : (
                  <IconDoc width={26} height={26} stroke="currentColor" strokeWidth={1.3} />
                )}
                {isImg(f.contentType) && (
                  <span className="cloud-thumb-tag">
                    <IconImage width={11} height={11} aria-hidden="true" />
                  </span>
                )}
              </div>
              {renaming === f.id ? (
                <div className="cloud-rename">
                  <input
                    className="input input-sm"
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(f.id)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    data-testid="cloud-rename-input"
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => void saveRename(f.id)} data-testid="cloud-rename-save">
                    OK
                  </button>
                </div>
              ) : (
                <div className="cloud-name ellipsis" title={f.name}>
                  {f.name}
                </div>
              )}
              <div className="cloud-meta mono">{fmtBytes(f.size)}</div>
              <div className="cloud-actions">
                <a className="cloud-mini" href={`/ai-api/cloud/file/${f.id}`} title="Скачать" data-testid="cloud-download">
                  <IconExternal width={12} height={12} aria-hidden="true" />
                </a>
                <button
                  className="cloud-mini"
                  title="Переименовать"
                  onClick={() => {
                    setRenaming(f.id)
                    setRenameVal(f.name)
                  }}
                  data-testid="cloud-rename"
                >
                  <IconPencil width={12} height={12} aria-hidden="true" />
                </button>
                <button className="cloud-mini danger" title="Удалить" disabled={busy} onClick={() => void del(f.id, f.name)} data-testid="cloud-delete">
                  <IconTrash width={12} height={12} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
