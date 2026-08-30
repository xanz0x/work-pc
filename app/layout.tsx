import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { StorageAlert } from '@/components/storage-alert'
import { RedactedProvider } from '@/lib/redact-context'
import { SecretsProvider } from '@/lib/secrets-store'
import { VaultProvider } from '@/lib/vault-store'
import './globals.css'

const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'WorkfloW · Локальное ИИ-хранилище',
  description:
    'Приватное локальное хранилище с ИИ-индексацией: библиотека файлов, карта памяти, чат с локальной моделью и настройки конвейера обработки.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#030507',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        {/* Bootstrap замка (план п.10.11): до гидратации знаем, стоит ли замок,
            чтобы первый кадр не мигнул открытым сейфом. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=JSON.parse(localStorage.getItem('wf.lock.config')||'null');if(c&&c.enabled)document.documentElement.classList.add('lock-pending')}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        {/* Красакт объектов под файловым ключом (пп.10.2–10.3) оборачивает
            весь сейф: поиск в store, палитра, чат и карта читают один set.
            Второй агент (этап 5) наполняет список из hooks/use-file-keys. */}
        <RedactedProvider>
          {/* Единый сейф: корпус, стикеры, разговоры, настройки и события —
              одно состояние на все четыре экрана, поэтому числа не расходятся. */}
          <VaultProvider>
            {/* Менеджер секретов живёт поверх сейфа: без открытого замка
                он ничего не расшифровывает и ничего не пишет. */}
            <SecretsProvider>{children}</SecretsProvider>
          </VaultProvider>
        </RedactedProvider>
        {/* Ошибка записи хранилища видна пользователю (P0-3): «не сохранилось»
            с повтором, переполнение квоты — отдельный честный экран. */}
        <StorageAlert />
        {/* Скрипт аналитики существует только на хостинге Vercel — вне его даёт 404. */}
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
