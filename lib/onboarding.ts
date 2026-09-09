/* ============================================================
   ОНБОРДИНГ · политика первого запуска (NF-4)
   Чистая логика: кому показывать три шага, что означает отказ от
   мастер-ключа и во что превращается выбор режима. Компонент
   `components/onboarding.tsx` только рисует то, что решено здесь.
   ============================================================ */

export type PrivacyMode = 'local' | 'hybrid'
export type KeyChoice = 'created' | 'declined'
export type StartChoice = 'folder' | 'demo'

/** Что записано в профиле о пройденном онбординге. */
export type OnboardingState = {
  /** Когда онбординг был завершён. `null` — ещё не проходили. */
  at: number | null
  mode: PrivacyMode | null
  keyChoice: KeyChoice | null
  start: StartChoice | null
}

export const NO_ONBOARDING: OnboardingState = {
  at: null,
  mode: null,
  keyChoice: null,
  start: null,
}

export type OnboardingResult = {
  mode: PrivacyMode
  keyChoice: KeyChoice
  start: StartChoice
}

/**
 * Показывать три шага только тому, кто их не проходил и у кого замок
 * не настроен: у существующего сейфа с мастер-ключом онбординг забирать
 * нечего — такой профиль просто помечается пройденным. Исключение —
 * ключ, созданный в самом онбординге (`keyChoice` уже записан): такой
 * профиль обязан вернуться на третий шаг, а не остаться без режима.
 */
export function needsOnboarding(o: OnboardingState, lockConfigured: boolean): boolean {
  if (o.at !== null) return false
  return !lockConfigured || o.keyChoice !== null
}

/** Профиль без флага, но с настроенным замком не из онбординга — засчитываем молча. */
export function shouldMarkOnboarded(o: OnboardingState, lockConfigured: boolean): boolean {
  return o.at === null && lockConfigured && o.keyChoice === null
}

/**
 * Отказ от мастер-ключа не оставляет систему в полудоверенном состоянии:
 * без защиты гибридный режим запрещён — режим падает в локальный, согласие
 * на внешние запросы не выдаётся.
 */
export function resolveOnboarding(
  r: OnboardingResult,
  now: number,
): {
  engine: PrivacyMode
  cloudConsent: boolean
  /** Режим понижен из-за отказа от ключа — об этом говорим вслух. */
  downgraded: boolean
  onboarding: OnboardingState
} {
  const unprotected = r.keyChoice === 'declined'
  const engine: PrivacyMode = unprotected ? 'local' : r.mode
  return {
    engine,
    cloudConsent: engine === 'hybrid',
    downgraded: unprotected && r.mode === 'hybrid',
    onboarding: { at: now, mode: engine, keyChoice: r.keyChoice, start: r.start },
  }
}
