'use client'

/* ============================================================
   NF-11 · РАЗДЕЛ НАСТРОЕК «СИНХРОНИЗАЦИЯ E2EE»
   Включение (новая фраза из 12 слов + QR), присоединение по фразе,
   устройства пространства с отзывом, показ фразы, выключение.
   Сервер во всём этом — слепой почтовый ящик: он видит шифртексты и
   идентификаторы, но не ключ и не содержимое.
   ============================================================ */

import { useEffect, useState } from 'react'
import { IconAlertTri, IconCopy, IconDatabase, IconRefresh } from './icons'
import { mnemonicToEntropy } from '@/lib/bip39'
import { qrMatrix } from '@/lib/qr'
import {
  disableSync,
  enableSync,
  revokeSyncDevice,
  syncWords,
  useSyncState,
  type DeviceView,
} from '@/lib/sync/engine'
import { useToast } from '@/lib/vault-store'

const fmt = (at: number | null) =>
  at
    ? new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

const STATUS: Record<string, string> = {
  off: 'выключена',
  connecting: 'подключение…',
  live: 'в эфире',
  error: 'ошибка',
}

function Qr({ text }: { text: string }) {
  const grid = qrMatrix(text)
  if (!grid) return null
  const size = grid.length
  const total = size + 8
  return (
    <svg
      className="sync-qr"
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR-код фразы синхронизации"
      data-testid="sync-qr"
    >
      <rect x="0" y="0" width={total} height={total} fill="#f4f6f4" />
      {grid.map((row, y) =>
        row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x + 4} y={y + 4} width="1" height="1" fill="#0d1210" /> : null)),
      )}
    </svg>
  )
}

function Phrase({ words, onHide }: { words: string[]; onHide: () => void }) {
  const { flash } = useToast()
  const [left, setLeft] = useState(90)
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (left <= 0) onHide()
  }, [left, onHide])
  const text = words.join(' ')
  return (
    <div className="sync-phrase" data-testid="sync-phrase">
      <div className="mask-head">
        <span className="label-mono">Фраза синхронизации · 12 слов · скроется через {left} с</span>
        <button className="mcp-x" onClick={onHide} data-testid="sync-phrase-hide">
          скрыть
        </button>
      </div>
      <div className="sync-phrase-body">
        <ol className="sync-words" data-testid="sync-words">
          {words.map((w, i) => (
            <li key={i}>
              <span className="label-mono">{i + 1}</span>
              {w}
            </li>
          ))}
        </ol>
        <Qr text={`wsx-sync:${text}`} />
      </div>
      <div className="tm-actions">
        <button
          className="btn btn-ghost"
          onClick={() => void navigator.clipboard?.writeText(text).then(() => flash('Фраза скопирована — вставьте на втором устройстве'))}
          data-testid="sync-phrase-copy"
        >
          <IconCopy width={12} height={12} aria-hidden="true" /> Копировать фразу
        </button>
        <span className="setting-note">
          Кто знает фразу — читает всё пространство. Сервер её не видит и восстановить не сможет.
        </span>
      </div>
    </div>
  )
}

function DeviceRow({ d }: { d: DeviceView }) {
  const { flash } = useToast()
  const [confirm, setConfirm] = useState(false)
  async function revoke() {
    if (!confirm) {
      setConfirm(true)
      setTimeout(() => setConfirm(false), 5000)
      return
    }
    const ok = await revokeSyncDevice(d.id, d.label)
    flash(ok ? `Устройство «${d.label}» отозвано` : 'Не удалось отозвать')
  }
  return (
    <div className={`mcp-token${d.revokedAt ? ' st-revoked' : ''}`} data-testid="sync-device-row" data-device-id={d.id}>
      <div className="mcp-token-text">
        <b>
          {d.label} {d.self && <span className="mcp-chip">это устройство</span>}
        </b>
        <span className="label-mono">
          {d.id} · с {fmt(d.createdAt)} · был на связи {fmt(d.lastSeenAt)}
        </span>
      </div>
      <span className={`mcp-status label-mono st-${d.revokedAt ? 'revoked' : 'active'}`} data-testid="sync-device-status">
        {d.revokedAt ? 'отозвано' : 'активно'}
      </span>
      {!d.self && !d.revokedAt && (
        <button className={`btn ${confirm ? 'btn-danger' : 'btn-ghost'}`} onClick={() => void revoke()} data-testid="sync-device-revoke">
          {confirm ? 'Точно отозвать?' : 'Отозвать'}
        </button>
      )}
    </div>
  )
}

