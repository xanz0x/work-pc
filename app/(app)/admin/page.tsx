'use client'

import { useEffect } from 'react'
import { AppShell } from '@/components/app-shell'
import { ScreenBoundary } from '@/components/screen-boundary'
import { SCREENS } from '@/components/screens'
import { useAccount } from '@/lib/account'
import { useVault } from '@/lib/vault-store'

/** /admin — тот же каркас, экран «Администрирование». Не админа уводит на главную. */
export default function AdminPage() {
  const v = useVault()
  const { isAdmin } = useAccount()
  useEffect(() => {
    if (!isAdmin) window.location.replace('/')
    else if (v.screen !== 'admin') v.go('admin')
  }, [isAdmin, v])
  const Screen = SCREENS.admin
  return (
    <AppShell>
      <ScreenBoundary key="admin" name="admin">
        {isAdmin ? <Screen /> : null}
      </ScreenBoundary>
    </AppShell>
  )
}
