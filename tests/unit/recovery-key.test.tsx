// @vitest-environment jsdom

/* ============================================================
   RECOVERY-KEY · ключ восстановления замка (схема BitLocker)
   Проверяем:
     1. формат кода: 'WSXR-' + 43 символа base64url;
     2. генерация → восстановление старого мастер-секрета;
     3. смена мастера выдаёт НОВЫЙ код, старый перестаёт работать;
     4. неверный код отвергается, верный продолжает работать;
     5. одноразовость: после recovery запись удалена, wipe стирает её тоже;
     6. полный цикл через store: setupLock выдаёт код, recoverWithKey
        переупаковывает файловый ключ и SEK под новый мастер, данные целы;
     7. анти-брутфорс recovery: failCount мастера не растёт, после пяти
        неверных кодов включается кулдаун (failDelayMs).
   Итерации здесь боевые (600 000): PBKDF2 в node стоит ~100 мс.
   ============================================================ */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StrictMode, type ReactNode } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/* jsdom подменяет crypto без subtle — возвращаем node-овский webcrypto. */
const g = globalThis as unknown as Record<string, unknown>
if (!(g.crypto as webcrypto.Crypto | undefined)?.subtle) {
  Object.defineProperty(g, 'crypto', { value: webcrypto, configurable: true })
}

import {
  RECOVERY_CODE_PREFIX,
  aesDecrypt,
  aesEncrypt,
  bytesToB64,
  createRecoveryForSecret,
  deriveMasterKey,
  randomBytesOf,
  readLockState,
  readRecoveryBlob,
  recoverMasterSecret,
  removeRecoveryBlob,
  setMasterSecret,
  verifyMasterSecret,
  recoveryBytesFromCode,
} from '@/lib/crypto-vault'
import { hasRecoveryCode, wipeLockData } from '@/lib/lock-store'
import { putFileKey, readFileKey, replaceFileKeys } from '@/lib/file-keys-store'
import { SECRETS_SEK_KEY } from '@/lib/secrets-crypto'
import { getMasterSession } from '@/hooks/use-file-keys'
import { RedactedProvider } from '@/lib/redact-context'
import { VaultProvider, useVault } from '@/lib/vault-store'

const BAD_CODE = `${RECOVERY_CODE_PREFIX}${'A'.repeat(43)}`

/* ---------- соль файлового ключа — как fileSalt() ядра ---------- */

async function fkSaltBytes(fileId: string): Promise<Uint8Array> {
  const d = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`wf.filekey.${fileId}`) as BufferSource,
  )
  return new Uint8Array(d.slice(0, 16))
}

async function importRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]) as unknown as Promise<CryptoKey>
}

/* ============================================================
   ЧИСТАЯ КРИПТОГРАФИЯ (без React)
   ============================================================ */

describe('ключ восстановления · криптография', () => {
  beforeEach(() => {
    localStorage.clear()
    removeRecoveryBlob()
  })

  it('код восстановления: WSXR- + ровно 43 символа base64url', async () => {
    await setMasterSecret('мастер-А')
    const code = await createRecoveryForSecret('мастер-А')
    expect(code.startsWith(RECOVERY_CODE_PREFIX)).toBe(true)
    expect(code).toHaveLength(RECOVERY_CODE_PREFIX.length + 43)
    expect(code).not.toMatch(/[+/=]/)
    expect(recoveryBytesFromCode(code)?.length).toBe(32)
  })

  it('генерация → восстановление старого мастер-секрета', async () => {
    await setMasterSecret('мастер-пароль-А')
    const code = await createRecoveryForSecret('мастер-пароль-А')
    const restored = await recoverMasterSecret(code)
    expect(restored).toBe('мастер-пароль-А')
    expect(await verifyMasterSecret(restored as string)).toBe(true)
    expect(await verifyMasterSecret('не-то-значение')).toBe(false)
  }, 30_000)

  it('смена мастера выдаёт новый код; старый код не открывает перезаписанную запись', async () => {
    await setMasterSecret('мастер-А')
    const codeA = await createRecoveryForSecret('мастер-А')
    /* changeMaster: новый верификатор + перезапись recovery с новым секретом. */
    await setMasterSecret('мастер-Б')
    const codeB = await createRecoveryForSecret('мастер-Б')
    expect(codeB).not.toBe(codeA)
    expect(await recoverMasterSecret(codeB)).toBe('мастер-Б')
    expect(await recoverMasterSecret(codeA)).toBeNull()
  }, 30_000)

  it('неверный код отвергается, верный продолжает работать', async () => {
    await setMasterSecret('мастер-А')
    const code = await createRecoveryForSecret('мастер-А')
    expect(await recoverMasterSecret(BAD_CODE)).toBeNull()
    expect(await recoverMasterSecret('WSXR-короткий')).toBeNull()
    expect(await recoverMasterSecret('мусор без префикса')).toBeNull()
    expect(await recoverMasterSecret(code)).toBe('мастер-А')
  }, 30_000)

  it('запись одноразовая: после восстановления кода нет, wipe стирает её тоже', async () => {
    await setMasterSecret('мастер-А')
    const code = await createRecoveryForSecret('мастер-А')
    expect(readRecoveryBlob()).not.toBeNull()
    expect(hasRecoveryCode()).toBe(true)

    /* Успешное восстановление удаляет запись (как recoverWithKey в store). */
    expect(await recoverMasterSecret(code)).toBe('мастер-А')
    removeRecoveryBlob()
    expect(readRecoveryBlob()).toBeNull()
    expect(await recoverMasterSecret(code)).toBeNull()

    /* Новый замок + новый код, затем полный сброс — запись тоже мертва. */
    await setMasterSecret('мастер-Б')
    const code2 = await createRecoveryForSecret('мастер-Б')
    wipeLockData()
    expect(hasRecoveryCode()).toBe(false)
    expect(await recoverMasterSecret(code2)).toBeNull()
  }, 30_000)
})

