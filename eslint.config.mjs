import next from 'eslint-config-next'

/**
 * Гейт CI (P0-4): `pnpm lint` падает на настоящих ошибках.
 *
 * Правила react-hooks 7 (purity/refs/set-state-in-effect и родственные)
 * ловят долг существующего стора: часы `now`, зеркала через ref и посевы
 * состояния в эффектах. Это ровно задача AR-1 «Разделение стора и часов»
 * из волны 3 — переписывать сейф здесь было бы шире задачи и рискованнее,
 * поэтому они оставлены предупреждениями и снимутся вместе с AR-1.
 */
const HOOKS_DEBT = [
  'react-hooks/purity',
  'react-hooks/refs',
  'react-hooks/immutability',
  'react-hooks/set-state-in-effect',
  'react-hooks/static-components',
  'react-hooks/preserve-manual-memoization',
]

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'frontend/**',
      'backend/**',
      'ai/**',
      'scripts/**',
    ],
  },
  ...(Array.isArray(next) ? next : [next]),
  {
    rules: Object.fromEntries(HOOKS_DEBT.map((r) => [r, 'warn'])),
  },
]

export default config
