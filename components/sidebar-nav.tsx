'use client'

import { Fragment, useState, type ComponentType, type DragEvent, type SVGProps } from 'react'
import {
  IconChat,
  IconCheck,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconGear,
  IconGraph,
  IconGrip,
  IconKey,
  IconLibrary,
  IconMail,
  IconPipeline,
  IconRefresh,
  IconUser,
} from './icons'
import { prefetchScreen } from './screens'
import { useNavPrefs } from '@/hooks/use-nav-prefs'
import { NAV_LOCKED, isDefaultNav, placeNav, toggleHidden } from '@/lib/nav-prefs'
import { useAccount } from '@/lib/account'
import { useVault, type ScreenId } from '@/lib/vault-store'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

const META: Record<ScreenId, { label: string; Icon: Ico }> = {
  library: { label: 'Библиотека', Icon: IconLibrary },
  map: { label: 'Карта памяти', Icon: IconGraph },
  chat: { label: 'Чат с ИИ', Icon: IconChat },
  vault: { label: 'Менеджер секретов', Icon: IconKey },
  mail: { label: 'Почта', Icon: IconMail },
  activity: { label: 'Центр активности', Icon: IconPipeline },
  settings: { label: 'Настройки', Icon: IconGear },
  admin: { label: 'Администрирование', Icon: IconUser },
}

const COUNTED: ScreenId[] = ['library', 'map', 'chat', 'vault']

const filesWord = (n: number) => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'файл'
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'файла'
  return 'файлов'
}

type Props = {
  counts: Record<ScreenId, number>
  clusters: ReturnType<typeof useVault>['clusters']
  collapsed: boolean
}

/**
 * Боковое меню: один плоский список, который пользователь сам расставляет
 * перетаскиванием и скрывает лишнее. Порядок живёт на сервере у аккаунта.
 */
