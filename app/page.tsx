'use client'

import { ScreenBoundary } from '@/components/screen-boundary'
import { AppShell } from '@/components/app-shell'
import { SCREENS } from '@/components/screens'
import { useVault } from '@/lib/vault-store'

/**
 * Единственная страница прототипа. Все экраны читают состояние из
 * единого сейфа (useVault) и не принимают пропсов: переходы между ними —
 * это тоже состояние сейфа, поэтому здесь остался только выбор экрана.
 * Экран приезжает своим чанком (AR-2) и обёрнут boundary (UX-2): его
 * падение не роняет каркас.
 */
export default function Page() {
  const { screen } = useVault()
  const Screen = SCREENS[screen]

  return (
    <AppShell>
      <ScreenBoundary key={screen} name={screen}>
        <Screen />
      </ScreenBoundary>
    </AppShell>
  )
}
