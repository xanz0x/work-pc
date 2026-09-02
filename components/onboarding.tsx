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
import { validateSecret, type LockMethod } from '@/lib/lock-store'
import {
  needsOnboarding,
  shouldMarkOnboarded,
  type KeyChoice,
  type PrivacyMode,
  type StartChoice,
} from '@/lib/onboarding'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import { useLockStore, useNavStore, useNotifsStore, useSettingsStore } from '@/lib/vault-store'
import { IconCheck, IconFolder, IconLockRound, IconShield } from './icons'
import '@/app/styles/onboarding.css'

const MODES: PrivacyMode[] = ['local', 'hybrid']

/** Что именно покидает устройство в каждом режиме — без обтекаемых формулировок. */
const LEAKS: Record<PrivacyMode, string[]> = {
  local: [
    'Ничего: индексация, поиск и ответы модели считаются на этом устройстве.',
    'Внешних запросов нет — в статус-баре так и написано.',
    'Нужен запущенный Ollama с выбранной моделью, иначе чат честно откажет.',
  ],
  hybrid: [
    'Текст вашего вопроса и подобранные фрагменты файлов уходят провайдеру модели.',
    'Имена файлов и метки попадают в запрос как контекст.',
    'Индексация и хранение остаются локальными: сам файл не выгружается.',
    'Согласие фиксируется с датой и отзывается в настройках одним переключателем.',
  ],
}

/** Атрибуты выбора папки для фолбэка без File System Access API. */
const DIR_ATTRS = { webkitdirectory: 'true', directory: 'true' } as unknown as Record<string, string>

