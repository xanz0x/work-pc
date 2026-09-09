// @vitest-environment jsdom

/* eslint-disable react-hooks/globals -- probe-паттерн как в recovery-key.test.tsx:
   контексты сторов пишутся в переменные теста, а не в состояние компонента. */

/* ============================================================
   P8 · ПЕРЕЗАПУСК СЕССИИ СЕКРЕТОВ ПОСЛЕ СМЕНЫ МАСТЕРА
   Раньше: после «удалить мастер-ключ и создать новый» обёртка SEK
   оставалась от прежнего мастера, ensureSecretsSession навсегда
   возвращала false, и экран висел с «Сейф секретов закрыт» при
   разблокированном замке. Проверяем:
     1. SEK-обёртка штампуется солью lock-state, осиротевшая обёртка
        честно заменяется новой (крипто-уровень, без React);
     2. здоровый перевход под тем же мастером НЕ пересоздаёт SEK;
     3. машина состояний через настоящие провайдеры: setupLock →
        ready, changeMaster → ready остаётся true (замок не закрывался);
     4. disableLock → setupLock: ready возвращается сам, needsLock false;
     5. локальное событие смены мастера поднимает потерянную сессию.
   Итерации PBKDF2 боевые (600 000), поэтому таймауты щедрые.
   ============================================================ */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StrictMode, type ReactNode } from 'react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/* React 19 в тестовой среде ждёт этот флаг — иначе act() ругается. */
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/* jsdom подменяет crypto без subtle — возвращаем node-овский webcrypto. */
const g = globalThis as unknown as Record<string, unknown>
if (!(g.crypto as webcrypto.Crypto | undefined)?.subtle) {
  Object.defineProperty(g, 'crypto', { value: webcrypto, configurable: true })
}

import {
  adoptMasterSession,
  dropMasterSession,
  getMasterSession,
} from '@/hooks/use-file-keys'
import {
  aesDecrypt,
  readLockState,
  setMasterSecret,
} from '@/lib/crypto-vault'
import {
  dropSecretsSession,
  ensureSecretsSession,
  hasSecretsSession,
  openField,
  sealField,
  SECRETS_SEK_KEY,
} from '@/lib/secrets-crypto'
import { MASTER_CHANGED_EVENT } from '@/lib/lock-store'
import { replaceFileKeys } from '@/lib/file-keys-store'
import { RedactedProvider } from '@/lib/redact-context'
import { VaultProvider, useVault } from '@/lib/vault-store'
import { SecretsProvider, useSecrets } from '@/lib/secrets-store'

/* ============================================================
   КРИПТО-УРОВЕНЬ (без React)
   ============================================================ */

describe('SEK · осиротевшая обёртка (P8)', () => {
  beforeEach(() => {
    localStorage.clear()
    dropSecretsSession()
    dropMasterSession()
  })

  it('обёртка штампуется солью; после удаления замка и создания нового SEK восстанавливается', async () => {
    await setMasterSecret('мастер-А')
    expect(await adoptMasterSession('мастер-А')).toBe(true)
    expect(await ensureSecretsSession()).toBe(true)
    const sekA = await sealField('e1', 'значение-А')

    const blobA = JSON.parse(localStorage.getItem(SECRETS_SEK_KEY) as string) as { salt?: string }
    expect(blobA.salt).toBe(readLockState()?.saltB64) // штамп поколения замка

    /* «Удалили мастер-ключ и создали новый»: новый верификатор + новая соль,
       обёртка SEK осталась от прежнего мастера. */
    await setMasterSecret('мастер-Б')
    expect(await adoptMasterSession('мастер-Б')).toBe(true)
    dropSecretsSession()

    /* Раньше ensureSecretsSession здесь навсегда возвращала false. */
    expect(await ensureSecretsSession()).toBe(true)
    expect(hasSecretsSession()).toBe(true)

    /* Новая обёртка открывается текущим мастером и свежий SEK рабочий. */
    const blobB = JSON.parse(localStorage.getItem(SECRETS_SEK_KEY) as string) as { wct: string; wiv: string; salt?: string }
    expect(blobB.salt).toBe(readLockState()?.saltB64)
    expect(await aesDecrypt(getMasterSession() as CryptoKey, blobB.wct, blobB.wiv)).not.toBeNull()
    const sekB = await sealField('e2', 'значение-Б')
    expect(await openField('e2', sekB as string)).toBe('значение-Б')
  }, 30_000)

  it('здоровый перевход под тем же мастером не пересоздаёт SEK: данные читаются', async () => {
    await setMasterSecret('мастер-А')
    await adoptMasterSession('мастер-А')
    expect(await ensureSecretsSession()).toBe(true)
    const packed = await sealField('e1', 'то-же-сырьё')

    dropSecretsSession()
    dropMasterSession()
    await adoptMasterSession('мастер-А') // повторный вход тем же ключом
    expect(await ensureSecretsSession()).toBe(true)
    expect(await openField('e1', packed as string)).toBe('то-же-сырьё')
  }, 30_000)
})

