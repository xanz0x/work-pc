'use client'

/* ============================================================
   WI-FI QR · офлайн-кодер, ноль зависимостей и ноль сети
   Пароль расшифровывается в память только на время показа, в DOM
   попадают лишь модули QR (никакого текста секрета), окно само
   закрывается по таймеру и по panic-lock.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { IconClose, IconRefresh, IconWifi } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import type { SecretRecord } from '@/lib/secrets'
import { qrMatrix, wifiPayload } from '@/lib/qr'

const SHOW_SECONDS = 45

function fieldValue(entry: SecretRecord, needles: string[]): string {
  const f = entry.fields.find((x) => needles.some((n) => x.name.toLowerCase().includes(n)))
  return f && !f.secret ? f.value : ''
}

export function WifiQr({ entry, onClose }: { entry: SecretRecord; onClose: () => void }) {
  const s = useSecrets()
  const [state, setState] = useState<'load' | 'ok' | 'fail' | 'big'>('load')
  const [grid, setGrid] = useState<boolean[][] | null>(null)
  const [ssid, setSsid] = useState('')
  const [left, setLeft] = useState(SHOW_SECONDS)
  const [nonce, setNonce] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Замок закрылся — окно уходит вместе с ключами. */
  const epoch0 = useRef(s.hideEpoch)
  useEffect(() => {
    if (s.hideEpoch !== epoch0.current) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.hideEpoch])

  useEffect(() => {
    let alive = true
    setState('load')
    setLeft(SHOW_SECONDS)
    void (async () => {
      const name = fieldValue(entry, ['ssid', 'сеть', 'имя']) || entry.title
      const security = fieldValue(entry, ['защит', 'security', 'тип']) || 'WPA'
      const pwField = entry.fields.find((f) => f.secret && f.value)
      const pass = pwField ? await s.openValue(entry.id, pwField.id) : ''
      if (!alive) return
      if (pass === null) {
        setState('fail')
        return
      }
      const matrix = qrMatrix(wifiPayload(name, pass, security))
      if (!alive) return
      setSsid(name)
      if (!matrix) {
        setState('big')
        return
      }
      setGrid(matrix)
      setState('ok')
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, nonce])

  /* Автозакрытие: QR содержит пароль, поэтому не висит на экране вечно. */
  useEffect(() => {
    if (state !== 'ok') return
    const id = setInterval(() => setLeft((n) => n - 1), 1000)
    timer.current = setTimeout(onClose, SHOW_SECONDS * 1000)
    return () => {
      clearInterval(id)
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nonce])

  const size = grid?.length ?? 0
  const quiet = 4
  const total = size + quiet * 2

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={onClose}>
      <div
        className="vt-modal panel vt-qr"
        role="dialog"
        aria-modal="true"
        aria-label="QR-код Wi-Fi"
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="wifi-qr-modal"
      >
        <header className="vt-modal-head">
          <span className="vt-qr-head-ico" aria-hidden="true">
            <IconWifi />
          </span>
          <span className="label-mono">Wi-Fi QR · офлайн</span>
          <span className="grow" />
          <button
            className="vt-icon-btn"
            onClick={() => setNonce((n) => n + 1)}
            title="Показать снова"
            aria-label="Показать снова"
            data-testid="wifi-qr-again"
          >
            <IconRefresh />
          </button>
          <button className="vt-icon-btn" onClick={onClose} aria-label="Закрыть" data-testid="wifi-qr-close">
            <IconClose />
          </button>
        </header>

        {state === 'load' && (
          <p className="vt-note" data-testid="wifi-qr-loading">
            Расшифровываю пароль в памяти и считаю модули…
          </p>
        )}
        {state === 'fail' && (
          <p className="vt-error" role="alert" data-testid="wifi-qr-error">
            Нет сеанса мастер-ключа — QR не построен. Разблокируйте сейф и попробуйте снова.
          </p>
        )}
        {state === 'big' && (
          <p className="vt-error" role="alert" data-testid="wifi-qr-error">
            Слишком длинные SSID и пароль: в QR уровня M версии 10 не влезает.
          </p>
        )}

        {state === 'ok' && grid && (
          <>
            <div className="vt-qr-frame" data-testid="wifi-qr-frame">
              <svg
                className="vt-qr-svg"
                viewBox={`0 0 ${total} ${total}`}
                width="256"
                height="256"
                role="img"
                aria-label={`QR-код для подключения к сети ${ssid}`}
                shapeRendering="crispEdges"
                data-testid="wifi-qr-svg"
                data-modules={size}
              >
                <rect x="0" y="0" width={total} height={total} fill="#f4f6f4" />
                {grid.map((row, y) =>
                  row.map((on, x) =>
                    on ? (
                      <rect
                        key={`${y}-${x}`}
                        x={x + quiet}
                        y={y + quiet}
                        width={1}
                        height={1}
                        fill="#101512"
                      />
                    ) : null,
                  ),
                )}
              </svg>
            </div>
            <p className="vt-qr-ssid mono ellipsis" data-testid="wifi-qr-ssid">
              {ssid}
            </p>
            <p className="vt-note" data-testid="wifi-qr-timer">
              Наведите камеру телефона — подключение произойдёт без ввода пароля. Код закроется
              сам через <b className="num">{Math.max(0, left)}</b> с. Пароль существует только в
              этих модулях: в разметке нет ни одного символа секрета.
            </p>
          </>
        )}

        <footer className="vt-modal-foot">
          <span className="vt-note">QR считается локально · сеть не используется</span>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={onClose} data-testid="wifi-qr-done">
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  )
}
