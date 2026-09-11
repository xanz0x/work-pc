'use client'

/* ============================================================
   БИБЛИОТЕКА · ИНСПЕКТОР СТИКЕРА
   Правая колонка для выбранного стикера: тело под ключом, жизнь,
   защита, привязка к файлу и что увидел ИИ.
   Вынесено из screen-library.tsx без изменения поведения.
   ============================================================ */

import {
  IconCheck,
  IconClock,
  IconDoc,
  IconGraph,
  IconKey,
  IconLock,
  IconPencil,
  IconPin,
  IconRefresh,
  IconSparkText,
  IconSticker,
  IconTrash,
} from './icons'
import { PasswordInput } from './password-input'
import { DAY, fmtLeft, fmtWhen, type Note } from '@/lib/notes'
import { useDataStore, useNavStore, useToast } from '@/lib/vault-store'

type Sel = { kind: 'file' | 'note'; id: string }
type Layer = 'all' | 'files' | 'notes'

export function LibraryNoteInspector({
  note,
  now,
  noteOpen,
  askKey,
  keyValue,
  keyError,
  setAskKey,
  setKeyValue,
  setKeyError,
  openKeyPrompt,
  submitKey,
  settingKeyFor,
  setSettingKeyFor,
  newKey,
  setNewKey,
  applyLock,
  removeLock,
  makePermanent,
  burnNow,
  startEdit,
  view,
  setView,
  setSel,
}: {
  note: Note
  now: number
  /** Стикер открыт: пароля нет или ключ уже введён. */
  noteOpen: boolean
  askKey: string | null
  keyValue: string
  keyError: string | null
  setAskKey: (id: string | null) => void
  setKeyValue: (v: string) => void
  setKeyError: (v: string | null) => void
  openKeyPrompt: (id: string) => void
  submitKey: (id: string) => void
  settingKeyFor: string | null
  setSettingKeyFor: (id: string | null) => void
  newKey: string
  setNewKey: (v: string) => void
  applyLock: (id: string) => void
  removeLock: (id: string) => void
  makePermanent: (id: string) => void
  burnNow: (id: string) => void
  startEdit: (n: Note) => void
  view: Layer
  setView: (v: Layer) => void
  setSel: (s: Sel) => void
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const { flash } = useToast()

  return (
    <aside className="inspector panel fade-in" aria-label="Инспектор стикера">
      <div className="insp-tabs">
        <span className="chip chip-note">
          <IconSticker width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
          стикер
        </span>
        {note.expiresAt === null ? (
          <span className="chip">постоянный</span>
        ) : (
          <span className="chip chip-warn num">
            {fmtLeft(note.expiresAt - now)} до стирания
          </span>
        )}
      </div>

      <div className={`preview note-preview${noteOpen ? '' : ' shut'}`}>
        <p aria-hidden={!noteOpen}>{note.body}</p>
        {!noteOpen && <span className="sr-only">Содержимое закрыто паролем</span>}
      </div>

      {!noteOpen && (
        <div className="unlock unlock-insp">
          <div className="unlock-row">
            <PasswordInput
              className={`input input-sm mono${keyError && askKey === note.id ? ' err' : ''}`}
              testId="note-inspector-password"
              value={askKey === note.id ? keyValue : ''}
              onFocus={() => {
                if (askKey !== note.id) openKeyPrompt(note.id)
              }}
              onChange={(e) => {
                if (askKey !== note.id) setAskKey(note.id)
                setKeyValue(e.target.value)
                if (keyError) setKeyError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitKey(note.id)
              }}
              placeholder="локальный ключ"
              aria-label="Локальный ключ"
              aria-invalid={!!(keyError && askKey === note.id)}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => submitKey(note.id)}
              aria-label="Открыть стикер"
            >
              <IconKey />
            </button>
          </div>
          <span
            className={`key-hint mono${keyError && askKey === note.id ? ' err' : ''}`}
            role="status"
          >
            {(keyError && askKey === note.id ? keyError : null) ??
              (note.secret
                ? 'ключ проверяется на устройстве, ничего не уходит в сеть'
                : 'демо-сейф: подойдёт любой ключ')}
          </span>
        </div>
      )}

      <div className="file-name">{note.title}</div>

      <div className="meta-grid">
        <div>
          <span className="label-mono">Создан</span>
          <div className="v num">{fmtWhen(note.createdAt, now)}</div>
        </div>
        <div>
          <span className="label-mono">Символов</span>
          <div className="v num">{noteOpen ? note.body.length : '—'}</div>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <span className="label-mono">Состояние</span>
          <div className="badges-row">
            {note.expiresAt === null ? (
              <span className="badge badge-ok">
                <IconPin />
                живёт постоянно
              </span>
            ) : (
              <span className="badge badge-warn">
                <IconClock />
                временный
              </span>
            )}
            <span className={note.locked ? 'badge badge-info' : 'badge'}>
              <IconLock />
              {note.locked ? (noteOpen ? 'ключ введён' : 'пароль включён') : 'без пароля'}
            </span>
          </div>
        </div>
      </div>

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Жизнь стикера</span>
          <IconClock width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
        </div>
        <p>
          {note.expiresAt === null
            ? 'Стикер закреплён: он остаётся в сейфе, пока вы сами его не удалите.'
            : 'По истечении таймера стикер стирается локально, вместе с телом, тегами и связями на карте. Корзины нет.'}
        </p>
        <div className="life-btns">
          {note.expiresAt !== null && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => D.extendNote(note.id, DAY)}
              >
                <IconRefresh />
                +24 часа
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => makePermanent(note.id)}
              >
                <IconPin />
                Оставить навсегда
              </button>
            </>
          )}
          <button
            className="btn btn-ghost btn-sm btn-danger"
            onClick={() => burnNow(note.id)}
          >
            <IconTrash />
            Стереть сейчас
          </button>
        </div>
      </div>

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Защита</span>
          <button
            className={`toggle${note.locked ? ' on' : ''}`}
            role="switch"
            aria-checked={note.locked}
            aria-label="Пароль на стикер"
            onClick={() => {
              if (note.locked) removeLock(note.id)
              else {
                setSettingKeyFor(note.id)
                setNewKey('')
              }
            }}
          >
            <i />
          </button>
        </div>
        <p>
          {note.locked
            ? 'Тело шифруется ключом AES-256, который не покидает устройство. До ввода ключа виден только размытый силуэт текста.'
            : 'Стикер лежит открытым: его читает любой, кто уже вошёл в сейф. Включите пароль для отдельного ключа.'}
        </p>
        {settingKeyFor === note.id && !note.locked && (
          <div className="key-setup">
            <PasswordInput
              className="input input-sm mono"
              testId="note-set-password"
              autoFocus
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyLock(note.id)
              }}
              placeholder="придумайте локальный ключ"
              aria-label="Новый локальный ключ"
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => applyLock(note.id)}
              disabled={!newKey.trim()}
            >
              <IconCheck />
              Закрыть
            </button>
          </div>
        )}
      </div>

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Привязка</span>
          <IconPin width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
        </div>
        {note.pinnedTo ? (
          <button
            className="rel-item pin-item"
            onClick={() => {
              const f = note.pinnedTo ? D.fileById(note.pinnedTo) : undefined
              if (f) {
                if (view === 'notes') setView('all')
                setSel({ kind: 'file', id: f.id })
              } else flash('Файл больше не в сейфе')
            }}
          >
            <IconDoc width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
            <span className="rn mono ellipsis">
              {D.fileById(note.pinnedTo)?.name ?? 'файл удалён'}
            </span>
            <span className="rp mono num">открыть</span>
          </button>
        ) : (
          <p>Стикер ни к чему не приколот. ИИ предложит файл, когда найдёт пересечение.</p>
        )}
      </div>

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Что увидел ИИ</span>
          <span className="chip">
            <IconSparkText width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
            локально
          </span>
        </div>
        <p>
          {note.locked && !noteOpen
            ? 'Закрытый стикер индексируется только по вашим тегам: модель не читает тело, пока не введён ключ.'
            : `Текст разобран на смыслы и добавлен в карту памяти: ${
                D.neighbors(note.id).length
              } связей в сейфе.`}
        </p>
      </div>

      <div className="insp-actions">
        <button
          className="btn btn-primary btn-full"
          onClick={() => (noteOpen ? startEdit(note) : openKeyPrompt(note.id))}
        >
          {noteOpen ? <IconPencil /> : <IconKey />}
          {noteOpen ? 'Редактировать' : 'Ввести ключ'}
        </button>
        <button
          className="btn btn-ghost btn-full"
          onClick={() => NAV.openOnMap(note.pinnedTo ?? note.id)}
        >
          <IconGraph />
          Показать на карте
        </button>
      </div>
    </aside>
  )
}