export function SyncSection() {
  const S = useSyncState()
  const { flash } = useToast()
  const [label, setLabel] = useState('')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [shown, setShown] = useState<string[] | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  async function create() {
    setBusy(true)
    setErr(null)
    const problem = await enableSync(label, null)
    setBusy(false)
    if (problem) return setErr(problem)
    setShown(await syncWords())
    flash('Пространство создано — запишите фразу')
  }

  async function join() {
    setBusy(true)
    setErr(null)
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const entropy = words.length === 12 ? await mnemonicToEntropy(words) : null
    if (!entropy) {
      setBusy(false)
      return setErr('Нужно ровно 12 слов BIP39 с верной контрольной суммой')
    }
    const problem = await enableSync(label, entropy)
    setBusy(false)
    if (problem) return setErr(problem)
    setPhrase('')
    flash('Устройство присоединено: изменения начнут сходиться')
  }

  async function turnOff() {
    if (!confirmOff) {
      setConfirmOff(true)
      setTimeout(() => setConfirmOff(false), 6000)
      return
    }
    await disableSync()
    setShown(null)
    flash('Синхронизация выключена на этом устройстве')
  }

  const on = S.status !== 'off'

  return (
    <section className="sec panel" id="set-sync" data-testid="settings-sync">
      <div className="sec-head">
        <span className={`sec-icon${S.status === 'live' ? ' active' : ''}`}>
          <IconDatabase />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Синхронизация между устройствами</div>
          <div className="setting-note">
            Файлы, стикеры и лента уведомлений сходятся между вашими устройствами. Шифрование на
            устройстве: сервер хранит только шифртекст и не знает ключа
          </div>
        </div>
        <span className={`sec-meta label-mono${S.status === 'live' ? ' ok-text' : ''}`} data-testid="sync-status">
          {STATUS[S.status]}
        </span>
      </div>

      {!on ? (
        <div className="sync-setup">
          <input
            className="mcp-input"
            placeholder="Имя этого устройства, например «Ноутбук»"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            data-testid="sync-label"
          />
          <div className="sync-cards">
            <div className="sync-card" data-testid="sync-create-card">
              <b>Новое пространство</b>
              <span>Сгенерировать фразу из 12 слов на этом устройстве. Ключ не связан с мастер-ключом замка.</span>
              <button className="btn btn-primary" disabled={busy} onClick={() => void create()} data-testid="sync-create">
                Включить и показать фразу
              </button>
            </div>
            <div className="sync-card" data-testid="sync-join-card">
              <b>Присоединиться</b>
              <span>Введите фразу с первого устройства. Ваши локальные данные сольются с общими.</span>
              <textarea
                className="mcp-input sync-phrase-input"
                placeholder="12 слов через пробел"
                value={phrase}
                rows={2}
                onChange={(e) => setPhrase(e.target.value)}
                data-testid="sync-join-phrase"
              />
              <button className="btn btn-ghost" disabled={busy || !phrase.trim()} onClick={() => void join()} data-testid="sync-join">
                Присоединить это устройство
              </button>
            </div>
          </div>
          {err && (
            <p className="mk-err" role="alert" data-testid="sync-error">
              {err}
            </p>
          )}
          <p className="mcp-note">
            Секреты менеджера паролей и стикеры под локальным ключом не синхронизируются. Удаления
            расходятся так же, как и правки: стёртое здесь исчезнет и там.
          </p>
        </div>
      ) : (
        <div className="sync-live">
          <div className="sync-stats label-mono" data-testid="sync-stats">
            <span>пространство {S.spaceId?.slice(0, 8)}…</span>
            <span>устройство «{S.label}»</span>
            <span>отправлено {S.pushed}</span>
            <span>получено {S.pulled}</span>
            <span>последняя сверка {fmt(S.lastSyncAt)}</span>
          </div>
          {S.error && (
            <p className="mk-err" role="alert" data-testid="sync-error">
              <IconAlertTri width={13} height={13} aria-hidden="true" /> {S.error}
            </p>
          )}

          <div className="mask-head">
            <span className="label-mono">Устройства · {S.devices.length}</span>
            <span className="mask-flag">имена расшифрованы локально</span>
          </div>
          <div className="mcp-token-list" data-testid="sync-devices">
            {S.devices.map((d) => (
              <DeviceRow key={d.id} d={d} />
            ))}
          </div>

          {shown ? (
            <Phrase words={shown} onHide={() => setShown(null)} />
          ) : (
            <div className="tm-actions">
              <button className="btn btn-ghost" onClick={() => void syncWords().then(setShown)} data-testid="sync-show-phrase">
                <IconRefresh width={12} height={12} aria-hidden="true" /> Показать фразу для нового устройства
              </button>
              <button className={`btn ${confirmOff ? 'btn-danger' : 'btn-ghost'}`} onClick={() => void turnOff()} data-testid="sync-disable">
                {confirmOff ? 'Точно выключить?' : 'Выключить на этом устройстве'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
