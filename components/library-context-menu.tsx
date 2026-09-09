'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './library-sharing.css'

export type LibraryMenuTarget = { kind: 'file' | 'note'; id: string; x: number; y: number; trigger: HTMLElement }
export type LibraryMenuAction = { id: string; label: string; icon: ReactNode; run?: () => void; href?: string; disabled?: boolean; note?: string; danger?: boolean }

export function LibraryContextMenu({ target, title, actions, onClose }: {
  target: LibraryMenuTarget; title: string; actions: LibraryMenuAction[]; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0, ready: false })
  useLayoutEffect(() => {
    const el = ref.current!
    const r = el.getBoundingClientRect()
    const scale = r.width / el.offsetWidth || 1
    setPosition({
      x: Math.max(8, Math.min(target.x, innerWidth - r.width - 8)) / scale,
      y: Math.max(8, Math.min(target.y, innerHeight - r.height - 8)) / scale,
      ready: true,
    })
    const dismiss = (e: Event) => { if (!el.contains(e.target as Node)) onClose() }
    const resize = () => onClose()
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', resize)
    }
  }, [target, onClose])
  useLayoutEffect(() => {
    if (position.ready) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [position.ready, target])

  return createPortal(
    <div ref={ref} className="library-context-menu" role="menu" aria-label="Действия объекта" data-testid="library-context-menu"
      style={{ left: position.x, top: position.y, visibility: position.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); return }
        const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
        if (next >= 0) { e.preventDefault(); items[next]?.focus() }
      }}>
      <div className="library-menu-title" title={title} data-testid="library-context-title">{title}</div>
      {actions.map((a) => {
        const children = <>{a.icon}<span>{a.label}{a.note && <small data-testid={`library-menu-${a.id}-note`}>{a.note}</small>}</span></>
        const props = { role: 'menuitem', 'data-testid': `library-menu-${a.id}`, className: a.danger ? 'danger' : '', onClick: () => { onClose(); a.run?.() } }
        return a.href ? <a key={a.id} {...props} href={a.href}>{children}</a> : <button key={a.id} type="button" {...props} disabled={a.disabled} title={a.note}>{children}</button>
      })}
    </div>, document.body,
  )
}