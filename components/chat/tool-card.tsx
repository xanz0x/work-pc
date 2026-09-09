'use client'

import { IconCheck, IconClose, IconKey, IconSearch, IconExternal, IconChipAi, IconAlertTri } from '../icons'
import type { ToolRun } from './types'
import { CHAT_TOOLS } from '@/lib/chat-tools'
import { GeneratedPassword } from './generated-password'
import { useNavStore, useToast } from '@/lib/vault-store'
import type { ScreenId } from '@/lib/store/nav'
import { checkChatAction } from '@/lib/chat-actions'

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
    return `${String(a.title ?? 'запись')} · ${String(a.url ?? '')}${login} · пароль скрыт`
  }
  if (t.name === 'notion_pull') return `«${String(a.query ?? '')}»`
  if (t.name === 'create_mailbox') return ({ mailtm: 'Обычная почта', gmail: 'Gmail · временный адрес', outlook: 'Outlook · временный адрес' })[String(a.kind)] ?? ''
  if (t.name === 'delete_mailbox') return String(a.address ?? a.id ?? '')
  if (t.name === 'create_note') return `${String(a.title ?? '')}\n${String(a.body ?? '')}`
  if (t.name === 'generate_password') return 'Генерация на устройстве · значение не передаётся модели'
  const s = JSON.stringify(a)
  return s === '{}' ? '' : s
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
  const nav = useNavStore()
  const { flash } = useToast()
  if (!tools.length) return null
  return (
    <ol className="tool-list" aria-label="Скиллы этого ответа">
      {tools.map((t) => (
        <li key={t.id} className={`tool-card is-${t.status}`} data-tool-name={t.name} data-testid={`tool-card-${t.id}`}>
          <span className="tool-ico" aria-hidden="true">
            <ToolIcon name={t.name} />
          </span>
          <div className="tool-body">
            <span className="tool-name" data-testid={`tool-name-${t.id}`}>
              {t.label}
              <span className={`tool-state mono is-${t.status}`} data-testid={`tool-state-${t.id}`}>
                {t.status === 'run' ? <span className="tool-spin" aria-hidden="true" /> : null}
                {STATUS_LABEL[t.status]}
              </span>
            </span>
            <span className="tool-args mono" data-testid={`tool-args-${t.id}`}>{argsLine(t)}</span>
            {/* RM-3: макет обязан выглядеть макетом. Плашка стоит ДО текста
                ответа, иначе выдуманный фрагмент успевают прочитать как факт. */}
            {t.mock ? (
              <span className="tool-mock" data-testid={`tool-mock-${t.name}`}>
                <IconAlertTri aria-hidden="true" />
                макет, не реальные данные
              </span>
            ) : null}
            {t.summary ? <span className="tool-sum" data-testid={`tool-summary-${t.id}`}>{t.summary}</span> : null}
            {t.passwordRef ? <GeneratedPassword passwordRef={t.passwordRef} /> : null}
            {t.link ? <button className="btn btn-ghost btn-sm" data-testid={`tool-open-${t.id}`} onClick={async () => {
              const denied = await checkChatAction('open_app', t.link!)
              if (denied) { flash(denied); return }
              if (t.link!.setting) nav.openSetting(t.link!.setting)
              else nav.go(t.link!.section as ScreenId)
            }}>Открыть раздел</button> : null}
            {t.files?.length ? (
              <ul className="tool-files">
                {t.files.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="tool-file"
                      onClick={() => onOpenFile?.(f.id)}
                      data-testid={`tool-file-${t.id}-${f.id}`}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {t.status === 'wait' ? (
              <div className="tool-confirm" role="group" aria-label="Подтверждение действия">
                <span className="tool-ask" data-testid={`tool-confirm-text-${t.id}`}>{CHAT_TOOLS[t.name]?.confirm ?? 'Подтвердить действие?'}</span>
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