export function SidebarNav({ counts, clusters, collapsed }: Props) {
  const v = useVault()
  const account = useAccount()
  const { prefs, update, reset } = useNavPrefs()
  const [editOn, setEditing] = useState(false)
  const editing = editOn && !collapsed
  const [libOpen, setLibOpen] = useState(false)
  const [dragId, setDragId] = useState<ScreenId | null>(null)
  const [overId, setOverId] = useState<ScreenId | null>(null)

  const available = prefs.order.filter(
    (id) =>
      (id !== 'chat' || account.has('ai')) &&
      (id !== 'vault' || account.has('secrets')) &&
      (id !== 'mail' || account.has('mail')) &&
      id !== 'admin',
  )
  const shown = editing ? available : available.filter((id) => !prefs.hidden.includes(id))

  function moveBy(id: ScreenId, dir: -1 | 1) {
    const i = available.indexOf(id)
    const target = available[i + dir]
    if (!target) return
    update({ ...prefs, order: placeNav(prefs.order, id, target, dir > 0) })
  }

  function onDragStart(e: DragEvent, id: ScreenId) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function onDragOver(e: DragEvent, id: ScreenId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overId !== id) setOverId(id)
  }
  function onDrop(e: DragEvent, target: ScreenId) {
    e.preventDefault()
    const id = (dragId ?? (e.dataTransfer.getData('text/plain') as ScreenId)) || null
    if (id && id !== target) {
      const after = available.indexOf(id) < available.indexOf(target)
      update({ ...prefs, order: placeNav(prefs.order, id, target, after) })
    }
    setDragId(null)
    setOverId(null)
  }
  function onDragEnd() {
    setDragId(null)
    setOverId(null)
  }

  const liveClusters = clusters.filter((c) => c.count > 0)

  return (
    <nav className={`nav${editing ? ' nav-editing' : ''}`} aria-label="Основная навигация" data-testid="sidebar-nav">
      <div className="nav-section nav-section-row">
        <span>{editing ? 'Настройка меню' : 'Меню'}</span>
        {!collapsed && (
          <button
            className={`nav-edit-btn${editing ? ' on' : ''}`}
            onClick={() => setEditing((e) => !e)}
            title={editing ? 'Готово' : 'Настроить меню: порядок и видимость пунктов'}
            aria-label={editing ? 'Завершить настройку меню' : 'Настроить меню'}
            aria-pressed={editing}
            data-testid="nav-customize"
          >
            {editing ? <IconCheck /> : <IconGrip />}
          </button>
        )}
      </div>

      {shown.map((id, idx) => {
        const { label, Icon } = META[id]
        const hidden = prefs.hidden.includes(id)
        const locked = NAV_LOCKED.includes(id)

        if (editing) {
          return (
            <div
              key={id}
              className={`nav-row${hidden ? ' is-hidden' : ''}${dragId === id ? ' dragging' : ''}${
                overId === id && dragId && dragId !== id
                  ? available.indexOf(dragId) < available.indexOf(id)
                    ? ' drop-after'
                    : ' drop-before'
                  : ''
              }`}
              draggable
              onDragStart={(e) => onDragStart(e, id)}
              onDragOver={(e) => onDragOver(e, id)}
              onDrop={(e) => onDrop(e, id)}
              onDragEnd={onDragEnd}
              data-testid={`nav-row-${id}`}
            >
              <span className="nav-grip" aria-hidden="true">
                <IconGrip />
              </span>
              <span className="nav-item nav-item-static">
                <Icon />
                <span>{label}</span>
              </span>
              <button
                className="nav-mini"
                onClick={() => moveBy(id, -1)}
                disabled={idx === 0}
                title="Выше"
                aria-label={`Переместить «${label}» выше`}
                data-testid={`nav-up-${id}`}
              >
                <IconChevronDown className="rot" />
              </button>
              <button
                className="nav-mini"
                onClick={() => moveBy(id, 1)}
                disabled={idx === shown.length - 1}
                title="Ниже"
                aria-label={`Переместить «${label}» ниже`}
                data-testid={`nav-down-${id}`}
              >
                <IconChevronDown />
              </button>
              <button
                className={`nav-mini nav-eye${hidden ? ' off' : ''}`}
                onClick={() => update(toggleHidden(prefs, id))}
                disabled={locked}
                title={locked ? 'Этот пункт скрыть нельзя' : hidden ? 'Показать в меню' : 'Скрыть из меню'}
                aria-label={hidden ? `Показать «${label}»` : `Скрыть «${label}»`}
                aria-pressed={!hidden}
                data-testid={`nav-toggle-${id}`}
              >
                {hidden ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          )
        }

        const btn = (
          <button
            className={`nav-item${v.screen === id ? ' active' : ''}`}
            onClick={() => v.go(id)}
            onPointerEnter={() => prefetchScreen(id)}
            onFocus={() => prefetchScreen(id)}
            aria-current={v.screen === id ? 'page' : undefined}
            title={label}
            data-testid={`nav-${id}`}
          >
            <Icon />
            <span>{label}</span>
            {COUNTED.includes(id) && <b className="nav-count num">{counts[id]}</b>}
          </button>
        )

        if (id !== 'library') return <Fragment key={id}>{btn}</Fragment>

        return (
          <Fragment key={id}>
            <div className="nav-lib-row">
              {btn}
              <button
                className={`nav-lib-chev${libOpen ? ' open' : ''}`}
                onClick={() => setLibOpen((o) => !o)}
                aria-expanded={libOpen}
                title={libOpen ? 'Свернуть кластеры' : 'Показать кластеры библиотеки'}
                aria-label="Кластеры библиотеки"
                data-testid="nav-library-toggle"
              >
                <IconChevronDown />
              </button>
            </div>
            {libOpen &&
              liveClusters.map((c) => (
                <button
                  key={c.id}
                  className="nav-item nav-sub"
                  onClick={() => v.openCluster(c.id)}
                  onPointerEnter={() => prefetchScreen('library')}
                  title={`${c.label} · ${c.count} ${filesWord(c.count)}`}
                  data-testid={`nav-cluster-${c.id}`}
                >
                  <i className="cluster-dot" style={{ background: `rgba(${c.rgb},.9)` }} />
                  <span>{c.label}</span>
                  <b className="nav-count num">{c.count}</b>
                </button>
              ))}
          </Fragment>
        )
      })}

      {editing && (
        <div className="nav-edit-foot">
          <span className="nav-edit-hint">Тяните за рукоятку или стрелками · глаз скрывает пункт</span>
          {!isDefaultNav(prefs) && (
            <button className="nav-reset" onClick={reset} data-testid="nav-reset">
              <IconRefresh />
              Сбросить
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
