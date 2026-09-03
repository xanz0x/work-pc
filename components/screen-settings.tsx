'use client'

/* AR-2: слой стилей настроек приезжает вместе с чанком экрана. */
import '@/app/styles/screen-settings.css'
import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react'
import {
  IconArrowRight,
  IconBell,
  IconChipAi,
  IconDatabase,
  IconFolder,
  IconInbox,
  IconKey,
  IconLayers,
  IconMemory,
  IconPipeline,
  IconRefresh,
  IconScale,
  IconShield,
  IconSparkText,
  IconTag,
  IconTrash,
  IconWifi,
} from './icons'
import {
  useDataStore,
  useMutations,
  useNavStore,
  useNotifsStore,
  useSettingsStore,
  useToast,
  type ToggleId,
} from '@/lib/vault-store'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import { ENGINES, MODELS, NO_DATA, engineOf, fmtBytes, modelOf } from '@/lib/data'
import { EnginePanel } from '@/components/engine-panel'
import { useEngineStore } from '@/lib/store/engine'
import { NumTicker } from './ui/num-ticker'
import { SecuritySection } from './security-section'
import { SecretsSection } from './secrets-section'
import { BackupSection } from './backup-section'
import { FlagsSection } from './flags-section'
import { JournalPanel } from './journal-panel'
import { UiScaleSection } from './ui-scale-section'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

const PIPELINE_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'ocr',
    title: 'Распознавать текст в изображениях и PDF',
    note: 'Локальный OCR, добавляет около 2 секунд на файл',
  },
  {
    id: 'autotag',
    title: 'Автоматические теги и описания',
    note: 'Модель предлагает категорию, вы можете её переопределить',
  },
  {
    id: 'watch',
    title: 'Следить за папками в фоне',
    note: 'Новые файлы попадают в конвейер сразу после появления',
  },
]

const NOTIFY_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'ntfPipeline',
    title: 'События конвейера',
    note: 'Индексация завершена, файлы ждут автотегов, папка пополнилась',
  },
  {
    id: 'ntfPrivacy',
    title: 'Риски приватности',
    note: 'Найдены паспортные данные, счета или ключи — приходит всегда с пометкой',
  },
  {
    id: 'ntfDigest',
    title: 'Ежедневная сводка',
    note: 'Одно уведомление вместо потока событий конвейера — они склеиваются в одну запись',
  },
]

const PRIVACY_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'redact',
    title: 'Скрывать чувствительные фрагменты в превью',
    note: 'Паспортные данные, счета и ключи заменяются плашкой',
  },
  {
    id: 'sendIndex',
    title: 'Отправлять индекс сейфа во внешнюю модель',
    note: 'Имена, категории и теги файлов. Выключено — наружу уходят только закреплённые файлы',
  },
  {
    id: 'telemetry',
    title: 'Отправлять анонимную статистику',
    note: 'Выключено по умолчанию: наружу не уходит ни один байт',
  },
]

const SECTIONS: { id: string; label: string; Icon: Ico }[] = [
  { id: 'engine', label: 'Движок ИИ', Icon: IconChipAi },
  { id: 'ui', label: 'Интерфейс', Icon: IconScale },
  { id: 'pipeline', label: 'Конвейер', Icon: IconPipeline },
  { id: 'notify', label: 'Уведомления', Icon: IconBell },
  { id: 'storage', label: 'Хранилище', Icon: IconDatabase },
  { id: 'privacy', label: 'Приватность', Icon: IconShield },
  { id: 'secrets', label: 'Менеджер секретов', Icon: IconKey },
  { id: 'backup', label: 'Бэкап сейфа', Icon: IconDatabase },
  { id: 'flags', label: 'Автономный режим', Icon: IconWifi },
  { id: 'journal', label: 'Журнал безопасности', Icon: IconLayers },
  { id: 'danger', label: 'Опасная зона', Icon: IconTrash },
]

