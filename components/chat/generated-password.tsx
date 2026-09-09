'use client'

import { useEffect, useState } from 'react'
import { readChatPassword } from '@/lib/chat-passwords'
import { useSecrets } from '@/lib/secrets-store'
import { useLockStore } from '@/lib/vault-store'

export const GeneratedPassword = ({ passwordRef }: { passwordRef: string }) => {
  const [shown, setShown] = useState(false)
  const { copySecret } = useSecrets()
  const { lock } = useLockStore()
  const value = lock.status === 'locked' ? null : readChatPassword(passwordRef)
  useEffect(() => {
    if (!shown) return
    const hide = () => setShown(false)
    const timer = window.setTimeout(hide, 8000)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hide)
    return () => { clearTimeout(timer); window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', hide) }
  }, [shown])
  return <div className="chat-password" data-testid={`generated-password-${passwordRef}`}>
    <code className="chat-password-value" data-testid={`password-value-${passwordRef}`}>{value ? (shown ? value : '••••••••••••••••') : 'Пароль больше не доступен'}</code>
    <button className="btn btn-ghost btn-sm" disabled={!value} onClick={() => setShown(!shown)} data-testid={`password-reveal-${passwordRef}`}>{shown ? 'Скрыть' : 'Показать'}</button>
    <button className="btn btn-ghost btn-sm" disabled={!value} onClick={() => value && void copySecret(value, 'password', 'Пароль из чата')} data-testid={`password-copy-${passwordRef}`}>Копировать</button>
    <p className="chat-password-note" data-testid={`password-note-${passwordRef}`}>Только в этой вкладке до ухода из чата или блокировки. Для хранения попросите сохранить в секреты.</p>
  </div>
}