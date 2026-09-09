'use client'

/* Раздел «Временные» в рейке: выбор генератора, список одноразовых ящиков, удаление в два клика. */

import { useEffect, useRef, useState } from 'react'
import { IconClock, IconPlus, IconTrash } from '../icons'
import { TEMP_LABEL, type TempBoxView, type TempKind } from '@/lib/mail-client'

const KINDS: TempKind[] = ['mailtm', 'gmail', 'outlook']

const HINT: Record<TempKind, string> = {
  mailtm: 'нестандартный домен, без ключа и лимитов',
  temp: 'обычный домен, живёт 10 минут',
  gmail: 'настоящий адрес @gmail.com из пула',
  outlook: 'настоящий адрес Outlook/Hotmail из пула',
}

type Props = {
  boxes: TempBoxView[]
  activeId: string | null
  smailpro: boolean
  creating: TempKind | null
  onPick: (id: string) => void
  onCreate: (kind: TempKind) => void
  onRemove: (box: TempBoxView) => void
}

function Row({ box, active, onPick, onRemove }: { box: TempBoxView; active: boolean; onPick: () => void; onRemove: () => void }) {
  const [armed, setArmed] = useState(false)
  const short = box.address.length > 26 ? `${box.address.slice(0, 24)}…` : box.address
  return (
    <div
      className={`mail-acc-row mail-temp-row${active ? ' on' : ''}${armed ? ' armed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      aria-current={active ? 'true' : undefined}
      title={box.address}
      data-testid={`mail-temp-row-${box.id}`}
    >
      <span className="mail-temp-ico" aria-hidden="true">
        <IconClock width={13} height={13} />
      </span>
      <span className="mail-acc-text">
        <b className="mono">{short}</b>
        <span className="mono">{TEMP_LABEL[box.kind]}</span>
      </span>
      <button
        className={`mail-acc-del${armed ? ' armed' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          if (!armed) {
            setArmed(true)
            setTimeout(() => setArmed(false), 5000)
            return
          }
          setArmed(false)
          onRemove()
        }}
        title={armed ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить временный ящик'}
        aria-label={armed ? `Точно удалить ${box.address}?` : `Удалить ${box.address}`}
        data-testid={`mail-temp-row-delete-${box.id}`}
      >
        <IconTrash width={12} height={12} aria-hidden="true" />
        {armed && <span>Точно?</span>}
      </button>
    </div>
  )
}

export function MailTempRail({ boxes, activeId, smailpro, creating, onPick, onCreate, onRemove }: Props) {
  const [menu, setMenu] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  return (
    <>
      <div className="mail-rail-sec" ref={wrap}>
        <span className="label-mono">Временные</span>
        <span className="mail-rail-sec-r">
          <span className="mail-count num" data-testid="mail-temp-count">
            {boxes.length}
          </span>
          <button
            className="mail-rail-plus"
            onClick={() => setMenu((v) => !v)}
            disabled={!!creating}
            aria-expanded={menu}
            title="Создать временный ящик"
            aria-label="Создать временный ящик"
            data-testid="mail-temp-add"
          >
            <IconPlus width={12} height={12} aria-hidden="true" />
          </button>
        </span>
        {menu && (
          <div className="mail-temp-menu" role="menu" data-testid="mail-temp-menu">
            {KINDS.map((k) => (
              <button
                key={k}
                role="menuitem"
                className="mail-temp-menu-item"
                onClick={() => {
                  setMenu(false)
                  onCreate(k)
                }}
                disabled={!!creating}
                data-testid={`mail-temp-kind-${k}`}
              >
                <b>{TEMP_LABEL[k]}</b>
                <span>
                  {HINT[k]}
                  {k !== 'mailtm' && !smailpro ? ' · нужен ключ SONJJ_API_KEY' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mail-acc-rows" data-testid="mail-temp-rows">
        {creating && (
          <div className="mail-rail-note" data-testid="mail-temp-creating">
            Создаём ящик «{TEMP_LABEL[creating]}»…
          </div>
        )}
        {boxes.map((b) => (
          <Row key={b.id} box={b} active={b.id === activeId} onPick={() => onPick(b.id)} onRemove={() => onRemove(b)} />
        ))}
        {boxes.length === 0 && !creating && (
          <p className="mail-rail-note" data-testid="mail-temp-hint">
            Одноразовый адрес для регистраций: письма приходят сюда, отправлять с него нельзя.
          </p>
        )}
      </div>
    </>
  )
}