/* ============================================================
   МАШИНА СОСТОЯНИЙ (настоящие провайдеры)
   ============================================================ */

let root: Root | null = null
let host: HTMLDivElement | null = null
let V: ReturnType<typeof useVault> | null = null
let S: ReturnType<typeof useSecrets> | null = null

function Probe() {
  V = useVault()
  S = useSecrets()
  return null
}

function Tree() {
  return (
    <StrictMode>
      <RedactedProvider>
        <VaultProvider>
          <SecretsProvider>
            <Probe />
          </SecretsProvider>
        </VaultProvider>
      </RedactedProvider>
    </StrictMode>
  )
}

async function mountTree() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Tree />)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const flush = (ms = 30) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < 5000) await flush(25)
  expect(cond(), what).toBe(true)
}

describe('машина состояний: смена мастера → ready без ручного relock (P8)', () => {
  beforeEach(async () => {
    localStorage.clear()
    dropSecretsSession()
    dropMasterSession()
    await replaceFileKeys({})
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
    }
    root = null
    host?.remove()
    host = null
    V = null
    S = null
  })

  it('setupLock поднимает ready; changeMaster оставляет ready=true', async () => {
    await mountTree()
    await act(async () => {
      await V!.setupLock('мастер-А', 'password')
    })
    expect(V!.lock.status).toBe('unlocked')
    await waitFor(() => S!.ready === true, 'ready после setupLock')

    await act(async () => {
      await V!.changeMaster('мастер-А', 'мастер-Б')
    })
    /* Замок не закрывался, gate не нужен, сессия секретов жива. */
    expect(V!.lock.status).toBe('unlocked')
    expect(S!.needsLock).toBe(false)
    await flush()
    expect(S!.ready).toBe(true)

    /* Запись создаётся без повторной разблокировки. */
    const err = await S!.createEntry('login', 'Проверка', [
      { name: 'Логин', kind: 'text', value: 'user', secret: false },
    ])
    expect(err).toBeNull()
  }, 120_000)

  it('удаление ключа и создание нового: ready возвращается сам, gate не показывается', async () => {
    await mountTree()
    await act(async () => {
      await V!.setupLock('мастер-А', 'password')
    })
    await waitFor(() => S!.ready === true, 'ready после setupLock')

    await act(async () => {
      await V!.disableLock('мастер-А')
    })
    expect(V!.lock.status).toBe('off')
    expect(S!.needsLock).toBe(true)
    expect(S!.ready).toBe(false)

    await act(async () => {
      await V!.setupLock('мастер-В', 'password')
    })
    expect(V!.lock.status).toBe('unlocked')
    await waitFor(() => S!.ready === true, 'ready после нового мастер-ключа')
    expect(S!.needsLock).toBe(false)
    /* Условие gate-экрана: !s.needsLock && !s.ready — не выполняется. */
  }, 120_000)

  it('локальное событие смены мастера пересобирает потерянную сессию', async () => {
    await mountTree()
    await act(async () => {
      await V!.setupLock('мастер-А', 'password')
    })
    await waitFor(() => S!.ready === true, 'ready после setupLock')

    /* Сессия потеряна (сбой/внешняя чистка памяти) при открытом замке. */
    dropSecretsSession()
    expect(hasSecretsSession()).toBe(false)

    await act(async () => {
      window.dispatchEvent(new Event(MASTER_CHANGED_EVENT))
    })
    await waitFor(() => hasSecretsSession() === true, 'сессия поднята по событию')
    expect(S!.ready).toBe(true)
  }, 120_000)
})
