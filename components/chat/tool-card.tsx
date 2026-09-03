'use client'

import { IconCheck, IconClose, IconKey, IconSearch, IconExternal, IconChipAi, IconAlertTri } from '../icons'
import type { ToolRun } from './types'

const STATUS_LABEL: Record<ToolRun['status'], string> = {
  run: 'выполняется',
  wait: 'ждёт разрешения',
  ok: 'готово',
  err: 'ошибка',
  deny: 'отклонено',
}

function argsLine(t: ToolRun): string {
  const a = t.args
  if (t.name === 'find_file') return `запрос: «${String(a.query ?? '')}»`
  if (t.name === 'save_password') {
    const login = a.login ? ` · логин ${String(a.login)}` : ''
    return `${String(a.title ?? 'запись')}${login} · пароль скрыт`
  }
  if (t.name === 'notion_pull') return `«${String(a.query ?? '')}»`
  const s = JSON.stringify(a)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function ToolIcon({ name }: { name: string }) {
  if (name === 'find_file') return <IconSearch aria-hidden="true" />
  if (name === 'save_password') return <IconKey aria-hidden="true" />
  if (name === 'notion_pull') return <IconExternal aria-hidden="true" />
  return <IconChipAi aria-hidden="true" />
}

/**
 * Карточки скиллов внутри ответа: что модель запустила, с какими аргументами
 * и чем это закончилось. save_password не выполняется без явного «Разрешить».
 */
export function ToolCards({
  tools,
  onAllow,
  onDeny,
  onOpenFile,
}: {
  tools: ToolRun[]
  onAllow?: () => void
  onDeny?: () => void
  onOpenFile?: (fileId: string) => void
}) {
  if (!tools.length) return null
  return (
    <ol className="tool-list" aria-label="Скиллы этого ответа">
      {tools.map((t) => (
        <li key={t.id} className={`tool-card is-${t.status}`} data-testid={`tool-card-${t.name}`}>
          <span className="tool-ico" aria-hidden="true">
            <ToolIcon name={t.name} />
          </span>
          <div className="tool-body">
            <span className="tool-name">
              {t.label}
              <span className={`tool-state mono is-${t.status}`} data-testid={`tool-state-${t.name}`}>
                {t.status === 'run' ? <span className="tool-spin" aria-hidden="true" /> : null}
                {STATUS_LABEL[t.status]}
              </span>
            </span>
            <span className="tool-args mono ellipsis">{argsLine(t)}</span>
            {/* RM-3: макет обязан выглядеть макетом. Плашка стоит ДО текста
                ответа, иначе выдуманный фрагмент успевают прочитать как факт. */}
            {t.mock ? (
              <span className="tool-mock" data-testid={`tool-mock-${t.name}`}>
                <IconAlertTri aria-hidden="true" />
                макет, не реальные данные
              </span>
            ) : null}
            {t.summary ? <span className="tool-sum">{t.summary}</span> : null}
            {t.files?.length ? (
              <ul className="tool-files">
                {t.files.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="tool-file"
                      onClick={() => onOpenFile?.(f.id)}
                      data-testid={`tool-file-${f.id}`}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {t.status === 'wait' ? (
              <div className="tool-confirm" role="group" aria-label="Подтверждение действия">
                <span className="tool-ask">Разрешить ИИ записать пароль в сейф?</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={onAllow}
                  data-testid="tool-allow-btn"
                >
                  <IconCheck aria-hidden="true" />
                  Разрешить
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onDeny}
                  data-testid="tool-deny-btn"
                >
                  <IconClose aria-hidden="true" />
                  Отклонить
                </button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
