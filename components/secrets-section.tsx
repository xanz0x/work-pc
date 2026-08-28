'use client'

/* ============================================================
   НАСТРОЙКИ МОДУЛЯ «МЕНЕДЖЕР СЕКРЕТОВ»
   Секция экрана настроек по общему паттерну: <section id="set-secrets">.
   Живёт на собственном хранилище (wf.secrets.settings.v1) — черновик
   общего конфига не трогаем, изменения применяются сразу.
   ============================================================ */

import { IconKey } from './icons'
import { useSecrets } from '@/lib/secrets-store'
import { CLIP_CHOICES, type ClipTarget } from '@/lib/secrets'

const CLIP_ROWS: { id: ClipTarget; title: string; note: string }[] = [
  { id: 'password', title: 'Пароли', note: 'Значение секретного поля или сгенерированный пароль' },
  { id: 'totp', title: 'Коды TOTP', note: 'Одноразовый код живёт максимум одно окно' },
  { id: 'cvv', title: 'CVV и PIN', note: 'Самые короткие таймауты по умолчанию' },
  { id: 'username', title: 'Логины', note: 'Не секрет, но и болтаться в буфере не должен' },
  { id: 'other', title: 'Остальное', note: 'Ключи API, seed-фразы, свои поля' },
]

const REVEAL_CHOICES = [5, 8, 15, 30]

export function SecretsSection() {
  const s = useSecrets()

  return (
    <section className="sec panel" id="set-secrets" data-testid="settings-secrets">
      <div className="sec-head">
        <span className="sec-icon">
          <IconKey />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Менеджер секретов</div>
          <div className="setting-note">
            Буфер обмена, авто-скрытие, иконки сайтов и изоляция от ИИ
          </div>
        </div>
        <span className="sec-meta label-mono">local-first</span>
      </div>

      <div className="rows-list">
        {CLIP_ROWS.map((r) => (
          <div className="setting-row" key={r.id}>
            <div className="setting-row-text">
              <div className="setting-title">Буфер: {r.title.toLowerCase()}</div>
              <div className="setting-note">{r.note}</div>
            </div>
            <div className="vt-seg small" role="radiogroup" aria-label={`Таймаут буфера: ${r.title}`}>
              {CLIP_CHOICES.map((sec) => (
                <button
                  key={sec}
                  role="radio"
                  aria-checked={s.settings.clipboard[r.id] === sec}
                  className={`vt-seg-btn${s.settings.clipboard[r.id] === sec ? ' on' : ''}`}
                  onClick={() =>
                    s.setSettings((p) => ({ ...p, clipboard: { ...p.clipboard, [r.id]: sec } }))
                  }
                  data-testid={`clip-${r.id}-${sec}`}
                >
                  {sec === 0 ? 'никогда' : `${sec}с`}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Авто-скрытие показанного секрета</div>
            <div className="setting-note">
              Значение гаснет само, а также при уходе со страницы и при блокировке сейфа
            </div>
          </div>
          <div className="vt-seg small" role="radiogroup" aria-label="Секунды показа">
            {REVEAL_CHOICES.map((sec) => (
              <button
                key={sec}
                role="radio"
                aria-checked={s.settings.revealSeconds === sec}
                className={`vt-seg-btn${s.settings.revealSeconds === sec ? ' on' : ''}`}
                onClick={() => s.setSettings((p) => ({ ...p, revealSeconds: sec }))}
                data-testid={`reveal-secs-${sec}`}
              >
                {sec}с
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Загружать иконки сайтов</div>
            <div className="setting-note">
              Единственный сетевой вызов модуля: наружу уходит только домен записи, картинка
              сохраняется в сейф как b64. По умолчанию выключено.
            </div>
          </div>
          <button
            className={`toggle${s.settings.favicons ? ' on' : ''}`}
            role="switch"
            aria-checked={s.settings.favicons}
            aria-label="Загружать иконки сайтов"
            onClick={() => s.setSettings((p) => ({ ...p, favicons: !p.favicons, faviconsSet: true }))}
            data-testid="toggle-favicons"
          />
        </div>

        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Автоматические бэкапы сейфа секретов</div>
            <div className="setting-note">
              Зашифрованный мастер-ключом снимок, не чаще раза в час, ротация 5 копий
            </div>
          </div>
          <button
            className={`toggle${s.settings.autoBackup ? ' on' : ''}`}
            role="switch"
            aria-checked={s.settings.autoBackup}
            aria-label="Автоматические бэкапы"
            onClick={() => s.setSettings((p) => ({ ...p, autoBackup: !p.autoBackup }))}
            data-testid="toggle-autobackup"
          />
        </div>

        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Исключать секреты из ИИ-чата</div>
            <div className="setting-note">
              Защита жёсткая и выключить её нельзя: записи сейфа секретов не попадают ни в источники
              ответа, ни в смысловой индекс, ни в экспорт разговора.
            </div>
          </div>
          <button
            className="toggle on"
            role="switch"
            aria-checked
            aria-disabled
            disabled
            aria-label="Исключать секреты из ИИ-чата"
            title="Отключить нельзя"
            data-testid="toggle-exclude-ai"
          />
        </div>

        <div className="setting-row">
          <div className="setting-row-text">
            <div className="setting-title">Автоблокировка</div>
            <div className="setting-note">
              Наследуется от общего замка сейфа — отдельного таймера у модуля нет
            </div>
          </div>
          <span className="badge badge-info">раздел «Безопасность»</span>
        </div>
      </div>

      <p className="sec-note">
        Честная оговорка: очистка буфера обмена делается браузером. Если сторонняя программа в ОС
        ведёт историю буфера, WorkfloW не может это отменить.
      </p>
    </section>
  )
}
