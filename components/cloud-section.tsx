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
  IconChevronLeft,
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
  folders: string[]
}

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
const nameOf = (p: string) => p.split('/').slice(-1)[0]

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
      flash(list.length === 1 ? `Загружен «${list[0].name}» — ищите его в Библиотеке` : `Загружено файлов: ${list.length} — они в Библиотеке`)
      notifyChanged()
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
        <div className="setting-title">Общее облако</div>
        <div className="setting-note">Общий диск для участников. Файлы появляются в Библиотеке и на Карте с пометкой «общий диск»</div>
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
