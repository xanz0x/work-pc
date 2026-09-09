'use client'

/* ============================================================
   TOTP-ячейка · код обновляется сам, обратный отсчёт до нового окна.
   Секрет расшифровывается на каждом окне и не хранится в состоянии.
   ============================================================ */

import { useEffect, useState } from 'react'
import { IconCheck, IconClip } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'

export function TotpCell({ entryId, period }: { entryId: string; period: number }) {
  const s = useSecrets()
  const [code, setCode] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    async function tick() {
      const res = await s.totpNow(entryId)
      if (!alive) return
      if (!res) {
        setCode(null)
        return
      }
      setCode(res.code)
      setLeft(res.remaining)
    }
    void tick()
    const id = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) void tick()
        return Math.max(0, n - 1)
      })
    }, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, s.hideEpoch, s.ready])

  if (code === null) {
    return <span className="vt-totp-empty label-mono">TOTP недоступен — сейф закрыт</span>
  }

  const p = period > 0 ? period : 30
  const pct = Math.round((left / p) * 100)
  const pretty = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code

  return (
    <div className="vt-totp" data-testid="totp-cell">
      <span className="vt-totp-code mono num" data-testid="totp-code">
        {pretty}
      </span>
      <span className="vt-totp-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="vt-totp-left num">{left}с</span>
      <button
        className={`vt-icon-btn${copied ? ' ok' : ''}`}
        title="Скопировать код (буфер очистится через 5 с)"
        aria-label="Скопировать код TOTP"
        data-testid="totp-copy"
        onClick={async () => {
          await s.copySecret(code, 'totp', 'Код TOTP')
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? <IconCheck /> : <IconClip />}
      </button>
    </div>
  )
}
