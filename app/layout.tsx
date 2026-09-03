import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
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
        {/* Сейф и его провайдеры живут в app/(app)/layout.tsx: страница входа
            не должна тянуть состояние сейфа, индексатор и менеджер секретов. */}
        {children}
        {/* Аналитика Vercel убрана: приложение хостится не на Vercel, скрипт
            всё равно отдавал 404, а его чанк (~19 kB) висел в первом бандле
            каждого маршрута. Понадобится Vercel — вернуть @vercel/analytics. */}
      </body>
    </html>
  )
}
