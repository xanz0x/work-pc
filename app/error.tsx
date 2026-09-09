'use client'

import { useEffect } from 'react'

/**
 * Экран ошибки страницы (UX-2): причина, возврат в библиотеку,
 * технические детали под раскрытием.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app-error]', error)
  }, [error])

  return (
    <div className="app-error" data-testid="app-error">
      <div className="app-error-card">
        <div className="app-error-kicker">Сбой приложения</div>
        <h1 className="app-error-title">Что-то сломалось внутри интерфейса</h1>
        <p className="app-error-body">
          Данные сейфа не тронуты: ошибка произошла при отрисовке. Попробуйте открыть экран
          заново — если повторяется, вернитесь в библиотеку.
        </p>
        <div className="app-error-acts">
          <button type="button" className="btn btn-primary" onClick={reset} data-testid="app-error-retry">
            Попробовать снова
          </button>
          {/* Страница ошибки не должна зависеть от роутера: <Link> тянет его
              контекст, а падение могло случиться именно в нём. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn" href="/" data-testid="app-error-home">
            Вернуться в библиотеку
          </a>
        </div>
        <details>
          <summary>Технические детали</summary>
          <pre>
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        </details>
      </div>
    </div>
  )
}
