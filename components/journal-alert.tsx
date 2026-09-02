'use client'

/* ============================================================
   ТРЕВОЖНЫЕ СОБЫТИЯ ЖУРНАЛА · метка в статус-баре (LG-3)
   Необратимое (смена и сброс мастер-ключа, выключенный замок, экспорт без
   шифрования, стирание сейфа, отказ от ключа) не должно тонуть в настройках.
   Метка появляется только когда такие записи есть и ведёт прямо в журнал.
   ============================================================ */

import { useEffect, useState } from 'react'
import { isSevereKind, readJournal, subscribeJournal } from '@/lib/journal'
import { useNavStore } from '@/lib/vault-store'
import { IconShield } from './icons'

export function JournalAlert() {
  const { openSetting } = useNavStore()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const load = () => {
      void readJournal().then((rows) => setCount(rows.filter((r) => isSevereKind(r.kind)).length))
    }
    load()
    return subscribeJournal(load)
  }, [])

  if (count === 0) return null

  return (
    <button
      type="button"
      className="sb-alert"
      onClick={() => openSetting('journal')}
      title="Открыть журнал безопасности: только необратимые события"
      data-testid="status-journal-alert"
    >
      <IconShield width={12} height={12} />
      ЖУРНАЛ · {count} НЕОБРАТИМ{count === 1 ? 'ОЕ' : 'ЫХ'}
    </button>
  )
}
