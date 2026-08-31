'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clearStorageFailures,
  storageFailures,
  subscribeStorage,
  type StorageFailure,
} from '@/lib/db/errors'
import { formatBytes, quotaInfo, type QuotaInfo } from '@/lib/db/quota'
import { retryPersisted } from '@/lib/db/persist'

/**
 * Ошибка записи больше не глушится (P0-3, шаг 5): «не сохранилось» с кнопкой
 * «Повторить», а переполнение квоты — честный экран, а не тихий сбой.
 */
export function StorageAlert() {
  const [fails, setFails] = useState<StorageFailure[]>([])
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setFails(storageFailures())
    sync()
    return subscribeStorage(sync)
  }, [])

  const full = fails.find((f) => f.kind === 'quota')

  useEffect(() => {
    if (!full) return
    void quotaInfo().then(setQuota)
  }, [full])

  const retry = useCallback(async () => {
    setBusy(true)
    await retryPersisted()
    setBusy(false)
  }, [])

  if (full) {
    return (
      <div className="storage-full" role="alertdialog" aria-modal="true" data-testid="storage-full">
        <div className="storage-full-card">
          <div className="storage-full-title">Нет места для хранилища</div>
          <p className="storage-full-body">
            Браузер отказал в записи: архив не сохраняется. Освободите место — удалите ненужные
            файлы из библиотеки или очистите старые диалоги, затем повторите запись.
          </p>
          <div className="storage-full-nums num">
            {quota
              ? `${formatBytes(quota.usage)} из ${formatBytes(quota.quota)}${
                  quota.ratio !== null ? ` · ${Math.round(quota.ratio * 100)}%` : ''
                }`
              : 'объём хранилища браузер не сообщает'}
          </div>
          <div className="storage-full-acts">
            <button
              type="button"
              className="btn btn-primary"
              onClick={retry}
              disabled={busy}
              data-testid="storage-full-retry"
            >
              {busy ? 'Повторяю…' : 'Повторить запись'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={clearStorageFailures}
              data-testid="storage-full-dismiss"
            >
              Продолжить без сохранения
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (fails.length === 0) return null

  return (
    <div className="storage-error-bar" role="status" aria-live="polite" data-testid="storage-error-bar">
      <span className="storage-error-bar-text">
        Не сохранилось: {fails.length === 1 ? fails[0].key : `${fails.length} записей`}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={retry}
        disabled={busy}
        data-testid="storage-retry"
      >
        {busy ? 'Повторяю…' : 'Повторить'}
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={clearStorageFailures}
        data-testid="storage-dismiss"
        aria-label="Скрыть предупреждение"
      >
        Скрыть
      </button>
    </div>
  )
}
