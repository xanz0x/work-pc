/* Проверка TOTP по официальным векторам RFC 6238 (SHA-1, 8 цифр).
   Запуск (в этой среде компилируется во временную папку):
     npx tsc lib/secrets-totp.ts --target es2022 --module esnext \
       --moduleResolution bundler --outDir /tmp/tt
     node --input-type=module -e "$(sed 's#../lib/secrets-totp#/tmp/tt/secrets-totp.js#' scripts/totp-check.ts)"
   Результат последнего прогона: 6/6 векторов совпали. */
import { base32Encode, totpCode } from '../lib/secrets-totp'

const CASES: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
]

export async function runTotpCheck(): Promise<boolean> {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
  let ok = true
  for (const [t, expect] of CASES) {
    const got = await totpCode(secret, { period: 30, digits: 8, algorithm: 'SHA1' }, t * 1000)
    const pass = got === expect
    ok = ok && pass
    console.log(`T=${t}\tожидалось ${expect}\tполучено ${got}\t${pass ? 'OK' : 'FAIL'}`)
  }
  console.log(ok ? 'RFC 6238 SHA-1: все векторы совпали' : 'RFC 6238: есть расхождения')
  return ok
}

void runTotpCheck()
