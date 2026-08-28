/* ============================================================
   BIP39 · офлайн-генератор seed-фраз и проверка контрольной суммы
   Энтропия из crypto.getRandomValues, checksum — SHA-256 (WebCrypto).
   Наружу не уходит ничего. Zero-dependency.
   ============================================================ */

import { BIP39_WORDS } from './bip39-words'

const INDEX = new Map(BIP39_WORDS.map((w, i) => [w, i]))

function bytesToBits(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(2).padStart(8, '0'))
    .join('')
}

async function checksumBits(entropy: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy))
  return bytesToBits(hash).slice(0, (entropy.length * 8) / 32)
}

export async function entropyToMnemonic(entropy: Uint8Array): Promise<string[]> {
  const bits = bytesToBits(entropy) + (await checksumBits(entropy))
  const out: string[] = []
  for (let i = 0; i < bits.length; i += 11) out.push(BIP39_WORDS[parseInt(bits.slice(i, i + 11), 2)])
  return out
}

/** 12 слов = 128 бит энтропии, 24 слова = 256 бит. */
export async function generateMnemonic(words: 12 | 24): Promise<string[]> {
  const entropy = crypto.getRandomValues(new Uint8Array(words === 12 ? 16 : 32))
  return entropyToMnemonic(entropy)
}

export type MnemonicCheck = { ok: boolean; msg: string }

export async function validateMnemonic(phrase: string): Promise<MnemonicCheck> {
  const ws = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (![12, 15, 18, 21, 24].includes(ws.length))
    return { ok: false, msg: `Сейчас ${ws.length} слов — BIP39 допускает 12, 15, 18, 21 или 24` }
  for (const w of ws)
    if (!INDEX.has(w)) return { ok: false, msg: `Слова «${w}» нет в словаре BIP39` }
  const bits = ws.map((w) => INDEX.get(w)!.toString(2).padStart(11, '0')).join('')
  const entBits = (ws.length * 11 * 32) / 33
  const entropy = new Uint8Array(entBits / 8)
  for (let i = 0; i < entropy.length; i++)
    entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const cs = await checksumBits(entropy)
  return bits.slice(entBits) === cs
    ? { ok: true, msg: 'Контрольная сумма верна — фраза валидна' }
    : { ok: false, msg: 'Контрольная сумма не сходится — в фразе опечатка или неверный порядок слов' }
}
