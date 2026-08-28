'use client'

import { AppShell } from '@/components/app-shell'
import { ScreenChat } from '@/components/screen-chat'
import { ScreenLibrary } from '@/components/screen-library'
import { ScreenMap } from '@/components/screen-map'
import { ScreenSettings } from '@/components/screen-settings'
import { ScreenVault } from '@/components/screen-vault'
import { useVault } from '@/lib/vault-store'

/**
 * Единственная страница прототипа. Все экраны читают состояние из
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
      {v.screen === 'vault' && <ScreenVault />}
      {v.screen === 'settings' && <ScreenSettings />}
    </AppShell>
  )
}
