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

const nextConfigs = Array.isArray(next) ? next : [next]

/**
 * Плагин берём из самого eslint-config-next: во flat-config правило можно
 * переопределять только в объекте, где объявлен его плагин, а отдельная
 * установка eslint-plugin-react-hooks дала бы второй экземпляр.
 */
const hooksPlugin = nextConfigs.find((c) => c && c.plugins && c.plugins['react-hooks'])?.plugins[
  'react-hooks'
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
  ...nextConfigs,
  ...(hooksPlugin
    ? [
        {
          plugins: { 'react-hooks': hooksPlugin },
          rules: Object.fromEntries(HOOKS_DEBT.map((r) => [r, 'warn'])),
        },
      ]
    : []),
  ...(hooksPlugin
    ? [
        {
          // Тестовые пробники специально пишут наружу (вытаскивают стор из
          // рендера) — для них правила чистоты неприменимы.
          files: ['tests/**/*.{ts,tsx}'],
          plugins: { 'react-hooks': hooksPlugin },
          rules: { 'react-hooks/globals': 'warn' },
        },
      ]
    : []),
]

export default config
