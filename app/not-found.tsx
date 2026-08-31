/** 404 в стиле «Графит»: без выдуманных подсказок, только путь домой. */
export default function NotFound() {
  return (
    <div className="app-error" data-testid="not-found">
      <div className="app-error-card">
        <div className="app-error-kicker">404</div>
        <h1 className="app-error-title">Такой страницы нет</h1>
        <p className="app-error-body">
          Приложение — один экран сейфа: библиотека, карта, чат, секреты и настройки. Всё остальное
          сюда не ведёт.
        </p>
        <div className="app-error-acts">
          {/* Как и в app/error.tsx: жёсткая ссылка, без зависимости от роутера. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-primary" href="/" data-testid="not-found-home">
            Вернуться в библиотеку
          </a>
        </div>
      </div>
    </div>
  )
}
