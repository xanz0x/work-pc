'use client'

import { Component, type ReactNode } from 'react'
import { reportClientError } from '@/lib/telemetry-client'

type Props = { name: string; children: ReactNode }
type State = { error: Error | null }

/**
 * Boundary на экран (UX-2): падение карты не должно ронять сайдбар и топбар.
 * Классовый компонент — потому что хуков для перехвата ошибок нет.
 */
export class ScreenBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[screen:${this.props.name}]`, error)
    /* Не ушло — ляжет в очередь и уедет при следующем запуске (§3.6). */
    reportClientError({
      kind: 'client-error',
      where: `screen:${this.props.name}`,
      message: error.message,
    })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="screen-error" role="alert" data-testid={`screen-error-${this.props.name}`}>
        <div className="app-error-kicker">Экран не открылся</div>
        <p className="app-error-body">
          Этот экран упал, остальное приложение работает. Можно вернуться в библиотеку или
          попробовать открыть экран заново.
        </p>
        <div className="app-error-acts">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => this.setState({ error: null })}
            data-testid={`screen-error-retry-${this.props.name}`}
          >
            Открыть заново
          </button>
        </div>
        <details>
          <summary>Технические детали</summary>
          <pre>{error.message}</pre>
        </details>
      </div>
    )
  }
}
