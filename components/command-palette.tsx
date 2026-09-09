'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import { useVault } from '@/lib/vault-store'
import { useSecrets } from '@/lib/secrets-store'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import { SCOPES } from '@/lib/search'
import type { Hit, HitKind } from '@/lib/search'
import {
  GROUP_LABEL,
  commandById,
  filterCommands,
  loadRecent,
  pushRecent,
  type Command,
  type CommandCtx,
  type CommandGroup,
  type CommandIcon,
} from '@/lib/commands'
import {
  IconBell,
  IconChat,
  IconMail,
  IconClip,
  IconDatabase,
  IconDoc,
  IconEye,
  IconFolder,
  IconGear,
  IconGraph,
  IconGridBoard,
  IconKey,
  IconLayers,
  IconLockRound,
  IconPipeline,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShield,
  IconSparkText,
  IconSticker,
  IconTrash,
} from './icons'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/** Иконка результата по его виду — палитра и топбар зовут одну и ту же. */
const HIT_ICON: Record<HitKind, Ico> = {
  file: IconDoc,
  note: IconSticker,
  chat: IconChat,
  cluster: IconLayers,
  setting: IconGear,
  secret: IconShield,
}

const KIND_LABEL: Record<HitKind, string> = {
  file: 'Файл',
  note: 'Стикер',
  chat: 'Разговор',
  cluster: 'Кластер',
  setting: 'Настройки',
  secret: 'Секрет',
}

const CMD_ICON: Record<CommandIcon, Ico> = {
  doc: IconDoc,
  sticker: IconSticker,
  chat: IconChat,
  layers: IconLayers,
  gear: IconGear,
  shield: IconShield,
  key: IconKey,
  search: IconSearch,
  refresh: IconRefresh,
  trash: IconTrash,
  plus: IconPlus,
  lock: IconLockRound,
  bell: IconBell,
  graph: IconGraph,
  database: IconDatabase,
  eye: IconEye,
  clip: IconClip,
  folder: IconFolder,
  spark: IconSparkText,
  grid: IconGridBoard,
  pipeline: IconPipeline,
  mail: IconMail,
}

/** Строка списка: результат поиска, команда или заголовок группы. */
type Row =
  | { kind: 'head'; key: string; label: string; note?: string }
  | { kind: 'hit'; key: string; hit: Hit }
  | { kind: 'cmd'; key: string; cmd: Command; available: boolean }

/**
 * Ctrl/Cmd+K — окно поиска по сейфу И командный центр. Первая группа —
 * найденные сущности (тот же store, что у топбара: набранное в палитре
 * видно в шапке и наоборот). Дальше — реестр команд: действия, переходы
 * и настройки, у каждой подсказка и доступность по контексту.
 */
