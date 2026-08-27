'use client'

import { AppShell } from '@/components/app-shell'
import { ScreenChat } from '@/components/screen-chat'
import { ScreenLibrary } from '@/components/screen-library'
import { ScreenMap } from '@/components/screen-map'
import { ScreenSettings } from '@/components/screen-settings'
import { useVault } from '@/lib/vault-store'

/**
 * Единственная страница прототипа. Все четыре экрана читают состояние из
 * единого сейфа (useVault) и не принимают пропсов: переходы между ними —
 * это тоже состояние сейфа, поэтому здесь остался только выбор экрана.
 */
export default function Page() {
  const v = useVault()

  return (
    <AppShell>
      {v.screen === 'library' && <ScreenLibrary />}
      {v.screen === 'map' && <ScreenMap />}
      {v.screen === 'chat' && <ScreenChat />}
      {v.screen === 'settings' && <ScreenSettings />}
    </AppShell>
  )
}
