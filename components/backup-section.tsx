'use client'

/* ============================================================
   NF-7 · РАЗДЕЛ НАСТРОЕК «БЭКАП ВСЕГО СЕЙФА»
   Один снимок всех модулей под ОТДЕЛЬНЫМ паролем, ротация, расписание
   и восстановление с превью и выбором модулей.

   Три обещания, которые этот экран обязан держать:
   1. Пароль снимка не равен мастер-ключу и не хранится в открытом виде:
      он заворачивается мастер-ключом сеанса, чтобы расписание работало
      без вопросов, а закрытый сейф не отдавал его никому.
   2. Числа в списке — из снимка, а не из головы: сколько записей уехало,
      столько и показано.
   3. Восстановление сначала показывает состав и только потом пишет.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { IconDatabase, IconRefresh, IconTrash } from './icons'
import { useVault } from '@/lib/vault-store'
import { useFlags } from '@/lib/flags'
import { download } from '@/lib/secrets-io'
import { fmtBytes } from '@/lib/data'
import {
  ALL_MODULE_IDS,
  KEEP_CHOICES,
  MODULES,
  createSnapshot,
  forgetPassword,
  listSnapshots,
  liveOf,
  moduleLabel,
  nextDueAt,
  openSnapshot,
  parseSnapshotFile,
  readConfig,
  readSnapshot,
  rememberPassword,
  removeSnapshot,
  restoreSnapshot,
  scheduleLabel,
  snapshotFile,
  summarize,
  writeConfig,
  type BackupConfig,
  type ModuleId,
  type RestoreMode,
  type RestoreReport,
  type Schedule,
  type SnapshotMeta,
  type SnapshotPayload,
  type SnapshotSummary,
} from '@/lib/backup'
import type { PortableBlob } from '@/lib/secrets-crypto'

const SCHEDULES: Schedule[] = ['off', 'daily', 'weekly']
const MIN_PWD = 8

type Pending = {
  payload: SnapshotPayload
  sum: SnapshotSummary
  source: string
}

const stamp = (at: number) => new Date(at).toLocaleString('ru-RU')

export function BackupSection() {
  const v = useVault()
  const flags = useFlags()
  const unlocked = v.lock.status === 'unlocked'

  const [cfg, setCfg] = useState<BackupConfig | null>(null)
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([])
  const [busy, setBusy] = useState(false)

  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')

  /* Восстановление: источник → пароль → превью → запись. */
  const [blob, setBlob] = useState<{ blob: PortableBlob; source: string } | null>(null)
  const [openPwd, setOpenPwd] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [picked, setPicked] = useState<ModuleId[]>([])
  const [mode, setMode] = useState<RestoreMode>('replace')
  const [report, setReport] = useState<RestoreReport | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setCfg(await readConfig())
    setSnaps(await listSnapshots())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const modules = cfg?.modules ?? ALL_MODULE_IDS

  function toggleModule(id: ModuleId) {
    const next = modules.includes(id) ? modules.filter((m) => m !== id) : [...modules, id]
    if (next.length === 0) return
    setCfg((c) => (c ? { ...c, modules: next } : c))
    void writeConfig({ modules: next }).then(setCfg)
  }

  async function create() {
    setErr(null)
    if (pwd.length < MIN_PWD) {
      setErr(`Пароль снимка — минимум ${MIN_PWD} символов: он единственный ключ к файлу.`)
      return
    }
    if (!cfg?.pwd && pwd !== pwd2) {
      setErr('Пароль и повтор не совпали.')
      return
    }
    setBusy(true)
    const made = await createSnapshot(pwd, modules, false, liveOf(v))
    if (!made) {
      setBusy(false)
      setErr(
        'Снимок не сохранён. Проверьте пароль и выбранные модули; если в снимке «Индекс содержимого», хранилищу может не хватать места — снимите этот модуль или уменьшите число копий.',
      )
      return
    }
    if (unlocked) await rememberPassword(pwd)
    await writeConfig({ lastAt: made.meta.at })
    setPwd('')
    setPwd2('')
    await refresh()
    setBusy(false)
    v.flash(
      `Снимок создан: ${made.meta.modules.length} модулей, ${made.meta.modules.reduce((a, m) => a + m.items, 0)} записей.` +
        (made.dropped.length > 0 ? ` Ротация удалила ${made.dropped.length} старых.` : ''),
    )
  }

  async function downloadSnap(meta: SnapshotMeta) {
    const stored = await readSnapshot(meta.id)
    if (!stored) {
      v.flash('Файл снимка не найден в хранилище.')
      return
    }
    const file = snapshotFile(meta, stored)
    download(file.name, file.text, 'application/json')
  }

  async function pickLocal(meta: SnapshotMeta) {
    const stored = await readSnapshot(meta.id)
    if (!stored) {
      v.flash('Файл снимка не найден в хранилище.')
      return
    }
    setReport(null)
    setPending(null)
    setErr(null)
    setOpenPwd('')
    setBlob({ blob: stored, source: `снимок от ${stamp(meta.at)}` })
  }

  async function pickFile(file: File) {
    const text = await file.text()
    const parsed = parseSnapshotFile(text)
    if (!parsed) {
      setErr('Это не файл снимка WorkSpaceX (.vaultbak).')
      return
    }
    setReport(null)
    setPending(null)
    setErr(null)
    setOpenPwd('')
    setBlob({ blob: parsed.blob, source: `файл ${file.name}` })
  }

  async function openPreview() {
    if (!blob) return
    setBusy(true)
    setErr(null)
    const payload = await openSnapshot(openPwd, blob.blob)
    setBusy(false)
    if (!payload) {
      setErr('Пароль не подошёл либо файл повреждён — GCM-тег не сошёлся.')
      return
    }
    const sum = summarize(payload)
    setPending({ payload, sum, source: blob.source })
    setPicked(sum.modules.map((m) => m.id))
  }

  async function apply() {
    if (!pending || picked.length === 0) return
    setBusy(true)
    const res = await restoreSnapshot(pending.payload, picked, mode)
    setBusy(false)
    setReport(res)
    setBlob(null)
    setPending(null)
    setOpenPwd('')
    await refresh()
  }

  const due = cfg ? nextDueAt(cfg) : null
  return (
    <section className="sec panel" id="set-backup" data-testid="settings-backup">
      <div className="sec-head">
        <span className="sec-icon">
          <IconDatabase />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Бэкап всего сейфа</div>
          <div className="setting-note">
            Один зашифрованный снимок всех модулей под отдельным паролем, ротация и расписание
          </div>
        </div>
        <span className="sec-meta label-mono num" data-testid="backup-count">
          {snaps.length} {snaps.length === 1 ? 'снимок' : 'снимков'}
        </span>
      </div>

      {/* ---------- состав снимка ---------- */}
      <div className="field-block" style={{ marginTop: 0 }}>
        <span className="label-mono">Что входит в снимок</span>
        <div className="bk-mods">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="checkbox"
              aria-checked={modules.includes(m.id)}
              className={`bk-mod${modules.includes(m.id) ? ' on' : ''}`}
              onClick={() => toggleModule(m.id)}
              data-testid={`backup-module-${m.id}`}
            >
              <i />
              <span className="bk-mod-text">
                <b>{m.label}</b>
                <span>{m.note}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="sec-note">
          Мастер-ключ и состояние замка в снимок не входят: снимок открывается своим паролем и на
          чистом устройстве ложится под новый мастер-ключ.{' '}
          {unlocked
            ? 'Сейф открыт — ключ сейфа секретов и файловые ключи уедут в снимок и переупакуются при восстановлении.'
            : 'Сейф закрыт: снимок будет без ключевого материала, и секреты на другом устройстве не откроются.'}
        </div>
      </div>

      {/* ---------- создание ---------- */}
      <div className="field-block">
        <span className="label-mono">Пароль снимка</span>
        {cfg?.pwd ? (
          <div className="setting-row" data-testid="backup-pwd-known">
            <div className="setting-row-text">
              <div className="setting-title">Пароль запомнен</div>
              <div className="setting-note">
                Завёрнут мастер-ключом сеанса: снимки по расписанию делаются без вопросов, а из
                закрытого сейфа пароль не достать.
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              data-testid="backup-forget-pwd"
              onClick={() => void forgetPassword().then(refresh)}
            >
              Забыть
            </button>
          </div>
        ) : null}
        <div className="folder-row">
          <input
            className="input input-mono"
            type="password"
            placeholder={cfg?.pwd ? 'пароль снимка' : `пароль снимка · минимум ${MIN_PWD} знаков`}
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            aria-label="Пароль снимка"
            data-testid="backup-pwd"
          />
          {!cfg?.pwd && (
            <input
              className="input input-mono"
              type="password"
              placeholder="повтор"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              aria-label="Повтор пароля снимка"
              data-testid="backup-pwd2"
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || pwd.length < MIN_PWD}
            onClick={() => void create()}
            data-testid="backup-create"
          >
            <IconDatabase />
            Сделать снимок
          </button>
        </div>
        {err && !pending && (
          <div className="sec-note" data-testid="backup-error">
            {err}
          </div>
        )}
      </div>

      {/* ---------- расписание и ротация ---------- */}
      <div className="field-block">
        <span className="label-mono">Расписание и ротация</span>
        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Автоматический снимок</div>
            <div className="setting-note">
              Планировщик клиентский: при запуске приложения проверяем, не просрочено ли.
              {due !== null ? ` Следующий — не раньше ${stamp(due)}.` : ' Расписание выключено.'}
            </div>
          </div>
          <div className="vt-seg small" role="radiogroup" aria-label="Расписание бэкапа">
            {SCHEDULES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={cfg?.schedule === s}
                className={`vt-seg-btn${cfg?.schedule === s ? ' on' : ''}`}
                onClick={() => void writeConfig({ schedule: s }).then(setCfg)}
                data-testid={`backup-schedule-${s}`}
              >
                {scheduleLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Сколько снимков держать</div>
            <div className="setting-note">
              Ротация — часть записи: лишние снимки удаляются вместе со своими документами.
            </div>
          </div>
          <div className="vt-seg small" role="radiogroup" aria-label="Глубина ротации">
            {KEEP_CHOICES.map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={cfg?.keep === k}
                className={`vt-seg-btn${cfg?.keep === k ? ' on' : ''}`}
                onClick={() => void writeConfig({ keep: k }).then(setCfg)}
                data-testid={`backup-keep-${k}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        {cfg?.schedule !== 'off' && !cfg?.pwd && (
          <div className="sec-note" data-testid="backup-schedule-warn">
            Расписание включено, но пароль снимка не запомнен: авто-снимок не будет сделан, пока вы
            не создадите снимок вручную при открытом сейфе.
          </div>
        )}
      </div>

      {/* ---------- снимки ---------- */}
      <div className="field-block">
        <span className="label-mono">Снимки</span>
        {snaps.length === 0 ? (
          <div className="stat-line">Снимков нет — список пуст, а не «примерно пуст».</div>
        ) : (
          <div className="bk-list" data-testid="backup-list">
            {snaps.map((m) => (
              <div className="bk-row" key={m.id} data-testid={`backup-row-${m.id}`}>
                <span className="bk-row-main">
                  <b className="mono">{stamp(m.at)}</b>
                  <span className="setting-note">
                    {m.modules.length} модулей ·{' '}
                    <span className="num">{m.modules.reduce((a, x) => a + x.items, 0)}</span> записей ·{' '}
                    {fmtBytes(m.bytes)} · {m.hasKeys ? 'с ключами' : 'без ключей'}
                  </span>
                </span>
                <span className={`badge ${m.auto ? 'badge-info' : 'badge-ok'}`}>
                  {m.auto ? 'по расписанию' : 'вручную'}
                </span>
                <span className="bk-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void downloadSnap(m)}
                    data-testid={`backup-download-${m.id}`}
                  >
                    Скачать
                  </button>
                  <button
                    className="btn btn-tertiary btn-sm"
                    onClick={() => void pickLocal(m)}
                    data-testid={`backup-restore-${m.id}`}
                  >
                    <IconRefresh />
                    Восстановить
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void removeSnapshot(m.id).then(refresh)}
                    aria-label="Удалить снимок"
                    data-testid={`backup-remove-${m.id}`}
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- восстановление ---------- */}
      <div className="field-block">
        <span className="label-mono">Восстановление</span>
        <div className="folder-row">
          <label className="btn btn-ghost btn-sm" data-testid="backup-file-label">
            Открыть файл .vaultbak
            <input
              type="file"
              accept=".vaultbak,application/json"
              className="sr-only"
              data-testid="backup-file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pickFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <span className="setting-note">
            {blob
              ? `Источник: ${blob.source}`
              : 'Или нажмите «Восстановить» у снимка в списке выше.'}
          </span>
        </div>

        {blob && !pending && (
          <div className="folder-row" data-testid="backup-open-row">
            <input
              className="input input-mono"
              type="password"
              placeholder="пароль снимка"
              value={openPwd}
              onChange={(e) => setOpenPwd(e.target.value)}
              aria-label="Пароль снимка для открытия"
              data-testid="backup-open-pwd"
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || openPwd.length === 0}
              onClick={() => void openPreview()}
              data-testid="backup-open"
            >
              Показать состав
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setBlob(null)}>
              Отмена
            </button>
          </div>
        )}
        {err && (blob || pending) && (
          <div className="sec-note" data-testid="backup-open-error">
            {err}
          </div>
        )}

        {pending && (
          <div className="bk-preview" data-testid="backup-preview">
            <div className="mask-head">
              <span className="label-mono">
                Снимок от {stamp(pending.sum.at)} · сборка {pending.sum.build}
              </span>
              <span className={`badge ${pending.sum.hasKeys ? 'badge-ok' : 'badge-warn'}`}>
                {pending.sum.hasKeys ? 'ключевой материал есть' : 'ключей нет'}
              </span>
            </div>
            <div className="bk-mods">
              {pending.sum.modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="checkbox"
                  aria-checked={picked.includes(m.id)}
                  className={`bk-mod${picked.includes(m.id) ? ' on' : ''}`}
                  onClick={() =>
                    setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))
                  }
                  data-testid={`backup-pick-${m.id}`}
                >
                  <i />
                  <span className="bk-mod-text">
                    <b>{m.label}</b>
                    <span className="num">
                      {m.items} записей · {m.docs} документов
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="setting-row">
              <div className="setting-row-text">
                <div className="setting-title">Как применить</div>
                <div className="setting-note">
                  {mode === 'replace'
                    ? 'Замена: модуль станет ровно таким, каким он был в снимке.'
                    : 'Слияние: текущая версия записи побеждает, из снимка добавляется отсутствующее.'}
                </div>
              </div>
              <div className="vt-seg small" role="radiogroup" aria-label="Режим восстановления">
                <button
                  role="radio"
                  aria-checked={mode === 'replace'}
                  className={`vt-seg-btn${mode === 'replace' ? ' on' : ''}`}
                  onClick={() => setMode('replace')}
                  data-testid="backup-mode-replace"
                >
                  замена
                </button>
                {flags.flags.experimental && (
                  <button
                    role="radio"
                    aria-checked={mode === 'merge'}
                    className={`vt-seg-btn${mode === 'merge' ? ' on' : ''}`}
                    onClick={() => setMode('merge')}
                    data-testid="backup-mode-merge"
                  >
                    слияние
                  </button>
                )}
              </div>
            </div>
            <div className="bk-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPending(null)
                  setBlob(null)
                }}
              >
                Отмена
              </button>
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || picked.length === 0}
                onClick={() => void apply()}
                data-testid="backup-apply"
              >
                Восстановить {picked.length} из {pending.sum.modules.length}
              </button>
            </div>
            {!unlocked && (
              <div className="sec-note">
                Сейф закрыт: ключевой материал снимка применить нечем — секреты и файлы под ключом
                после восстановления не откроются, пока не разблокируете сейф и не повторите
                восстановление.
              </div>
            )}
          </div>
        )}

        {report && (
          <div className="bk-preview" data-testid="backup-report">
            <div className="setting-title">Восстановление выполнено</div>
            <div className="setting-note num">
              Модулей: {report.modules.map(moduleLabel).join(', ') || '—'} · документов{' '}
              {report.docs} · локальных ключей {report.local} · записей журнала долито{' '}
              {report.journal} · файловых ключей переупаковано {report.keys.files} · секретов
              стикеров {report.keys.notes} · ключ сейфа секретов{' '}
              {report.keys.sek ? 'принят' : 'не менялся'}
            </div>
            <div className="bk-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => location.reload()}
                data-testid="backup-reload"
              >
                <IconRefresh />
                Перезагрузить приложение
              </button>
            </div>
            <div className="sec-note">
              Экраны читают сейф при загрузке: перезагрузка нужна, чтобы показать восстановленное
              состояние, а не прежнее.
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