export function CommandPalette() {
  const v = useVault()
  const s = useSecrets()
  const idxs = useIndexSummary()
  const idxa = useIndexActions()
  const inputRef = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(0)
  const [recent, setRecent] = useState<string[]>([])

  /* При каждом открытии — фокус в поле, сброс курсора и свежее «недавнее».
     Фокус ставим синхронно после кадра открытия: пауза в 20 мс съедала
     первые нажатия — Esc и первые буквы уходили в пустоту (найдено приёмкой). */
  useEffect(() => {
    if (!v.palette) return
    setCursor(0)
    setRecent(loadRecent())
    inputRef.current?.focus()
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [v.palette])

  // Новый запрос — снова целимся в самый релевантный результат.
  useEffect(() => setCursor(0), [v.query, v.scope])

  const close = useCallback(() => v.setPalette(false), [v])

  /** Всё, что командам нужно знать о сейфе. Собирается здесь, а не в реестре. */
  const ctx = useMemo<CommandCtx>(
    () => ({
      screen: v.screen,
      lockStatus: v.lock.status,
      secretsReady: s.ready,
      folderConnected: idxs.folder !== '' && idxs.folderMode === 'fsa',
      indexBusy: idxs.busy,
      unread: v.unread,
      clipActive: s.clip !== null,
      telemetry: v.settings.toggles.telemetry,
      go: v.go,
      openSetting: v.openSetting,
      flash: v.flash,
      setQuery: v.setQuery,
      setScope: v.setScope,
      setToggle: v.setToggle,
      lockNow: v.lockNow,
      markAllRead: v.markAllRead,
      hideSecrets: s.hideAll,
      clearClipboard: () => void s.clearClipboard(),
      backupSecrets: () => void s.backupNow(),
      connectFolder: () => void idxa.connectFolder(),
      reindex: () => void idxa.reindex(false),
    }),
    [v, s, idxs.folder, idxs.folderMode, idxs.busy, idxa],
  )

  const runCommand = useCallback(
    (cmd: Command, available: boolean) => {
      if (!available) {
        v.flash(`«${cmd.title}» сейчас недоступна: ${cmd.blocked ?? 'нет условий для запуска'}`)
        return
      }
      setRecent(pushRecent(cmd.id))
      v.setPalette(false)
      cmd.run(ctx)
    },
    [ctx, v],
  )

  const query = v.query.trim()
  const hits = useMemo(() => (query === '' ? [] : v.hits.slice(0, 8)), [query, v.hits])
  const cmds = useMemo(() => filterCommands(query, ctx), [query, ctx])

  /* Плоский список строк: по нему ходит курсор и считается «↵ открыть». */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (query !== '') {
      out.push({
        kind: 'head',
        key: 'h-hits',
        label: 'Найдено в сейфе',
        note: v.hits.length > hits.length ? `${hits.length} из ${v.hits.length}` : `${hits.length}`,
      })
      if (hits.length === 0) {
        out.push({ kind: 'head', key: 'h-hits-empty', label: `По запросу «${query}» ничего не найдено` })
      }
      for (const hit of hits) out.push({ kind: 'hit', key: `hit-${hit.key}`, hit })
    } else if (recent.length > 0) {
      out.push({ kind: 'head', key: 'h-recent', label: 'Недавнее' })
      for (const id of recent) {
        const cmd = commandById(id)
        if (cmd) {
          out.push({
            kind: 'cmd',
            key: `recent-${cmd.id}`,
            cmd,
            available: cmd.when ? cmd.when(ctx) : true,
          })
        }
      }
    }

    const groups: CommandGroup[] = ['action', 'nav', 'setting']
    for (const g of groups) {
      const list = cmds.filter((c) => c.cmd.group === g)
      if (list.length === 0) continue
      out.push({ kind: 'head', key: `h-${g}`, label: GROUP_LABEL[g], note: String(list.length) })
      for (const c of list) {
        out.push({ kind: 'cmd', key: `${g}-${c.cmd.id}`, cmd: c.cmd, available: c.available })
      }
    }
    return out
  }, [query, hits, v.hits.length, recent, cmds, ctx])

  /* Курсор ходит только по тому, что можно запустить. Если сохранённая
     позиция выпала из списка (сменился запрос), берём первую доступную —
     считаем это в рендере, без эффекта-догонялки. */
  const pickable = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.kind === 'hit' || (r.kind === 'cmd' && r.available))
        .map(({ i }) => i),
    [rows],
  )
  const active = pickable.includes(cursor) ? cursor : (pickable[0] ?? -1)

  if (!v.palette) return null

  function runRow(index: number) {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'hit') {
      v.runHit(row.hit)
      return
    }
    if (row.kind === 'cmd') runCommand(row.cmd, row.available)
  }

  function step(delta: number) {
    if (pickable.length === 0) return
    const at = pickable.indexOf(active)
    const next = at < 0 ? 0 : Math.min(pickable.length - 1, Math.max(0, at + delta))
    setCursor(pickable[next])
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (pickable.length > 0) setCursor(pickable[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      if (pickable.length > 0) setCursor(pickable[pickable.length - 1])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runRow(active)
    }
  }

  return (
    <div className="cmdk-backdrop" onPointerDown={close} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Палитра: поиск и команды"
        data-testid="cmdk"
        onPointerDown={(e) => e.stopPropagation()}
        /* Клавиши слушает всё окно, а не только поле ввода: после клика по
           чипу области или Tab фокус уходит с поля, и Esc со стрелками
           переставали работать (найдено приёмкой). */
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-field">
          <IconSearch width={16} height={16} stroke="currentColor" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            data-testid="cmdk-input"
            placeholder="Поиск по сейфу или команда: «стикер», «замок», «настройки»…"
            value={v.query}
            onChange={(e) => v.setQuery(e.target.value)}
            aria-label="Поисковый запрос или команда"
          />
          <kbd>ESC</kbd>
        </div>

        <div className="cmdk-scopes" role="tablist" aria-label="Область поиска">
          {SCOPES.map((sc) => (
            <button
              key={sc.value}
              role="tab"
              aria-selected={v.scope === sc.value}
              className={`cmdk-scope${v.scope === sc.value ? ' on' : ''}`}
              onClick={() => v.setScope(sc.value)}
              title={sc.note}
            >
              {sc.label}
            </button>
          ))}
        </div>

        <div className="cmdk-results" role="listbox" aria-label="Результаты и команды">
          {rows.length === 0 ? (
            <p className="cmdk-empty">Реестр команд пуст — такого быть не должно.</p>
          ) : (
            rows.map((row, i) =>
              row.kind === 'head' ? (
                <div key={row.key} className="cmdk-group label-mono" data-testid={`cmdk-group-${row.key}`}>
                  <span>{row.label}</span>
                  {row.note ? <span className="cmdk-group-note num">{row.note}</span> : null}
                </div>
              ) : row.kind === 'hit' ? (
                <PaletteRow
                  key={row.key}
                  hit={row.hit}
                  active={i === active}
                  onRun={() => v.runHit(row.hit)}
                  onHover={() => setCursor(i)}
                />
              ) : (
                <CommandRow
                  key={row.key}
                  cmd={row.cmd}
                  available={row.available}
                  active={i === active}
                  onRun={() => runCommand(row.cmd, row.available)}
                  onHover={() => row.available && setCursor(i)}
                />
              ),
            )
          )}
        </div>

        <div className="cmdk-foot label-mono">
          <span>
            {query === ''
              ? `${cmds.length} ${plural(cmds.length, 'команда', 'команды', 'команд')} · поиск начнётся с первой буквы`
              : `${hits.length} в сейфе · ${cmds.length} ${plural(cmds.length, 'команда', 'команды', 'команд')}`}
          </span>
          <span className="grow" />
          <span>↑↓ выбрать · ↵ запустить · Esc закрыть</span>
        </div>
      </div>
    </div>
  )
}

