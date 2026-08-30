'use client'

import { AppShell } from '@/components/app-shell'
import { ScreenBoundary } from '@/components/screen-boundary'
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
 * Каждый экран обёрнут boundary (UX-2): его падение не роняет каркас.
 */
export default function Page() {
  const v = useVault()

  return (
    <AppShell>
      {v.screen === 'library' && (
        <ScreenBoundary name="library">
          <ScreenLibrary />
        </ScreenBoundary>
      )}
      {v.screen === 'map' && (
        <ScreenBoundary name="map">
          <ScreenMap />
        </ScreenBoundary>
      )}
      {v.screen === 'chat' && (
        <ScreenBoundary name="chat">
          <ScreenChat />
        </ScreenBoundary>
      )}
      {v.screen === 'vault' && (
        <ScreenBoundary name="vault">
          <ScreenVault />
        </ScreenBoundary>
      )}
      {v.screen === 'settings' && (
        <ScreenBoundary name="settings">
          <ScreenSettings />
        </ScreenBoundary>
      )}
    </AppShell>
  )
}