/** Записи поиска зовут разделы своими именами — переводим их в id секций. */
const FOCUS_ALIAS: Record<string, string> = {
  engine: 'engine',
  ui: 'ui',
  scale: 'ui',
  interface: 'ui',
  index: 'pipeline',
  pipeline: 'pipeline',
  notifs: 'notify',
  notify: 'notify',
  storage: 'storage',
  privacy: 'privacy',
  security: 'security',
  journal: 'journal',
  secrets: 'secrets',
  backup: 'backup',
  flags: 'flags',
  offline: 'flags',
  danger: 'danger',
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/**
 * Экран настроек поверх единого сейфа.
 * Здесь нет собственных чисел: состав хранилища, шаги конвейера и подписи
 * движка читаются из store, а переключатели правят черновик конфигурации.
 * Пока черновик отличается от сохранённого, подвал держит кнопки активными,
 * и статус-бар каркаса говорит о несохранённых изменениях тем же словом.
 */
export function ScreenSettings() {
  /* Узкие подписки вместо общего фасада: экран настроек живёт на домене
     настроек, а из остальных берёт ровно то, что показывает. */
  const S = useSettingsStore()
  const D = useDataStore()
  const N = useNotifsStore()
  const NAV = useNavStore()
  const { flash } = useToast()
  const engine = useEngineStore()
  const idxs = useIndexSummary()
  const idxa = useIndexActions()
  /* LG-5: переиндексация — мутация: двойной клик даёт один прогон. */
  const M = useMutations()
  const d = S.draftSettings
  const [active, setActive] = useState('engine')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  /** Подсветка рельса: активен последний раздел, чья шапка прошла верх области. */
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return

    function onScroll() {
      const top = root!.getBoundingClientRect().top + 40
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(`set-${s.id}`)
        if (el && el.getBoundingClientRect().top <= top) current = s.id
      }
      setActive(current)
    }

    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [])

  /** Переход из поиска, палитры или колокольчика ведёт в нужный раздел. */
  useEffect(() => {
    if (!NAV.settingFocus) return
    /* LG-3: ссылка из уведомления приходит как `journal:<id записи>`. */
    const raw = NAV.settingFocus.id.split(':')[0]
    const id = FOCUS_ALIAS[raw] ?? 'engine'
    const el = document.getElementById(`set-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el?.classList.add('sec-flash')
    const t = setTimeout(() => el?.classList.remove('sec-flash'), 1200)
    setActive(id)
    return () => clearTimeout(t)
  }, [NAV.settingFocus])

  function goTo(id: string) {
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  function flip(id: ToggleId) {
    S.setDraftSettings((s) => ({ ...s, toggles: { ...s.toggles, [id]: !s.toggles[id] } }))
  }

  const notifyOn = NOTIFY_TOGGLES.filter((t) => d.toggles[t.id]).length
  const draftEngine = engineOf(d.engine)
  /* NF-2: готов ли локальный движок — знает домен движка, а не константа. */
  const localReady = engine.local?.ok === true
  const draftModel = modelOf(d.model)
  const { stats, mix } = D

  /** Шаги конвейера — снимок настоящего состояния корпуса. */
  const steps = useMemo(
    () => [
      {
        Icon: IconInbox,
        name: 'Приём',
        status: `${stats.files} ${plural(stats.files, 'файл', 'файла', 'файлов')}`,
        warn: false,
      },
      {
        Icon: IconSparkText,
        name: 'Распознавание',
        status: S.settings.toggles.ocr ? 'OCR активен' : 'OCR выключен',
        warn: !S.settings.toggles.ocr,
      },
      {
        Icon: IconTag,
        name: 'Автотеги',
        status: S.settings.toggles.autotag
          ? stats.processing > 0
            ? `${stats.processing} в очереди`
            : 'очередь пуста'
          : 'выключены',
        warn: !S.settings.toggles.autotag || stats.processing > 0,
      },
      {
        Icon: IconMemory,
        name: 'Карта памяти',
        status: `${stats.links} связей`,
        warn: stats.links === 0,
      },
    ],
    [stats.files, stats.links, stats.processing, S.settings.toggles.autotag, S.settings.toggles.ocr],
  )

  function rows(list: { id: ToggleId; title: string; note: string }[]) {
    return (
      <div className="rows-list">
        {list.map((t) => (
          <div className="setting-row" key={t.id}>
            <div className="setting-row-text">
              <div className="setting-title">{t.title}</div>
              <div className="setting-note">{t.note}</div>
            </div>
            <button
              className={`toggle${d.toggles[t.id] ? ' on' : ''}`}
              role="switch"
              aria-checked={d.toggles[t.id]}
              aria-label={t.title}
              data-testid={`toggle-${t.id}`}
              onClick={() => flip(t.id)}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="set-page" role="main">
      <div className="scroll-col" ref={scrollRef}>
        <div className="set-shell">
          <aside className="set-rail" aria-label="Разделы настроек">
            <div className="set-rail-inner">
              <div className="label-mono set-rail-head">Разделы</div>
              <nav className="set-rail-nav">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    className={`set-rail-item${active === s.id ? ' on' : ''}${
                      s.id === 'danger' ? ' danger' : ''
                    }`}
                    onClick={() => goTo(s.id)}
                    aria-current={active === s.id ? 'true' : undefined}
                  >
                    <s.Icon />
                    <span>{s.label}</span>
                  </button>
                ))}
              </nav>
              <div className="set-rail-foot">
                <span className="label-mono">Профиль</span>
                <span className="mono set-rail-meta">локальный · AES-256</span>
                <span className="mono set-rail-meta">сборка 3.0.7</span>
              </div>
            </div>
          </aside>

          <div className="set-main">
            <div className="set-hero panel">
              <div className="set-hero-top">
                <div>
                  <h1>Настройки</h1>
                  <p className="page-sub">
                    Движок ИИ, конвейер обработки и границы приватности. Всё применяется локально.
                  </p>
                </div>
                {/* NF-2: бейдж не обещает локальный режим, если движок молчит. */}
                <span
                  className={`badge set-hero-badge ${
                    engine.engineView.isCloud || !engine.engineView.ready ? 'badge-warn' : 'badge-ok'
                  }`}
                  data-testid="settings-hero-badge"
                >
                  <i className={`net-dot${engine.engineView.isCloud || !engine.engineView.ready ? ' warn' : ''}`} />
                  {engine.engineView.isCloud
                    ? 'есть исходящие'
                    : engine.engineView.ready
                      ? 'локальный режим'
                      : 'движок не запущен'}
                </span>
              </div>
              <div className="set-hero-stats">
                <div className="set-stat">
                  <span className="label-mono">Движок</span>
                  <b>{engine.engineView.label}</b>
                  <span className="mono set-stat-sub num">
                    {/* NF-2: скорость только настоящая — из последнего локального ответа. */}
                    {engine.engineView.isCloud
                      ? engine.engineView.model
                      : engine.metrics.tokensPerSec !== null
                        ? `${engine.metrics.tokensPerSec} токенов/с`
                        : `${NO_DATA} токенов/с`}
                  </span>
                </div>
                <div className="set-stat">
                  <span className="label-mono">Индекс</span>
                  <b className="num">
                    <NumTicker value={stats.links} /> связей
                  </b>
                  <span className="mono set-stat-sub num">
                    <NumTicker value={stats.files} />{' '}
                    {plural(stats.files, 'файл', 'файла', 'файлов')}
                  </span>
                </div>
                <div className="set-stat">
                  <span className="label-mono">Сейф</span>
                  <b className="num">{fmtBytes(stats.bytes)}</b>
                  <span className="mono set-stat-sub num">
                    из {fmtBytes(stats.quota)} · {stats.usedPct}%
                  </span>
                </div>
                <div className="set-stat">
                  <span className="label-mono">Уведомления</span>
                  <b className="num">{notifyOn} из 3</b>
                  <span className="mono set-stat-sub">каналов включено</span>
                </div>
              </div>
            </div>

            <section className="sec panel" id="set-engine">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconChipAi />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Движок ИИ</div>
                  <div className="setting-note">Где выполняется индексация и генерация ответов</div>
                </div>
                <span className="sec-meta label-mono">{ENGINES.length} варианта</span>
              </div>

              <div className="engine-group" role="radiogroup" aria-label="Движок ИИ">
                {ENGINES.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={d.engine === e.id}
                    className={`engine-option${d.engine === e.id ? ' selected' : ''}`}
                    onClick={() => S.setDraftSettings((s) => ({ ...s, engine: e.id }))}
                    data-testid={`engine-${e.id}`}
                  >
                    <span className="radio-dot" />
                    <span>
                      <span className="engine-name">
                        {e.name}
                        {e.badge && <span className="chip chip-ai">{e.badge}</span>}
                      </span>
                      <span className="engine-sub">{e.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="model-row">
                <span className="label-mono">Модель</span>
                <select
                  className="select"
                  value={d.model}
                  onChange={(e) =>
                    S.setDraftSettings((s) => ({ ...s, model: e.target.value as typeof s.model }))
                  }
                  aria-label="Модель"
                  style={{ maxWidth: 260 }}
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span
                  className={`badge ${localReady ? 'badge-ok' : 'badge-warn'}`}
                  data-testid="model-state"
                >
                  {localReady
                    ? d.model === S.settings.model
                      ? `установлена · ${engine.local?.model ?? ''}`
                      : 'применится после сохранения'
                    : engine.local?.code === 'MODEL_NOT_PULLED'
                      ? 'модели нет на устройстве'
                      : 'локальный движок не запущен'}
                </span>
                <span className="stat-line" style={{ marginTop: 0 }}>
                  {draftModel.ram ?? NO_DATA} ОЗУ ·{' '}
                  <b className="num">
                    {engine.metrics.tokensPerSec ?? draftModel.tokensPerSec ?? NO_DATA} токенов/с
                  </b>
                </span>
              </div>

              {/* NF-2: настоящее состояние локального движка и что сделать, если он молчит. */}
              <EnginePanel />

              <div className="sec-note">
                Скорость выше — из последнего локального ответа: её присылает сам движок
                (eval_count / eval_duration). Пока локального ответа не было, стоит «{NO_DATA}»:
                у метрики нет источника.
              </div>

              {!draftEngine.offline && (
                <div className="sec-note">
                  Выбран режим «{draftEngine.short}»: часть запросов уйдёт наружу. Статус-бар и
                  колокольчик сообщат об этом сразу после сохранения.
                </div>
              )}
            </section>

            <UiScaleSection />


            <section className="sec panel" id="set-pipeline">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconPipeline />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Конвейер обработки</div>
                  <div className="setting-note">
                    Путь файла от появления до связи на карте памяти
                  </div>
                </div>
                <span className="sec-meta label-mono num">
                  {stats.processing > 0 ? `${stats.processing} в очереди` : 'очередь пуста'}
                </span>
              </div>

              {/* Конвейер занят — стрелки между шагами текут акцентным пунктиром. */}
              <div className={`pipeline${stats.processing > 0 ? ' busy' : ''}`}>
                {steps.map((s, i) => (
                  <div key={s.name} style={{ display: 'contents' }}>
                    {i > 0 && (
                      <div className="flow-sep" aria-hidden="true">
                        <IconArrowRight />
                      </div>
                    )}
                    <div className="step">
                      <span className="step-icon">
                        <s.Icon />
                      </span>
                      <span className="step-name">{s.name}</span>
                      <span className={`step-status${s.warn ? ' warn' : ''}`}>
                        <i />
                        {s.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sec-split" />
              {rows(PIPELINE_TOGGLES)}
            </section>

            <section className="sec panel" id="set-notify">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconBell />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Уведомления</div>
                  <div className="setting-note">
                    О чём колокольчик в шапке сообщает и что остаётся в журнале
                  </div>
                </div>
                <span className="sec-meta label-mono num">{notifyOn} из 3</span>
              </div>

              {rows(NOTIFY_TOGGLES)}

              <div className="sec-note">
                В журнале сейчас {N.notifs.length}{' '}
                {plural(N.notifs.length, 'событие', 'события', 'событий')}
                {N.unread > 0 ? `, из них ${N.unread} непрочитанных` : ', все прочитаны'}. Журнал
                хранится в сейфе и никуда не отправляется: ни push, ни почта, ни внешние сервисы.
              </div>
            </section>

            <section className="sec panel" id="set-storage">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconDatabase />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Хранилище</div>
                  <div className="setting-note">Расположение сейфа и объём индекса</div>
                </div>
                <span className="sec-meta label-mono num">{stats.usedPct}%</span>
              </div>

              <div className="field-block" style={{ marginTop: 0 }}>
                <span className="label-mono">Папка сейфа</span>
                <div className="folder-row">
                  <input
                    className="input input-mono"
                    value={d.folder}
                    onChange={(e) => S.setDraftSettings((s) => ({ ...s, folder: e.target.value }))}
                    aria-label="Папка сейфа"
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    data-testid="set-pick-folder"
                    onClick={() =>
                      idxs.fsaSupported
                        ? void idxa.connectFolder()
                        : flash(
                            'Браузер не даёт доступ к папке: выберите файлы кнопкой «Добавить файл» — содержимое всё равно прочитается локально.',
                          )
                    }
                  >
                    <IconFolder />
                    Выбрать
                  </button>
                  <button
                    className="btn btn-tertiary btn-sm"
                    data-testid="set-reindex"
                    disabled={idxs.busy || M.isPending('vault:reindex')}
                    onClick={() =>
                      void M.runExclusive('vault:reindex', () => D.reindexAll(), {
                        errorMessage: 'Переиндексация не прошла. Прежний индекс на месте.',
                      })
                    }
                  >
                    <IconRefresh />
                    {M.isPending('vault:reindex') ? 'Идёт…' : 'Переиндексировать'}
                  </button>
                </div>
                <div className="sec-note">
                  {idxs.indexedCount > 0
                    ? `Индекс содержимого: ${idxs.indexedCount} файлов прочитано локально${idxs.folder ? ` из «${idxs.folder}»` : ''}. OCR в продукте нет: сканы помечаются «без текстового слоя».`
                    : 'Индекса содержимого нет: подключите папку — файлы прочитаются в фоновом воркере, ни один байт не уйдёт наружу.'}
                </div>
              </div>

              <div className="field-block">
                <span className="label-mono">Из чего состоит сейф</span>
                {mix.length === 0 ? (
                  <div className="stat-line">Сейф пуст — состав считать не из чего.</div>
                ) : (
                  <>
                    <div className="mix-bar" role="img" aria-label="Состав хранилища по категориям">
                      {mix.map((m) => (
                        <i
                          key={m.id}
                          style={{ width: `${m.pct}%`, background: `rgba(${m.rgb},.85)` }}
                        />
                      ))}
                    </div>
                    <div className="mix-legend">
                      {mix.map((m) => (
                        <span className="mix-item" key={m.id}>
                          <i style={{ background: `rgba(${m.rgb},.85)` }} />
                          <span className="mix-label">{m.label}</span>
                          <b className="num">{fmtBytes(m.bytes)}</b>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="stat-line">
                  {fmtBytes(stats.bytes)} из {fmtBytes(stats.quota)} · {stats.files}{' '}
                  {plural(stats.files, 'файл', 'файла', 'файлов')} · индекс{' '}
                  <b className="num">{stats.links} связей</b>
                </div>
              </div>
            </section>

            <section className="sec panel" id="set-privacy">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconShield />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Приватность</div>
                  <div className="setting-note">
                    Что видно на экране и что уходит за пределы устройства
                  </div>
                </div>
                <span className="sec-meta label-mono">
                  {engine.engineView.isCloud ? 'есть исходящие' : 'исходящих нет'}
                </span>
              </div>

              {rows(PRIVACY_TOGGLES)}

              <div className="setting-row" data-testid="cloud-consent-row">
                <div className="setting-row-text">
                  <div className="setting-title">Согласие на облачные запросы</div>
                  <div className="setting-note">
                    {S.settings.cloudConsentAt
                      ? `Дано ${new Date(S.settings.cloudConsentAt).toLocaleString('ru-RU')}. Каждый облачный ход пишется в ленту событий.`
                      : 'Не дано: перед первым запросом во внешнюю модель спросим и покажем, что именно уйдёт.'}
                  </div>
                </div>
                {S.settings.cloudConsentAt ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={S.revokeCloudConsent}
                    data-testid="revoke-consent"
                  >
                    Отозвать
                  </button>
                ) : (
                  <span className="badge badge-ok">спросим заранее</span>
                )}
              </div>

              <div className="field-block">
                <div className="mask-head">
                  <span className="label-mono">Пример скрытия</span>
                  <span className="mask-flag">
                    <IconShield width={11} height={11} aria-hidden="true" focusable="false" />
                    <span className="mask-flag-text">
                      {d.toggles.redact ? 'маскируется локально' : 'маскировка выключена'}
                    </span>
                  </span>
                </div>
                <div className="mask-demo">
                  <span className="mask-key mono">ИНН</span>
                  {d.toggles.redact ? (
                    <span className="mask-value" role="img" aria-label="Значение скрыто маской">
                      {[0, 1, 2].map((g) => (
                        <span className="mask-group" key={g}>
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="mask-value mono">7712 3456 7890</span>
                  )}
                  <span className="mask-hint">
                    12 знаков · {d.toggles.redact ? 'не покидает устройство' : 'видно в превью'}
                  </span>
                </div>
              </div>
            </section>

            <SecuritySection />
            <SecretsSection />
            <BackupSection />
            <FlagsSection />
            <JournalPanel />

            <section className="sec panel danger-zone" id="set-danger">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconTrash />
                </span>
                <div className="sec-head-text">
                  <div className="setting-title">Опасная зона</div>
                  <div className="setting-note">Действия необратимы и затрагивают весь индекс</div>
                </div>
                <span className="sec-meta label-mono">без отмены</span>
              </div>

              <div className="rows-list">
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-title">Очистить ИИ-индекс</div>
                    <div className="setting-note">
                      Файлы останутся на диске, но связи и описания придётся построить заново
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={stats.files === 0}
                    onClick={D.clearIndex}
                    data-testid="settings-clear-index"
                  >
                    Очистить индекс
                  </button>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-title">Удалить сейф целиком</div>
                    <div className="setting-note">
                      {stats.files} {plural(stats.files, 'файл', 'файла', 'файлов')},{' '}
                      {fmtBytes(stats.bytes)} и все заметки будут стёрты
                    </div>
                  </div>
                  {confirmWipe ? (
                    <span className="save-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setConfirmWipe(false)}
                        data-testid="settings-delete-vault-cancel"
                      >
                        Отмена
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setConfirmWipe(false)
                          D.wipeVault()
                        }}
                        data-testid="settings-delete-vault-confirm"
                      >
                        Да, стереть
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={stats.files === 0}
                      onClick={() => setConfirmWipe(true)}
                      data-testid="settings-delete-vault"
                    >
                      Удалить сейф
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="set-footer">
        <div className="save-bar panel glass">
          <span className={`save-hint${S.dirty ? ' dirty' : ''}`}>
            <i />
            {S.dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены локально'}
          </span>
          <div className="save-actions">
            <button
              className="btn btn-ghost btn-sm"
              disabled={!S.dirty}
              onClick={S.revertSettings}
              data-testid="settings-revert"
            >
              Отменить
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!S.dirty}
              onClick={S.saveSettings}
              data-testid="settings-save"
            >
              Сохранить
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