function PaletteRow({
  hit,
  active,
  onRun,
  onHover,
}: {
  hit: Hit
  active: boolean
  onRun: () => void
  onHover: () => void
}) {
  const Icon = HIT_ICON[hit.kind]
  const redacted = hit.kind === 'file' && hit.locked === true
  return (
    <button
      role="option"
      aria-selected={active}
      className={`cmdk-row${active ? ' cursor' : ''}${redacted ? ' is-locked' : ''}`}
      onClick={onRun}
      onMouseEnter={onHover}
      data-testid={`cmdk-hit-${hit.kind}`}
    >
      <span className="cmdk-icon">
        <Icon />
      </span>
      <span className="cmdk-text">
        <span className="cmdk-title ellipsis">{hit.title}</span>
        <span className="cmdk-sub ellipsis">{redacted ? 'Под ключом' : hit.sub}</span>
      </span>
      {redacted ? (
        <span className="cmdk-badge is-lockflag">под ключом</span>
      ) : (
        hit.fuzzy && <span className="cmdk-badge">по смыслу</span>
      )}
      <span className="cmdk-kind label-mono">{KIND_LABEL[hit.kind]}</span>
    </button>
  )
}

function CommandRow({
  cmd,
  available,
  active,
  onRun,
  onHover,
}: {
  cmd: Command
  available: boolean
  active: boolean
  onRun: () => void
  onHover: () => void
}) {
  const Icon = CMD_ICON[cmd.icon]
  return (
    <button
      role="option"
      aria-selected={active}
      aria-disabled={!available}
      className={`cmdk-row cmdk-cmd${active ? ' cursor' : ''}${available ? '' : ' cmdk-off'}`}
      onClick={onRun}
      onMouseEnter={onHover}
      data-testid={`cmdk-cmd-${cmd.id}`}
    >
      <span className="cmdk-icon">
        <Icon />
      </span>
      <span className="cmdk-text">
        <span className="cmdk-title ellipsis">{cmd.title}</span>
        <span className="cmdk-sub ellipsis">
          {available ? cmd.hint : `Недоступно: ${cmd.blocked ?? 'нет условий для запуска'}`}
        </span>
      </span>
      {cmd.keys ? <span className="cmdk-keys mono">{cmd.keys}</span> : null}
      <span className="cmdk-kind label-mono">{available ? 'Команда' : 'недоступна'}</span>
    </button>
  )
}
