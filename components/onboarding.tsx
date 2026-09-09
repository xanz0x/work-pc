'use client'

/* ============================================================
   ОНБОРДИНГ ИЗ ТРЁХ ШАГОВ (NF-4)
   Показывается один раз новому профилю поверх всего интерфейса:
     1. режим приватности — с честным перечнем того, что уходит;
     2. мастер-ключ (PIN 6–8 цифр или пароль) — отказ только явный,
        и он же режет облако: полудоверенного состояния не остаётся;
     3. папка (NF-1) или демо-корпус.
   Флаг прохождения живёт в профиле настроек, поэтому повторный вход
   онбординг не показывает. Политика — в `lib/onboarding.ts`.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { ENGINES } from '@/lib/data'
import { OnboardingModelStep } from './onboarding-model-step'
import { validateSecret, type LockMethod } from '@/lib/lock-store'
import {
  needsOnboarding,
  shouldMarkOnboarded,
  type KeyChoice,
  type PrivacyMode,
  type StartChoice,
} from '@/lib/onboarding'
import { useAccount } from '@/lib/account'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import { logJournal } from '@/lib/journal'
import { useLockStore, useNavStore, useNotifsStore, useSettingsStore } from '@/lib/vault-store'
import { IconCheck, IconFolder, IconLockRound, IconShield } from './icons'
import { MkPassField, MkPinRow, strengthPw } from './mk-fields'
import { FolderPickerDialog } from './folder-picker-dialog'
import { RecoveryCodeCard } from './recovery-key-dialog'
import { useDialog } from '@/hooks/use-dialog'
import '@/app/styles/onboarding.css'

/** Атрибуты выбора папки для фолбэка без File System Access API. */
const DIR_ATTRS = { webkitdirectory: 'true', directory: 'true' } as unknown as Record<string, string>

