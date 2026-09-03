'use client'

/* ============================================================
   ДАННЫЕ · импорт с превью, экспорт (шифрованный / plaintext), бэкапы
   Валидация входа руками, лимит 5 МБ, whitelist полей (lib/secrets-io).
   ============================================================ */

import { useRef, useState } from 'react'
import { IconClose } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { MAX_IMPORT_BYTES, detectAndImport, download, type ImportPreview } from '@/lib/secrets-io'
import { useDialog } from '@/hooks/use-dialog'

type Tab = 'import' | 'export' | 'backup'

const CONFIRM_WORD = 'ЭКСПОРТ'

export function VaultIo({ onClose }: { onClose: () => void }) {
  const s = useSecrets()
  const [tab, setTab] = useState<Tab>('import')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const encPicker = useRef<HTMLInputElement>(null)

  const { dialogProps } = useDialog<HTMLDivElement>({ onClose, label: 'Импорт, экспорт и бэкапы' })

  async function readFile(file: File): Promise<string | null> {
    if (file.size > MAX_IMPORT_BYTES) {
      setMsg(`Файл больше ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} МБ — отклонён`)
      return null
    }
    return file.text()
  }

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={onClose}>
      <div
        className="vt-modal panel vt-modal-wide"
        {...dialogProps}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="vault-io"
      >
        <header className="vt-modal-head">
          <span className="label-mono">Данные сейфа секретов</span>
          <button className="vt-icon-btn" onClick={onClose} aria-label="Закрыть" data-testid="io-close">
            <IconClose />
          </button>
        </header>

        <div className="vt-seg" role="tablist" aria-label="Раздел">
          {(
            [
              ['import', 'Импорт'],
              ['export', 'Экспорт'],
              ['backup', 'Бэкапы'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`vt-seg-btn${tab === id ? ' on' : ''}`}
              onClick={() => {
                setTab(id)
                setMsg(null)
              }}
              data-testid={`io-tab-${id}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'import' && (
          <div className="vt-form">
            <p className="vt-note">
              CSV из KeePassXC, Bitwarden, 1Password, LastPass или Bitwarden JSON. Перед импортом
              покажем сводку — ничего не запишется без подтверждения.
            </p>
            <input
              ref={picker}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const text = await readFile(file)
                if (text === null) return
                setPreview(detectAndImport(text, file.name))
                setMsg(null)
              }}
              data-testid="io-file"
            />
            <div className="vt-form-row">
              <button className="btn btn-ghost btn-sm" onClick={() => picker.current?.click()} data-testid="io-pick">
                Выбрать файл экспорта
              </button>
              <input
                ref={encPicker}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  const text = await readFile(file)
                  if (text === null) return
                  const res = await s.importEncrypted(pass, text)
                  if (!res) {
                    setMsg('Не удалось открыть снимок: неверный пароль или не наш формат')
                    return
                  }
                  setPreview(res)
                  setMsg(null)
                }}
                data-testid="io-enc-file"
              />
              <input
                className="input vt-inline-input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="пароль зашифрованного снимка"
                autoComplete="off"
                data-testid="io-enc-pass"
              />
              <button
                className="btn btn-ghost btn-sm"
                disabled={pass.length < 4}
                onClick={() => encPicker.current?.click()}
                data-testid="io-enc-pick"
              >
                Открыть зашифрованный снимок
              </button>
            </div>

            {preview && (
              <div className="vt-preview" data-testid="io-preview">
                <div className="vt-preview-head">
                  <b className="num">{preview.total}</b> записей из «{preview.source}»
                </div>
                <ul className="vt-preview-list">
                  {Object.entries(preview.byType).map(([label, n]) => (
                    <li key={label}>
                      {label}: <b className="num">{n}</b>
                    </li>
                  ))}
                  {preview.withTotp > 0 && (
                    <li>
                      с TOTP: <b className="num">{preview.withTotp}</b>
                    </li>
                  )}
                  {preview.skipped > 0 && (
                    <li>
                      пропущено строк: <b className="num">{preview.skipped}</b>
                    </li>
                  )}
                </ul>
                {preview.errors.map((err) => (
                  <p className="vt-error" key={err}>
                    {err}
                  </p>
                ))}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={preview.total === 0 || busy || !s.ready}
                  data-testid="io-apply"
                  onClick={async () => {
                    setBusy(true)
                    const res = await s.applyImport(preview)
                    setBusy(false)
                    setPreview(null)
                    setMsg(
                      res.repeated
                        ? 'Этот импорт уже выполнен — записи не задваивались'
                        : `Импортировано ${res.added}${res.failed ? `, не удалось ${res.failed}` : ''}`,
                    )
                  }}
                >
                  {busy ? 'Шифрую…' : `Импортировать ${preview.total}`}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'export' && (
          <div className="vt-form">
            <label className="vt-field">
              <span className="label-mono">Пароль зашифрованного экспорта (AES-GCM · PBKDF2 600k)</span>
              <input
                className="input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="off"
                data-testid="io-export-pass"
              />
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={pass.length < 8 || busy}
              data-testid="io-export-enc"
              onClick={async () => {
                setBusy(true)
                const json = await s.exportEncrypted(pass)
                setBusy(false)
                if (!json) {
                  setMsg('Нужен открытый сейф — разблокируйте замок')
                  return
                }
                download(`workflow-secrets-${Date.now()}.json`, json, 'application/json')
                setMsg('Зашифрованный снимок скачан')
              }}
            >
              Скачать зашифрованный снимок
            </button>

            <div className="vt-danger-box" data-testid="io-plain-box">
              <p className="vt-danger-title">Экспорт в открытом виде</p>
              <p className="vt-note">
                Файл будет содержать пароли, seed-фразы и TOTP-секреты ЧИТАЕМЫМ текстом. Любой, кто
                получит файл, получит ваш сейф. Удалите файл вручную после использования — ОС не
                гарантирует безопасное стирание.
              </p>
              <label className="vt-field">
                <span className="label-mono">Введите слово {CONFIRM_WORD} для подтверждения</span>
                <input
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  data-testid="io-confirm"
                />
              </label>
              <div className="vt-form-row">
                <button
                  className="btn btn-danger btn-sm"
                  disabled={confirm !== CONFIRM_WORD || busy}
                  data-testid="io-export-csv"
                  onClick={async () => {
                    setBusy(true)
                    const csv = await s.exportPlain('csv')
                    setBusy(false)
                    if (!csv) return
                    download(`workflow-secrets-PLAINTEXT-${Date.now()}.csv`, csv, 'text/csv')
                    setConfirm('')
                  }}
                >
                  CSV без шифрования
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={confirm !== CONFIRM_WORD || busy}
                  data-testid="io-export-json"
                  onClick={async () => {
                    setBusy(true)
                    const json = await s.exportPlain('json')
                    setBusy(false)
                    if (!json) return
                    download(`workflow-secrets-PLAINTEXT-${Date.now()}.json`, json, 'application/json')
                    setConfirm('')
                  }}
                >
                  JSON без шифрования
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'backup' && (
          <div className="vt-form">
            <p className="vt-note">
              Бэкап — зашифрованный мастер-ключом снимок в этом же браузере. Хранится максимум 5
              копий (ротация), авто-бэкап не чаще раза в час. Восстановление ЗАМЕНЯЕТ текущий
              состав сейфа снимком (корзина не тронута).
            </p>
            <div className="vt-form-row">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !s.ready}
                data-testid="io-backup-now"
                onClick={async () => {
                  setBusy(true)
                  const ok = await s.backupNow(false)
                  setBusy(false)
                  setMsg(ok ? 'Бэкап создан' : 'Нужен открытый сейф')
                }}
              >
                Создать бэкап
              </button>
              <button
                className={`chip${s.settings.autoBackup ? ' on' : ''}`}
                aria-pressed={s.settings.autoBackup}
                onClick={() => s.setSettings((p) => ({ ...p, autoBackup: !p.autoBackup }))}
                data-testid="io-autobackup"
              >
                Авто-бэкап
              </button>
            </div>
            <div className="vt-backups" data-testid="io-backups">
              {s.backups.length === 0 && <p className="vt-note">Бэкапов пока нет.</p>}
              {s.backups.map((b) => (
                <div className="vt-backup-row" key={b.at}>
                  <span className="mono">{new Date(b.at).toLocaleString('ru-RU')}</span>
                  <span className="label-mono">
                    {b.count} записей · {b.auto ? 'авто' : 'вручную'}
                  </span>
                  <span className="grow" />
                  <button
                    className="btn btn-ghost btn-sm"
                    data-testid={`io-restore-${b.at}`}
                    title="Заменить текущий состав сейфа этим снимком"
                    onClick={async () => {
                      setBusy(true)
                      const added = await s.restoreBackup(b.at)
                      setBusy(false)
                      setMsg(
                        added === null
                          ? 'Не удалось расшифровать бэкап'
                          : `Состав заменён снимком: ${added} записей`,
                      )
                    }}
                  >
                    Восстановить
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => s.removeBackup(b.at)}
                    data-testid={`io-drop-${b.at}`}
                  >
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && (
          <p className="vt-ok" role="status" data-testid="io-msg">
            {msg}
          </p>
        )}

        <footer className="vt-modal-foot">
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  )
}
