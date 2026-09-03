import { StorageAlert } from '@/components/storage-alert'
import { IndexerProvider } from '@/lib/indexer/context'
import { McpBridge } from '@/lib/mcp-bridge'
import { RedactedProvider } from '@/lib/redact-context'
import { SecretsProvider } from '@/lib/secrets-store'
import { VaultProvider } from '@/lib/vault-store'

/**
 * Сейф и его провайдеры живут только здесь. В корневом layout они делали
 * первый бандл общим для всех маршрутов: страница входа тянула состояние
 * сейфа, индексатор и менеджер секретов, которыми не пользуется.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Редакт объектов под файловым ключом оборачивает весь сейф:
          поиск в store, палитра, чат и карта читают один set. */}
      <RedactedProvider>
        {/* Единый сейф: корпус, стикеры, разговоры, настройки и события —
            одно состояние на все экраны, поэтому числа не расходятся. */}
        <VaultProvider>
          {/* Индексатор (NF-1): читает папку в Web Worker, складывает
              содержимое, чанки и хеши в IndexedDB. */}
          <IndexerProvider>
            {/* Менеджер секретов живёт поверх сейфа: без открытого замка
                он ничего не расшифровывает и ничего не пишет. */}
            <SecretsProvider>
              {children}
              {/* NF-10: мост к MCP-серверу — выполняет задания внешних агентов
                  через те же сторы и пишет их аудит в журнал безопасности. */}
              <McpBridge />
            </SecretsProvider>
          </IndexerProvider>
        </VaultProvider>
      </RedactedProvider>
      {/* Ошибка записи хранилища видна пользователю (P0-3). */}
      <StorageAlert />
    </>
  )
}
