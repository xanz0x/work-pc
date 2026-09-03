'use client'

/* ============================================================
   ГЕНЕРАТОР · CSPRNG, локальная оценка силы, ноль сети
   v1.1: параметры — явные тумблеры с чекбоксом (вкл/выкл видно сразу)
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { IconCheck, IconClip, IconClose, IconRefresh } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { generateMnemonic, validateMnemonic, type MnemonicCheck } from '@/lib/bip39'
import { BIP39_WORDS } from '@/lib/bip39-words'
import { VtSelect } from './vt-select'
import { useDialog } from '@/hooks/use-dialog'
import {
  DEFAULT_GEN,
  DEFAULT_PHRASE,
  DEFAULT_USERNAME,
  generateHex,
  generatePassphrase,
  generatePassword,
  generatePin,
  generateUsername,
  generateUuid,
  phraseBits,
  scorePassword,
  type GenOptions,
  type PhraseOptions,
  type UsernameOptions,
} from '@/lib/secrets-gen'

type Mode = 'password' | 'passphrase' | 'username' | 'seed' | 'pin' | 'hex' | 'uuid'

const MODES: { id: Mode; label: string }[] = [
  { id: 'password', label: 'Пароль' },
  { id: 'passphrase', label: 'Фраза' },
  { id: 'username', label: 'Имя' },
  { id: 'seed', label: 'Seed BIP39' },
  { id: 'pin', label: 'PIN' },
  { id: 'hex', label: 'Hex-токен' },
  { id: 'uuid', label: 'UUID' },
]

const SEPARATORS: { value: string; label: string }[] = [
  { value: '-', label: 'дефис  a-b' },
  { value: '.', label: 'точка  a.b' },
  { value: '_', label: 'подчёрк  a_b' },
  { value: ' ', label: 'пробел  a b' },
]

const OPTS: { key: keyof GenOptions; label: string; hint: string }[] = [
  { key: 'upper', label: 'Прописные', hint: 'A–Z' },
  { key: 'lower', label: 'Строчные', hint: 'a–z' },
  { key: 'digits', label: 'Цифры', hint: '0–9' },
  { key: 'symbols', label: 'Символы', hint: '!#$%&*' },
  { key: 'noAmbiguous', label: 'Без похожих', hint: '0/O · 1/l · 5/S' },
  { key: 'memorable', label: 'Произносимый', hint: 'kuva-tery-9' },
]

export function VaultGenerator({
  onUse,
  onClose,
}: {
  onUse?: (value: string) => void
  onClose: () => void
}) {
  const s = useSecrets()
  const [mode, setMode] = useState<Mode>('password')
  const [opt, setOpt] = useState<GenOptions>(DEFAULT_GEN)
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)
  const [seedLen, setSeedLen] = useState<12 | 24>(12)
  const [phrase, setPhrase] = useState<PhraseOptions>(DEFAULT_PHRASE)
  const [uname, setUname] = useState<UsernameOptions>(DEFAULT_USERNAME)
  const [check, setCheck] = useState('')
  const [checkRes, setCheckRes] = useState<MnemonicCheck | null>(null)

  const roll = useCallback(() => {
    if (mode === 'pin') setValue(generatePin(6))
    else if (mode === 'hex') setValue(generateHex(24))
    else if (mode === 'uuid') setValue(generateUuid())
    else if (mode === 'seed') void generateMnemonic(seedLen).then((ws) => setValue(ws.join(' ')))
    else if (mode === 'passphrase') setValue(generatePassphrase(phrase, BIP39_WORDS))
    else if (mode === 'username') setValue(generateUsername(uname))
    else setValue(generatePassword(opt))
  }, [mode, opt, seedLen, phrase, uname])

  useEffect(roll, [roll])

  /* Живая проверка контрольной суммы вставленной фразы. */
  useEffect(() => {
    if (mode !== 'seed' || !check.trim()) {
      setCheckRes(null)
      return
    }
    let alive = true
    void validateMnemonic(check).then((r) => alive && setCheckRes(r))
    return () => {
      alive = false
    }
  }, [check, mode])

  /* UX-4: единый диалог — ловушка фокуса, Escape, возврат фокуса. */
  const { dialogProps } = useDialog<HTMLDivElement>({ onClose, label: 'Генератор паролей' })

  const st =
    mode === 'passphrase'
      ? (() => {
          const bits = phraseBits(phrase, BIP39_WORDS.length)
          const score: 0 | 1 | 2 | 3 | 4 = bits < 40 ? 1 : bits < 55 ? 2 : bits < 75 ? 3 : 4
          return {
            score,
            bits,
            label: ['Очень слабая', 'Слабая', 'Средняя', 'Хорошая', 'Крепкая'][score],
            hints: [`${phrase.words} слов из ${BIP39_WORDS.length}`],
          }
        })()
      : scorePassword(value)

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={onClose}>
      <div
        className="vt-modal panel vt-gen"
        {...dialogProps}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="generator-modal"
      >
        <header className="vt-modal-head">
          <span className="label-mono">Генератор · локально, CSPRNG</span>
          <button className="vt-icon-btn" onClick={onClose} aria-label="Закрыть" data-testid="generator-close">
            <IconClose />
          </button>
        </header>

        <div className="vt-seg" role="tablist" aria-label="Что генерировать">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`vt-seg-btn${mode === m.id ? ' on' : ''}`}
              onClick={() => setMode(m.id)}
              data-testid={`gen-mode-${m.id}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'seed' ? (
          <>
            <div className="vt-seed-head">
              <div className="vt-seg vt-seg-mini" role="tablist" aria-label="Длина фразы">
                {([12, 24] as const).map((n) => (
                  <button
                    key={n}
                    role="tab"
                    aria-selected={seedLen === n}
                    className={`vt-seg-btn${seedLen === n ? ' on' : ''}`}
                    onClick={() => setSeedLen(n)}
                    data-testid={`seed-len-${n}`}
                  >
                    {n === 12 ? '12 слов' : '24 слова'}
                  </button>
                ))}
              </div>
              <span className="grow" />
              <button className="vt-icon-btn" onClick={roll} title="Ещё раз" data-testid="generator-roll">
                <IconRefresh />
              </button>
              <button
                className={`vt-icon-btn${copied ? ' ok' : ''}`}
                title="Скопировать фразу"
                data-testid="generator-copy"
                onClick={async () => {
                  await s.copySecret(value, 'password', 'Seed-фраза BIP39')
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                }}
              >
                {copied ? <IconCheck /> : <IconClip />}
              </button>
            </div>
            <ol className="vt-seed-grid" data-testid="seed-words">
              {value.split(' ').map((w, i) => (
                <li key={`${i}-${w}`}>
                  <b className="num">{i + 1}</b>
                  <span className="mono">{w}</span>
                </li>
              ))}
            </ol>
            <p className="vt-note">
              BIP39 · {seedLen === 12 ? '128' : '256'} бит энтропии + контрольная сумма SHA-256.
              Словарь встроен, генерация полностью офлайн.
            </p>
            <label className="vt-field">
              <span className="label-mono">Проверка фразы · вставьте 12–24 слова</span>
              <textarea
                className="input mono"
                rows={2}
                value={check}
                onChange={(e) => setCheck(e.target.value)}
                placeholder="abandon ability able …"
                autoComplete="off"
                spellCheck={false}
                data-testid="seed-check-input"
              />
            </label>
            {checkRes && (
              <p
                className={checkRes.ok ? 'vt-seed-ok' : 'vt-error'}
                role="status"
                data-testid="seed-check-result"
              >
                {checkRes.ok ? '✓ ' : '✗ '}
                {checkRes.msg}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="vt-gen-out">
              <code className="vt-gen-value mono" data-testid="generator-value">
                {value}
              </code>
              <button className="vt-icon-btn" onClick={roll} title="Ещё раз" data-testid="generator-roll">
                <IconRefresh />
              </button>
              <button
                className={`vt-icon-btn${copied ? ' ok' : ''}`}
                title="Скопировать"
                data-testid="generator-copy"
                onClick={async () => {
                  await s.copySecret(value, 'password', 'Сгенерированное значение')
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                }}
              >
                {copied ? <IconCheck /> : <IconClip />}
              </button>
            </div>

            <div className="vt-strength" data-testid="generator-strength">
              <span className="vt-strength-bar" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={i <= st.score ? `on s${st.score}` : ''} />
                ))}
              </span>
              <span className="vt-strength-text">
                {st.label} · <b className="num">{st.bits}</b> бит
              </span>
              {st.hints.length > 0 && <span className="vt-strength-hint">{st.hints.join(' · ')}</span>}
            </div>
          </>
        )}

        {mode === 'password' ? (
          <div className="vt-gen-panel">
            <label className="vt-len">
              <span className="label-mono">Длина</span>
              <input
                type="range"
                min={8}
                max={64}
                value={opt.length}
                onChange={(e) => setOpt({ ...opt, length: Number(e.target.value) })}
                data-testid="gen-length"
              />
              <b className="vt-len-num num">{opt.length}</b>
            </label>
            <div className="vt-opts" role="group" aria-label="Параметры пароля">
              {OPTS.map(({ key, label, hint }) => {
                const on = Boolean(opt[key])
                return (
                  <button
                    key={String(key)}
                    className={`vt-opt${on ? ' on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    onClick={() => setOpt({ ...opt, [key]: !on } as GenOptions)}
                    data-testid={`gen-opt-${String(key)}`}
                  >
                    <i className="vt-opt-box" aria-hidden="true">
                      <IconCheck />
                    </i>
                    <span className="vt-opt-text">
                      <b>{label}</b>
                      <em className="mono">{hint}</em>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : mode === 'passphrase' ? (
          <div className="vt-gen-panel">
            <label className="vt-len">
              <span className="label-mono">Слов</span>
              <input
                type="range"
                min={3}
                max={10}
                value={phrase.words}
                onChange={(e) => setPhrase({ ...phrase, words: Number(e.target.value) })}
                data-testid="gen-phrase-words"
              />
              <b className="vt-len-num num">{phrase.words}</b>
            </label>
            <div className="vt-gen-sep">
              <span className="label-mono">Разделитель</span>
              <VtSelect
                className="vt-gen-sep-select"
                value={phrase.separator}
                onChange={(v) => setPhrase({ ...phrase, separator: v })}
                ariaLabel="Разделитель слов"
                testId="gen-phrase-sep"
                options={SEPARATORS}
              />
            </div>
            <div className="vt-opts" role="group" aria-label="Параметры фразы">
              {(
                [
                  { key: 'capitalize' as const, label: 'С заглавных', hint: 'Kuva-Tery' },
                  { key: 'number' as const, label: 'Число в конце', hint: '…-42' },
                ]
              ).map(({ key, label, hint }) => {
                const on = Boolean(phrase[key])
                return (
                  <button
                    key={key}
                    className={`vt-opt${on ? ' on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    onClick={() => setPhrase({ ...phrase, [key]: !on })}
                    data-testid={`gen-phrase-${key}`}
                  >
                    <i className="vt-opt-box" aria-hidden="true">
                      <IconCheck />
                    </i>
                    <span className="vt-opt-text">
                      <b>{label}</b>
                      <em className="mono">{hint}</em>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="vt-note">
              Слова берутся из встроенного словаря BIP39 ({BIP39_WORDS.length} слов) равномерным
              CSPRNG: 11 бит энтропии на слово, легко произносится и печатается.
            </p>
          </div>
        ) : mode === 'username' ? (
          <div className="vt-gen-panel">
            <label className="vt-len">
              <span className="label-mono">Блоков</span>
              <input
                type="range"
                min={2}
                max={4}
                value={uname.blocks}
                onChange={(e) => setUname({ ...uname, blocks: Number(e.target.value) })}
                data-testid="gen-username-blocks"
              />
              <b className="vt-len-num num">{uname.blocks}</b>
            </label>
            <div className="vt-opts" role="group" aria-label="Параметры имени">
              {(
                [
                  { key: 'dotted' as const, label: 'С точкой', hint: 'kuva.tery' },
                  { key: 'digits' as const, label: 'Цифры', hint: '…42' },
                ]
              ).map(({ key, label, hint }) => {
                const on = Boolean(uname[key])
                return (
                  <button
                    key={key}
                    className={`vt-opt${on ? ' on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    onClick={() => setUname({ ...uname, [key]: !on })}
                    data-testid={`gen-username-${key}`}
                  >
                    <i className="vt-opt-box" aria-hidden="true">
                      <IconCheck />
                    </i>
                    <span className="vt-opt-text">
                      <b>{label}</b>
                      <em className="mono">{hint}</em>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="vt-note">
              Произносимые пары слогов «согласная-гласная»: имя выглядит человеческим, но не
              содержит ни слов, ни данных о вас.
            </p>
          </div>
        ) : mode === 'seed' ? null : (
          <p className="vt-note">
            {mode === 'pin'
              ? 'PIN · 6 случайных цифр без смещения по модулю.'
              : mode === 'hex'
                ? 'Hex-токен · 24 байта энтропии (48 символов).'
                : 'UUID v4 · 122 бита случайности.'}
          </p>
        )}

        <footer className="vt-modal-foot">
          <span className="vt-note">
            Значения считаются в браузере через crypto.getRandomValues. Наружу не уходит ничего.
          </span>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Закрыть
          </button>
          {onUse && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                onUse(value)
                onClose()
              }}
              data-testid="generator-use"
            >
              Подставить
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
