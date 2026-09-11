'use client'

/* ============================================================
   БИБЛИОТЕКА · СОДЕРЖИМОЕ ПЛИТОК
   Те же карточки, что рисовала статичная сетка: разметка перенесена
   как была, меняется только владелец состояния — их рендерит экран,
   а размещает доска. Клик по карточке открывает инспектор; перенос
   не превращается в выбор, потому что движок срывает плитку только
   после порога/долгого нажатия.
   Вынесено из screen-library.tsx без изменения поведения.
   ============================================================ */

import { useRef, useState } from 'react'
import { IconCheck, IconClock, IconKey, IconLock, IconLockRound, IconPin, IconSticker } from './icons'
import { PasswordInput } from './password-input'
import { Beam } from '@/components/ui/beam'
import { checkStickerSecret, looksEncrypted } from '@/hooks/use-file-keys'
import { HOUR, fmtLeft, fmtWhen, type Note } from '@/lib/notes'
import type { FileView } from '@/lib/data'
import { useDataStore, useNavStore, useNow, useToast } from '@/lib/vault-store'

export function NoteCardContent({
  note,
  onSelect,
  onTag,
  isSelected = false,
  marked = false,
  pickable = false,
}: {
  note: Note
  onSelect: (id: string, e: React.MouseEvent) => void
  onTag: (tag: string) => void
  isSelected?: boolean
  /** NF-5: карточка попала в мультивыделение. */
  marked?: boolean
  /** NF-5: режим выбора включён — курсор и рамка говорят об этом. */
  pickable?: boolean
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const { flash } = useToast()
  const now = useNow()

  /* Разблокировка — локальное состояние карточки: ключ не покидает её. */
  const [unlocked, setUnlocked] = useState<string[]>([])
  const [askKey, setAskKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const keyFailRef = useRef(0)

  const left = note.expiresAt === null ? null : note.expiresAt - now
  const pct =
    left === null || !note.lifeSpan ? 100 : Math.max(2, Math.min(100, (left / note.lifeSpan) * 100))
  const soon = left !== null && left < HOUR
  const open = !note.locked || unlocked.includes(note.id)
  const pinnedFile = note.pinnedTo ? D.fileById(note.pinnedTo) : undefined
  const keyApplies = askKey === note.id

  async function submitKey() {
    const val = keyValue.trim()
    if (!val) {
      setKeyError('Введите ключ')
      return
    }
    /* П.10.6: зашифрованный секрет проверяется криптографически (ct:iv). */
    if (note.secret && looksEncrypted(note.secret)) {
      const verdict = await checkStickerSecret(note.secret, val)
      if (verdict === '') {
        setKeyError('Сейф нужно разблокировать заново')
        return
      }
      if (!verdict) {
        keyFailRef.current += 1
        setKeyError(
          keyFailRef.current > 1
            ? `Ключ не подходит · неудачных попыток: ${keyFailRef.current}`
            : 'Ключ не подходит',
        )
        setKeyValue('')
        return
      }
    } else if (note.secret && note.secret !== val) {
      /* Демо-секрет до миграции: прежняя честная сверка строки. */
      keyFailRef.current += 1
      setKeyError(
        keyFailRef.current > 1
          ? `Ключ не подходит · неудачных попыток: ${keyFailRef.current}`
          : 'Ключ не подходит',
      )
      setKeyValue('')
      return
    }
    keyFailRef.current = 0
    setUnlocked((u) => (u.includes(note.id) ? u : [...u, note.id]))
    setAskKey(null)
    setKeyValue('')
    setKeyError(null)
    flash('Стикер расшифрован на этом устройстве')
  }

  return (
    <article
      className={`ncard panel card-hover${isSelected ? ' sel' : ''}${
        left !== null ? ' temp' : ''
      }${open ? ' fade-in' : ''}${marked ? ' marked' : ''}${pickable ? ' pickable' : ''}`}
      onClick={(e) => onSelect(note.id, e)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(note.id, e as unknown as React.MouseEvent)
        }
      }}
      aria-label={`Стикер «${note.title}»: открыть в инспекторе`}
      aria-current={isSelected ? 'true' : undefined}
      tabIndex={0}
      data-testid={`lib-note-${note.id}`}
      data-library-id={note.id}
      data-library-kind="note"
      data-marked={marked ? '1' : undefined}
    >
      {(marked || pickable) && (
        <span className={`card-mark${marked ? ' on' : ''}`} aria-hidden="true">
          {marked ? <IconCheck width={11} height={11} stroke="currentColor" strokeWidth={2} /> : null}
        </span>
      )}
      <div className="ncard-top">
        <span className="chip chip-note">
          <IconSticker width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
          стикер
        </span>
        {note.demo && (
          <span className="demo-tag" title="Объект демо-корпуса" data-testid={`demo-tag-${note.id}`}>
            демо
          </span>
        )}
        {note.shared && <span className="chip" style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)' }} data-testid={`shared-tag-${note.id}`}>общий диск</span>}
        {left === null ? (
          <span className="ttl mono">постоянный</span>
        ) : (
          <span className={`ttl mono num${soon ? ' soon' : ''}`}>
            <IconClock width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
            {fmtLeft(left)}
          </span>
        )}
      </div>

      <h3 className="ntitle">{note.title}</h3>

      <div className={`nbody-shell${open ? '' : ' shut'}`}>
        <p className="nbody" aria-hidden={!open}>
          {note.body}
        </p>
        {!open && <span className="sr-only">Содержимое закрыто паролем</span>}
      </div>

      {!open &&
        (keyApplies ? (
          <div className="unlock" onClick={(e) => e.stopPropagation()}>
            <div className="unlock-row">
              <PasswordInput
                className={`input input-sm mono${keyError ? ' err' : ''}`}
                testId={`note-unlock-password-${note.id}`}
                autoFocus
                value={keyValue}
                onChange={(e) => {
                  setKeyValue(e.target.value)
                  if (keyError) setKeyError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitKey()
                }}
                placeholder="локальный ключ"
                aria-label="Локальный ключ"
                aria-invalid={!!keyError}
              />
              <button className="btn btn-primary btn-sm" onClick={submitKey} aria-label="Открыть стикер" data-testid={`note-unlock-submit-${note.id}`}>
                <IconKey />
              </button>
            </div>
            <span className={`key-hint mono${keyError ? ' err' : ''}`} role="status">
              {keyError ??
                (note.secret ? 'ключ проверяется на устройстве' : 'демо-сейф: подойдёт любой ключ')}
            </span>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm nunlock"
            onClick={(e) => {
              e.stopPropagation()
              setAskKey(note.id)
              setKeyValue('')
              setKeyError(null)
            }}
            data-testid={`note-unlock-open-${note.id}`}
          >
            <IconLock />
            Ввести ключ
          </button>
        ))}

      <div className="tags">
        {note.locked && (
          <span className="badge badge-info">
            <IconLock />
            пароль
          </span>
        )}
        {note.tags.map((t) => (
          <button
            key={t}
            className="chip chip-ai chip-btn"
            onClick={(e) => {
              e.stopPropagation()
              onTag(t)
            }}
            aria-label={`Показать стикеры с тегом ${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {note.pinnedTo && (
        <button
          className="pin-row mono pin-jump"
          onClick={(e) => {
            e.stopPropagation()
            if (pinnedFile) NAV.openFile(pinnedFile.id)
            else flash('Файл больше не в сейфе')
          }}
        >
          <IconPin width={12} height={12} stroke="currentColor" strokeWidth={1.5} />
          <span className="ellipsis">{pinnedFile?.name ?? 'файл удалён'}</span>
        </button>
      )}

      <footer className="mono num">{fmtWhen(note.createdAt, now)}</footer>

      {left !== null && (
        <span className={`decay${soon ? ' soon' : ''}`} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </article>
  )
}

export function FileCardContent({
  file,
  onSelect,
  fkHidden = false,
  marked = false,
  pickable = false,
}: {
  file: FileView
  onSelect: (id: string, e: React.MouseEvent) => void
  /** Файл под ключом: содержимое скрыто, видно имя и бейдж (этап 5). */
  fkHidden?: boolean
  /** NF-5: карточка попала в мультивыделение. */
  marked?: boolean
  pickable?: boolean
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const pinned = D.liveNotes.filter((n) => n.pinnedTo === file.id).length

  return (
    <article
      className={`fcard panel card-hover fade-in${file.processing ? ' proc-live beam-host' : ''}${
        marked ? ' marked' : ''
      }${pickable ? ' pickable' : ''}`}
      data-drop-pin={file.id}
      onClick={(e) => onSelect(file.id, e)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(file.id, e as unknown as React.MouseEvent)
        }
      }}
      /* UX-4: карточка сама не кнопка — внутри неё живут свои кнопки, и
         role="button" делал их вложенными интерактивными (axe). Она остаётся
         в обходе с клавиатуры и открывается Enter/Пробелом. */
      aria-label={`Файл ${file.name}: открыть в инспекторе`}
      tabIndex={0}
      data-testid={`lib-file-${file.id}`}
      data-library-id={file.id}
      data-library-kind="file"
      data-marked={marked ? '1' : undefined}
    >
      {(marked || pickable) && (
        <span className={`card-mark${marked ? ' on' : ''}`} aria-hidden="true">
          {marked ? <IconCheck width={11} height={11} stroke="currentColor" strokeWidth={2} /> : null}
        </span>
      )}
      {/* Файл в обработке: луч по кромке показывает живую работу модели. */}
      {file.processing ? <Beam duration={3.2} size={34} /> : null}
      <div className="fcard-top">
        <span className="ficon panel">
          <file.Icon width={18} height={18} stroke="currentColor" strokeWidth={1.5} />
        </span>
        {file.demo && (
          <span className="demo-tag" title="Объект демо-корпуса" data-testid={`demo-tag-${file.id}`}>
            демо
          </span>
        )}
        {file.shared && (
          <span
            className="chip"
            title={file.cloudShared === false ? 'Личный файл в вашей локальной папке' : 'Файл из общего облака'}
            data-testid={`shared-tag-${file.id}`}
            style={
              file.cloudShared === false
                ? { borderColor: 'var(--line)', color: 'var(--muted)' }
                : { borderColor: 'var(--accent-line)', color: 'var(--accent)' }
            }
          >
            {file.cloudShared === false ? 'моя папка' : 'общий диск'}
          </span>
        )}
        <button
          className="chip chip-cat chip-btn"
          onClick={(e) => {
            e.stopPropagation()
            NAV.openCluster(file.cluster)
          }}
          aria-label={`Показать кластер ${file.cat}`}
        >
          {file.cat}
        </button>
      </div>
      <div className="fname mono num">
        <b>{file.name}</b>
      </div>
      {file.processing ? (
        <div className="proc">
          <i className="net-dot" />
          <span className="label-mono">Обработка</span>
          <span className="ellipsis">ИИ изучает файл…</span>
        </div>
      ) : fkHidden ? (
        <p className="desc">
          <span className="fk-badge" title="Файл заперт файловым ключом">
            <IconLockRound width={10} height={10} stroke="currentColor" strokeWidth={1.6} />
            под ключом
          </span>
        </p>
      ) : (
        <p className="desc">{file.desc}</p>
      )}
      {!fkHidden && (
        <div className="tags">
          {file.tagList.map((t) => (
            <span key={t} className="chip chip-ai">
              {t}
            </span>
          ))}
        </div>
      )}
      <footer className="mono num">
        <span>{file.meta}</span>
        {pinned ? (
          <span className="fnotes">
            <IconSticker width={12} height={12} stroke="currentColor" strokeWidth={1.5} />
            {pinned}
          </span>
        ) : null}
      </footer>
    </article>
  )
}