/* ============================================================
   ПОЛНЫЙ ЦИКЛ ЧЕРЕЗ STORE (реальный LockProvider)
   ============================================================ */

let root: Root | null = null

/* useVault нельзя позвать вне провайдера — проба пишет контекст в переменную. */
let V: ReturnType<typeof useVault> | null = null

function RecoveryProbe() {
  V = useVault()
  return null
}

function VaultTree() {
  return (
    <StrictMode>
      <RedactedProvider>
        <VaultProvider>
          <RecoveryProbe />
        </VaultProvider>
      </RedactedProvider>
    </StrictMode>
  )
}

async function mountVault() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<VaultTree />)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function unmountVault() {
  if (root) {
    await act(async () => {
      root!.unmount()
    })
  }
  root = null
  V = null
}

describe('recoverWithKey в store', () => {
  beforeEach(async () => {
    localStorage.clear()
    await replaceFileKeys({})
    removeRecoveryBlob()
  })

  afterEach(async () => {
    await unmountVault()
  })

  it('setupLock возвращает код; восстановление переупаковывает файловый ключ и SEK', async () => {
    await mountVault()

    /* --- включение замка: код восстановления выдаётся вызывающему --- */
    let code: string | null = null
    await act(async () => {
      code = await V!.setupLock('мастер-А', 'password')
    })
    expect(typeof code).toBe('string')
    expect((code as unknown as string).startsWith(RECOVERY_CODE_PREFIX)).toBe(true)
    expect(V!.lock.status).toBe('unlocked')
    expect(hasRecoveryCode()).toBe(true)

    /* --- защищённый файл: обёртка под текущим мастером (как setFileKey) --- */
    const oldSession = getMasterSession()
    expect(oldSession).not.toBeNull()
    const fileKeyRaw = randomBytesOf(32)
    const rawB64 = bytesToB64(fileKeyRaw)
    const fkKey = await importRaw(fileKeyRaw)
    const wrapMaster = await aesEncrypt(oldSession as CryptoKey, rawB64)
    const wrapPw = await aesEncrypt(
      await deriveMasterKey('пароль-файла', await fkSaltBytes('f1')),
      rawB64,
    )
    const ver = await aesEncrypt(fkKey, 'wf-filekey-v1')
    await putFileKey('f1', {
      v: 1,
      wct: wrapMaster.ctB64,
      wiv: wrapMaster.ivB64,
      pct: wrapPw.ctB64,
      piv: wrapPw.ivB64,
      kct: ver.ctB64,
      kiv: ver.ivB64,
    })
    const sek = await aesEncrypt(oldSession as CryptoKey, 'sek-material')
    localStorage.setItem(SECRETS_SEK_KEY, JSON.stringify({ wct: sek.ctB64, wiv: sek.ivB64 }))

    /* --- неверный код: отказ БЕЗ роста failCount мастера --- */
    let answer: string | null = null
    await act(async () => {
      answer = await V!.recoverWithKey(BAD_CODE, 'мастер-Б')
    })
    expect(answer).toBe('Код не подходит')
    expect(V!.recoveryFails).toBe(1)
    expect(readLockState()?.failCount).toBe(0)
    expect(await verifyMasterSecret('мастер-А')).toBe(true) // замок не изменился

    /* --- верный код: та же цепочка, что changeMaster --- */
    await act(async () => {
      answer = await V!.recoverWithKey(code as string, 'мастер-Б')
    })
    expect(answer).toBeNull()
    expect(V!.lock.status).toBe('unlocked')
    expect(await verifyMasterSecret('мастер-Б')).toBe(true)
    expect(await verifyMasterSecret('мастер-А')).toBe(false)

    /* --- одноразовость: запись удалена --- */
    expect(hasRecoveryCode()).toBe(false)
    expect(readRecoveryBlob()).toBeNull()

    /* --- перезапаковка: файловый ключ и SEK открываются НОВЫМ мастером --- */
    const newSession = getMasterSession()
    expect(newSession).not.toBeNull()
    const blob = readFileKey('f1')
    expect(blob).not.toBeNull()
    expect(await aesDecrypt(oldSession as CryptoKey, blob!.wct, blob!.wiv)).toBeNull()
    expect(await aesDecrypt(newSession as CryptoKey, blob!.wct, blob!.wiv)).toBe(rawB64)

    const sekBlob = JSON.parse(localStorage.getItem(SECRETS_SEK_KEY) as string) as {
      wct: string
      wiv: string
    }
    expect(await aesDecrypt(newSession as CryptoKey, sekBlob.wct, sekBlob.wiv)).toBe('sek-material')
    expect(await aesDecrypt(oldSession as CryptoKey, sekBlob.wct, sekBlob.wiv)).toBeNull()

    /* --- второй вход тем же кодом больше не проходит --- */
    await act(async () => {
      answer = await V!.recoverWithKey(code as string, 'мастер-В')
    })
    expect(answer).toBe('Код не подходит')
    expect(await verifyMasterSecret('мастер-Б')).toBe(true) // сейф не сброшен
  }, 120_000)

  it('changeMaster перезаписывает код: старый мёртв, новый открывает новый секрет', async () => {
    await mountVault()

    let code1: string | null = null
    await act(async () => {
      code1 = await V!.setupLock('мастер-А', 'password')
    })
    expect(code1).not.toBeNull()

    let code2: string | null = null
    await act(async () => {
      code2 = await V!.changeMaster('мастер-А', 'мастер-Б')
    })
    expect(typeof code2).toBe('string')
    expect(code2).not.toBe(code1)
    expect(await recoverMasterSecret(code2 as unknown as string)).toBe('мастер-Б')
    expect(await recoverMasterSecret(code1 as unknown as string)).toBeNull()
    expect(await verifyMasterSecret('мастер-Б')).toBe(true)
  }, 120_000)

  it('пять неверных кодов без кулдауна; затем кулдаун как у мастера, failCount не растёт', async () => {
    await mountVault()

    await act(async () => {
      await V!.setupLock('мастер-А', 'password')
    })

    let answer: string | null = null
    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        answer = await V!.recoverWithKey(BAD_CODE, 'мастер-Б')
      })
      expect(answer).toBe('Код не подходит')
      expect(V!.recoveryFails).toBe(i)
      expect(V!.recoveryCooldownUntil).toBe(0) // ровно до 5 попыток — без кулдауна
      expect(readLockState()?.failCount).toBe(0)
    }

    /* Шестая неудача включает кулдаун по failDelayMs (потолок 30 с). */
    await act(async () => {
      answer = await V!.recoverWithKey(BAD_CODE, 'мастер-Б')
    })
    expect(answer).toBe('Код не подходит')
    expect(V!.recoveryCooldownUntil).toBeGreaterThan(Date.now())

    /* Седьмая попытка отсекается до деривации. */
    await act(async () => {
      answer = await V!.recoverWithKey(BAD_CODE, 'мастер-Б')
    })
    expect(answer).toBe('Слишком много неверных кодов — попытка заблокирована')
    expect(readLockState()?.failCount).toBe(0) // мастер-счётчик не тронут
    expect(await verifyMasterSecret('мастер-А')).toBe(true) // замок цел
  }, 180_000)
})