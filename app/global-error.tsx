'use client'

import './globals.css'

/** Последняя линия обороны: упал даже layout — рисуем страницу без сейфа. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <div className="app-error" data-testid="global-error">
          <div className="app-error-card">
            <div className="app-error-kicker">Критический сбой</div>
            <h1 className="app-error-title">Приложение не запустилось</h1>
            <p className="app-error-body">
              Ошибка случилась до загрузки интерфейса. Локальные данные остаются на устройстве:
              перезапуск ничего не удаляет.
            </p>
            <div className="app-error-acts">
              <button type="button" className="btn btn-primary" onClick={reset}>
                Перезапустить
              </button>
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
      </body>
    </html>
  )
}