export function Onboarding() {
  const S = useSettingsStore()
  const L = useLockStore()
  const NAV = useNavStore()
  const { notify } = useNotifsStore()
  const idxa = useIndexActions()
  const idx = useIndexSummary()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [active, setActive] = useState<boolean | null>(null)
  const [mode, setMode] = useState<PrivacyMode | null>(null)
  const [ack, setAck] = useState(false)
  const [method, setMethod] = useState<LockMethod>('pin')
  const [secret, setSecret] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [keyChoice, setKeyChoice] = useState<KeyChoice | null>(null)
  const [declining, setDeclining] = useState(false)
  const dirPicker = useRef<HTMLInputElement>(null)

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
        setMode(onb.mode ?? 'local')
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
    const err = await L.setupLock(secret, method)
    if (err) {
      setError(err)
      return
    }
    setSecret('')
    setRepeat('')
    setKeyChoice('created')
    S.noteOnboarding({ mode, keyChoice: 'created' })
    setStep(3)
  }

  function declineKey() {
    setKeyChoice('declined')
    setDeclining(false)
    S.noteOnboarding({ mode, keyChoice: 'declined' })
    notify({
      kind: 'warn',
      cat: 'privacy',
      icon: 'shield',
      title: 'Сейф создан без мастер-ключа',
      body: 'Отказ зафиксирован при первом запуске. Внешние запросы отключены, замок можно включить в настройках в любой момент.',
      link: { kind: 'setting', id: 'privacy' },
    })
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
        `Режим: ${keyChoice === 'declined' ? 'локальный (без ключа облако отключено)' : mode === 'local' ? 'локальный' : 'гибридный'}. ` +
        `Мастер-ключ: ${keyChoice === 'created' ? 'создан' : 'не создан'}. ` +
        `Начали с: ${start === 'folder' ? 'подключения папки' : 'демо-корпуса'}.`,
    })
    NAV.go('library')
  }

  function pickFolder() {
    finish('folder')
    if (idx.fsaSupported) void idxa.connectFolder()
    else dirPicker.current?.click()
  }

  const canNext1 = mode !== null && (mode === 'local' || ack)
  const canCreate = secret.length > 0 && repeat.length > 0 && !L.lock.busy

  return (
    <div
      className="onb"
      role="dialog"
      aria-modal="true"
      aria-label="Первый запуск"
      data-testid="onboarding"
      data-step={step}
    >
      <div className="onb-card">
        <div className="onb-head">
          <span className="onb-mark" aria-hidden="true">
            <IconShield />
          </span>
          <span>
            <h1>WorkfloW · первый запуск</h1>
            <p>Три шага, после которых сейф защищён и знает, где ваши файлы.</p>
          </span>
          <span className="onb-steps" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={step === n ? 'now' : step > n ? 'done' : ''} />
            ))}
          </span>
        </div>

        {/* ---------- шаг 1 · режим приватности ---------- */}
        {step === 1 && (
          <>
            <div className="onb-body">
              <p className="onb-kicker">Шаг 1 из 3 · приватность</p>
              <h2 className="onb-title">Где считать и что можно отпускать наружу</h2>
              <p className="onb-lede">
                Режим меняется в настройках в любой момент, но начать честнее с осознанного
                выбора: ниже — ровно то, что уходит с устройства.
              </p>

              <div className="onb-grid">
                {MODES.map((id) => {
                  const e = ENGINES.find((x) => x.id === id)!
                  return (
                    <button
                      key={id}
                      className="onb-pick"
                      aria-pressed={mode === id}
                      onClick={() => {
                        setMode(id)
                        setAck(false)
                      }}
                      data-testid={`onb-mode-${id}`}
                    >
                      <span className="onb-pick-top">
                        <span className="onb-pick-name">{e.name}</span>
                        {e.badge && <span className="onb-badge">{e.badge}</span>}
                      </span>
                      <span className="onb-pick-sub">{e.sub}</span>
                    </button>
                  )
                })}
              </div>

              {mode && (
                <div
                  className={`onb-leaks${mode === 'local' ? ' ok' : ''}`}
                  data-testid="onb-leaks"
                >
                  <p className="onb-kicker">
                    {mode === 'local' ? 'Что уходит: ничего' : 'Что уходит наружу'}
                  </p>
                  <ul>
                    {LEAKS[mode].map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  {mode === 'hybrid' && (
                    <label className="onb-ack">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        data-testid="onb-cloud-ack"
                      />
                      <span>
                        Понимаю: в гибридном режиме вопрос и фрагменты файлов уходят внешнему
                        провайдеру. Согласие будет записано с датой.
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>

            <div className="onb-foot">
              <span className="onb-legend">Шаг 1 / 3</span>
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
              <h2 className="onb-title">Ключ, без которого сейф не открывается</h2>
              <p className="onb-lede">
                Ключ выводится PBKDF2 (600 000 итераций) и остаётся на устройстве: восстановить
                его нельзя ни нам, ни вам. Он же защищает пароли в менеджере секретов.
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

              <div className="onb-fields">
                <label className="onb-field">
                  <span>{method === 'pin' ? 'PIN' : 'Пароль'}</span>
                  <input
                    type="password"
                    inputMode={method === 'pin' ? 'numeric' : 'text'}
                    maxLength={method === 'pin' ? 8 : 128}
                    autoComplete="new-password"
                    value={secret}
                    onChange={(e) => {
                      setSecret(method === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)
                      setError(null)
                    }}
                    data-testid="onb-secret"
                  />
                </label>
                <label className="onb-field">
                  <span>Повторите</span>
                  <input
                    type="password"
                    inputMode={method === 'pin' ? 'numeric' : 'text'}
                    maxLength={method === 'pin' ? 8 : 128}
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => {
                      setRepeat(method === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)
                      setError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canCreate) void createKey()
                    }}
                    data-testid="onb-secret-repeat"
                  />
                </label>
              </div>

              {error && (
                <p className="onb-err" role="alert" data-testid="onb-key-error">
                  {error}
                </p>
              )}
              <p className="onb-note">
                {method === 'pin'
                  ? 'PIN: от 4 до 8 цифр. Шесть — разумный минимум для локального сейфа.'
                  : 'Пароль: минимум 8 символов, лучше фраза из четырёх слов.'}
              </p>

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
                {L.lock.busy ? 'Вывожу ключ…' : 'Создать мастер-ключ'}
              </button>
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
                    {idx.fsaSupported
                      ? 'Браузер спросит разрешение, дальше индексация идёт в фоне — с честным прогрессом и отменой.'
                      : 'Этот браузер не даёт доступ к папке целиком: выберите её через диалог выбора файлов.'}
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
    </div>
  )
}