export function Onboarding() {
  const S = useSettingsStore()
  const L = useLockStore()
  const NAV = useNavStore()
  const { notify } = useNotifsStore()
  const account = useAccount()
  const idxa = useIndexActions()
  const idx = useIndexSummary()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [active, setActive] = useState<boolean | null>(null)
  const [mode, setMode] = useState<PrivacyMode>('hybrid')
  const [ack, setAck] = useState(false)
  /** Модель подключена на первом шаге (или уже была подключена раньше). */
  const [connectedModel, setConnectedModel] = useState<string | null>(null)
  const [method, setMethod] = useState<LockMethod>('pin')
  const [secret, setSecret] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Одноразовый код восстановления: выдаётся сразу после setupLock и показывается один раз. */
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [keyChoice, setKeyChoice] = useState<KeyChoice | null>(null)
  const [declining, setDeclining] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const dirPicker = useRef<HTMLInputElement>(null)
  const { dialogProps } = useDialog({
    onClose: () => {},
    label: 'Первый запуск',
    open: active === true && L.lock.status !== 'locked',
  })

  const lockConfigured = L.lock.status !== 'off' || L.lock.method !== null
  const onb = S.settings.onboarding

  /**
   * Решение «показывать или нет» принимается один раз: дальше онбординг
   * закрывает только его собственный финал. Иначе созданный на втором шаге
   * мастер-ключ выбивал бы человека с третьего шага — и режим не записался бы.
   */
  const markOnboarded = S.markOnboarded
  useEffect(() => {
    if (!S.ready || active !== null) return
    if (needsOnboarding(onb, lockConfigured)) {
      setActive(true)
      /* Перезагрузка посреди онбординга: ключ уже выбран — возвращаемся на шаг 3. */
      if (onb.keyChoice) {
        setKeyChoice(onb.keyChoice)
        setMode(onb.mode ?? 'hybrid')
        setStep(3)
      }
      return
    }
    setActive(false)
    if (shouldMarkOnboarded(onb, lockConfigured)) markOnboarded()
  }, [S.ready, active, onb, lockConfigured, markOnboarded])

  if (!active) return null

  async function createKey() {
    setError(null)
    const policy = validateSecret(secret, method)
    if (policy) {
      setError(policy)
      return
    }
    if (secret !== repeat) {
      setError(method === 'pin' ? 'PIN не совпал — введите одинаково' : 'Пароли не совпадают')
      return
    }
    /* Успех → одноразовый код восстановления (строка), неудача → null. */
    const code = await L.setupLock(secret, method)
    if (code === null) {
      setError('Не удалось создать мастер-ключ — подробности в ленте')
      return
    }
    setSecret('')
    setRepeat('')
    /* Код показываем здесь же, до перехода на шаг 3: он виден один раз. */
    setRecoveryCode(code)
  }

  /** Продолжение после того, как код записан. */
  function continueAfterCode() {
    setRecoveryCode(null)
    setKeyChoice('created')
    S.noteOnboarding({ mode, keyChoice: 'created' })
    setStep(3)
  }

  function declineKey() {
    setKeyChoice('declined')
    setDeclining(false)
    S.noteOnboarding({ mode, keyChoice: 'declined' })
    void logJournal(
      'key-declined',
      'Отказ от мастер-ключа при первом запуске',
      'Владелец явно отказался создавать мастер-ключ. Шифрование стикеров и менеджер секретов недоступны, режим опущен до локального, облако отключено.',
    ).then((jid) =>
      notify({
        kind: 'warn',
        cat: 'privacy',
        icon: 'shield',
        title: 'Сейф создан без мастер-ключа',
        body: 'Отказ зафиксирован при первом запуске. Внешние запросы отключены, замок можно включить в настройках в любой момент.',
        link: { kind: 'journal', id: jid },
      }),
    )
    setStep(3)
  }

  function finish(start: StartChoice) {
    if (!mode || !keyChoice) return
    S.finishOnboarding({ mode, keyChoice, start })
    setActive(false)
    notify({
      kind: keyChoice === 'created' ? 'ok' : 'warn',
      cat: 'system',
      icon: keyChoice === 'created' ? 'check' : 'shield',
      title: 'Первый запуск завершён',
      body:
        `Режим: ${keyChoice === 'declined' ? 'гибридный (без ключа согласие не выдано)' : mode === 'cloud' ? 'полный контекст' : 'гибридный'}. ` +
        `Мастер-ключ: ${keyChoice === 'created' ? 'создан' : 'не создан'}. ` +
        `Начали с: ${start === 'folder' ? 'подключения папки' : 'демо-корпуса'}.`,
    })
    NAV.go('library')
  }

  function pickFolder() {
    // В Electron-приложении «папка» — это и хранилище общего диска: выбираем
    // её нативным диалогом и сохраняем серверно (файлы будут писаться туда).
    const pick = (window as unknown as { workspacexDesktop?: { pickFolder?: () => Promise<string | null> } }).workspacexDesktop?.pickFolder
    if (typeof pick === 'function') {
      finish('folder')
      void pick().then(async (root) => {
        if (!root || !root.trim()) return
        try {
          await saveStorageRoot(root.trim())
        } catch { /* онбординг не блокируем: папку можно выбрать в настройках диска */ }
      })
      if (idx.fsaSupported) void idxa.connectFolder()
      else dirPicker.current?.click()
      return
    }
    /* В браузере абсолютного пути не получить, а серверу нужен именно он:
       выбираем папку обзором на этой машине — тем же диалогом, что в настройках.
       Папка диска общая, менять её может только администратор. */
    if (!account.isAdmin) {
      setFolderError('папку диска задаёт администратор')
      if (idx.fsaSupported) void idxa.connectFolder()
      else dirPicker.current?.click()
      return
    }
    setPickingFolder(true)
  }

  async function saveStorageRoot(root: string): Promise<void> {
    const r = await fetch('/ai-api/cloud/storage-root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, migrate: true }),
    })
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error ?? `сервер ответил ${r.status}`)
    }
  }

  const canNext1 = mode === 'hybrid' || ack
  /* PIN — ровно 6 цифр (как требует экран разблокировки), пароль — от 8. */
  const secretOk = method === 'pin' ? /^\d{6}$/.test(secret) : secret.length >= 8
  const canCreate = secretOk && secret === repeat && !L.lock.busy

  return (
    <div
      className="onb"
      {...dialogProps}
      data-testid="onboarding"
      data-step={step}
    >
      <div className="onb-card">
        <div className="onb-head">
          <span className="onb-mark" aria-hidden="true">
            <IconShield />
          </span>
          <span>
            <h1>WorkSpaceX · первый запуск</h1>
            <p>Три шага, после которых сейф защищён и знает, где ваши файлы.</p>
          </span>
          <span className="onb-steps" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={step === n ? 'now' : step > n ? 'done' : ''} />
            ))}
          </span>
        </div>

        {/* ---------- шаг 1 · подключение модели ---------- */}
        {step === 1 && (
          <>
            <div className="onb-body">
              <p className="onb-kicker">Шаг 1 из 3 · модель</p>
              <h2 className="onb-title">Подключите модель — устанавливать ничего не нужно</h2>
              <p className="onb-lede">
                Программа не скачивает модели на компьютер. Подключите ключ OpenRouter и выберите
                модель из живого списка либо укажите адрес своего OpenAI-совместимого сервера.
                Это можно сделать и позже, в настройках.
              </p>

              <OnboardingModelStep
                connected={connectedModel !== null}
                onConnected={(m) => setConnectedModel(m)}
              />

              <div className="onb-grid onb-grid-tight">
                {ENGINES.map((e) => (
                  <button
                    key={e.id}
                    className="onb-pick"
                    aria-pressed={mode === e.id}
                    onClick={() => {
                      setMode(e.id)
                      setAck(false)
                    }}
                    data-testid={`onb-mode-${e.id}`}
                  >
                    <span className="onb-pick-top">
                      <span className="onb-pick-name">{e.name}</span>
                      {e.badge && <span className="onb-badge">{e.badge}</span>}
                    </span>
                    <span className="onb-pick-sub">{e.sub}</span>
                  </button>
                ))}
              </div>

              <div className="onb-leaks" data-testid="onb-leaks">
                <p className="onb-kicker">Что уходит наружу</p>
                <ul>
                  <li>Текст вопроса и подобранные фрагменты файлов уходят подключённой модели.</li>
                  <li>Имена файлов и метки попадают в запрос как контекст.</li>
                  <li>Индексация и хранение остаются локальными: сам файл не выгружается.</li>
                  <li>Согласие фиксируется с датой и отзывается в настройках одним переключателем.</li>
                </ul>
                {mode === 'cloud' && (
                  <label className="onb-ack">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      data-testid="onb-cloud-ack"
                    />
                    <span>
                      Понимаю: в режиме «Полный контекст» фрагменты файлов уходят провайдеру целиком.
                      Согласие будет записано с датой.
                    </span>
                  </label>
                )}
              </div>
            </div>

            <div className="onb-foot">
              <span className="onb-legend">
                {connectedModel ? `Модель: ${connectedModel}` : 'Модель можно подключить позже'}
              </span>
              <span className="grow" />
              <button
                className="onb-btn primary"
                disabled={!canNext1}
                onClick={() => setStep(2)}
                data-testid="onb-step1-next"
              >
                Дальше · мастер-ключ
              </button>
            </div>
          </>
        )}

        {/* ---------- шаг 2 · мастер-ключ ---------- */}
        {step === 2 && (
          <>
            <div className="onb-body">
              <p className="onb-kicker">Шаг 2 из 3 · мастер-ключ</p>
              <h2 className="onb-title" data-testid="onb-key-title">Настройте мастер-ключ</h2>
              <p className="onb-lede" data-testid="onb-key-description">
                Он блокирует сейф и защищает секреты. После создания выдадим одноразовый ключ
                восстановления — запишите его: без кода утеря мастер-ключа означает потерю доступа
                к защищённым данным.
              </p>

              <div className="onb-methods">
                {(['pin', 'password'] as LockMethod[]).map((m) => (
                  <button
                    key={m}
                    className="onb-tab"
                    aria-pressed={method === m}
                    onClick={() => {
                      setMethod(m)
                      setSecret('')
                      setRepeat('')
                      setError(null)
                    }}
                    data-testid={`onb-method-${m}`}
                  >
                    {m === 'pin' ? 'PIN · 6 цифр' : 'Пароль · от 8 символов'}
                  </button>
                ))}
              </div>

              {recoveryCode ? (
                <div className="onb-keyfields">
                  <RecoveryCodeCard code={recoveryCode} testId="onb-recovery-code" />
                </div>
              ) : (
              <>
              <div className="onb-keyfields" onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement && canCreate) {
                  e.preventDefault()
                  void createKey()
                }
              }}>
                {method === 'pin' ? (
                  <>
                    <MkPinRow
                      idBase="onb-key-new"
                      label="Придумайте PIN"
                      hint={`${secret.length}/6`}
                      hintTone={secretOk ? 'ok' : secret ? 'bad' : undefined}
                      value={secret}
                      onChange={(next) => {
                        setSecret(next)
                        setError(null)
                      }}
                      hasError={Boolean(secret) && !secretOk}
                      testId="onb-secret"
                    />
                    <MkPinRow
                      idBase="onb-key-rep"
                      label="Повторите PIN"
                      hint={repeat && secret === repeat ? 'совпадает' : `${repeat.length}/6`}
                      hintTone={repeat && secret === repeat ? 'ok' : undefined}
                      value={repeat}
                      onChange={(next) => {
                        setRepeat(next)
                        setError(null)
                      }}
                      hasError={Boolean(repeat) && secret !== repeat}
                      testId="onb-secret-repeat"
                    />
                  </>
                ) : (
                  <>
                    <MkPassField
                      id="onb-key-new"
                      label="Мастер-пароль"
                      hint={secret ? `${secret.length} символов` : 'От 8 символов'}
                      hintTone={secretOk ? 'ok' : secret ? 'bad' : undefined}
                      value={secret}
                      onChange={(next) => {
                        setSecret(next)
                        setError(null)
                      }}
                      placeholder="от 8 символов"
                      autoComplete="new-password"
                      incomplete={Boolean(secret) && !secretOk}
                      testId="onb-secret"
                    >
                      {secret.length > 0 && (
                        <div className={`lock-strength s${strengthPw(secret)}`} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                      )}
                    </MkPassField>
                    <MkPassField
                      id="onb-key-rep"
                      label="Подтверждение"
                      hint={repeat && secret === repeat ? 'совпадает' : undefined}
                      hintTone={repeat && secret === repeat ? 'ok' : undefined}
                      value={repeat}
                      onChange={(next) => {
                        setRepeat(next)
                        setError(null)
                      }}
                      placeholder="Повторите"
                      autoComplete="new-password"
                      incomplete={Boolean(repeat) && secret !== repeat}
                      testId="onb-secret-repeat"
                    />
                  </>
                )}
              </div>

              {error && (
                <p className="onb-err" role="alert" data-testid="onb-key-error">
                  {error}
                </p>
              )}
              <p className="onb-note" data-testid="onb-key-hint">
                {method === 'pin'
                  ? 'PIN должен содержать 6 цифр.'
                  : 'Пароль должен содержать не менее 8 символов.'}
              </p>
              </>
              )}

              {declining ? (
                <div className="onb-decline" data-testid="onb-decline-confirm">
                  <p className="onb-kicker">Отказ фиксируется явно</p>
                  <p>
                    Без мастер-ключа шифрование стикеров и менеджер секретов работать не будут, а
                    гибридный режим выключится: мы не отправим наружу то, что даже локально не
                    защищено. Отказ попадёт в ленту событий сейфа.
                  </p>
                  <div className="onb-decline-acts">
                    <button
                      className="onb-btn danger"
                      onClick={declineKey}
                      data-testid="onb-decline-yes"
                    >
                      Да, продолжить без защиты
                    </button>
                    <button
                      className="onb-btn ghost"
                      onClick={() => setDeclining(false)}
                      data-testid="onb-decline-no"
                    >
                      Вернуться к созданию ключа
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="onb-foot">
              {recoveryCode ? (
                <>
                  <span className="grow" />
                  <button
                    className="onb-btn primary"
                    onClick={continueAfterCode}
                    data-testid="onb-recovery-done"
                  >
                    Я записал код — продолжить
                  </button>
                </>
              ) : (
              <>
              <button className="onb-btn ghost" onClick={() => setStep(1)} data-testid="onb-back">
                Назад
              </button>
              <span className="grow" />
              {!declining && (
                <button
                  className="onb-btn"
                  onClick={() => setDeclining(true)}
                  data-testid="onb-decline"
                >
                  Продолжить без защиты
                </button>
              )}
              <button
                className="onb-btn primary"
                disabled={!canCreate}
                onClick={() => void createKey()}
                data-testid="onb-create-key"
              >
                {L.lock.busy
                  ? 'Вывожу ключ…'
                  : secretOk
                    ? secret === repeat
                      ? 'Создать мастер-ключ'
                      : method === 'pin'
                        ? 'Повторите PIN'
                        : 'Повторите пароль'
                    : method === 'pin'
                      ? 'Введите 6 цифр'
                      : 'Минимум 8 символов'}
              </button>
              </>
              )}
            </div>
          </>
        )}

        {/* ---------- шаг 3 · источник ---------- */}
        {step === 3 && (
          <>
            <div className="onb-body">
              <p className="onb-kicker">Шаг 3 из 3 · с чего начать</p>
              <h2 className="onb-title">Подключить свою папку или посмотреть демо</h2>
              <p className="onb-lede">
                {keyChoice === 'created'
                  ? 'Мастер-ключ создан, замок включён.'
                  : 'Ключ не создан — сейф работает без защиты, облако отключено.'}{' '}
                Папка индексируется на устройстве: содержимое, чанки и хеши ложатся в локальную
                базу, файлы никуда не копируются.
              </p>

              <div className="onb-grid">
                <button className="onb-pick" onClick={pickFolder} data-testid="onb-pick-folder">
                  <span className="onb-pick-top">
                    <span className="onb-mark" aria-hidden="true">
                      <IconFolder />
                    </span>
                    <span className="onb-pick-name">Подключить папку</span>
                  </span>
                  <span className="onb-pick-sub">
                    Выберите папку на этом компьютере: она станет диском программы — каждый
                    добавленный файл физически ложится в неё, а её путь виден в настройках.
                  </span>
                </button>
                <button
                  className="onb-pick"
                  onClick={() => finish('demo')}
                  data-testid="onb-pick-demo"
                >
                  <span className="onb-pick-top">
                    <span className="onb-mark" aria-hidden="true">
                      <IconCheck />
                    </span>
                    <span className="onb-pick-name">Посмотреть демо</span>
                  </span>
                  <span className="onb-pick-sub">
                    Демо-корпус уже в сейфе: библиотека, карта памяти и чат работают сразу.
                    Содержимое демо-файлов не читается.
                  </span>
                </button>
              </div>

              {folderError && (
                <p className="onb-lede" data-testid="onb-folder-error">
                  Папку не удалось сохранить: {folderError}. Её можно выбрать позже в «Настройки → Общее облако».
                </p>
              )}

              {/* Фолбэк без File System Access API (Firefox/Safari). */}
              <input
                ref={dirPicker}
                type="file"
                multiple
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
                {...DIR_ATTRS}
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? [])
                  if (list.length > 0) void idxa.indexFiles(list)
                  e.target.value = ''
                }}
                data-testid="onb-dir-fallback"
              />
            </div>

            <div className="onb-foot">
              <span className="onb-legend">
                <IconLockRound width={12} height={12} />{' '}
                {keyChoice === 'created' ? 'ЗАМОК ВКЛЮЧЁН' : 'БЕЗ ЗАМКА · ОБЛАКО ВЫКЛЮЧЕНО'}
              </span>
              <span className="grow" />
              {keyChoice === 'declined' && (
                <button
                  className="onb-btn ghost"
                  onClick={() => {
                    setKeyChoice(null)
                    setStep(2)
                  }}
                  data-testid="onb-back-3"
                >
                  Вернуться и создать ключ
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {pickingFolder && (
        <FolderPickerDialog
          current={null}
          onClose={() => setPickingFolder(false)}
          onPick={(root) => {
            setPickingFolder(false)
            setFolderError(null)
            void saveStorageRoot(root)
              .then(() => finish('folder'))
              .catch((e: unknown) => setFolderError(e instanceof Error ? e.message : 'неизвестная ошибка'))
          }}
        />
      )}
    </div>
  )
}
