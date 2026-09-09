/* Описания инструментов MCP и проверка аргументов на границе (NF-10). */

import type { McpToolName } from '@/lib/permissions'

export type ToolDef = {
  name: McpToolName
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

const CLUSTERS = ['docs', 'fin', 'img', 'music', 'proj', 'misc']
const TTL = ['1h', '24h', '7d', 'forever']
const SECRET_TYPES = ['login', 'note', 'card', 'api', 'ssh', 'seed', 'wifi', 'license', 'identity', 'recovery', 'custom']

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search',
    title: 'Поиск по сейфу',
    description:
      'Ищет файлы, стикеры, разговоры и записи секретов по именам, меткам и заголовкам. Возвращает только метаданные совпадений.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Строка запроса' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_files',
    title: 'Список файлов',
    description: 'Метаданные файлов сейфа: имя, кластер, размер, дата, метки. Без содержимого.',
    inputSchema: {
      type: 'object',
      properties: {
        cluster: { type: 'string', enum: CLUSTERS },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'get_metadata',
    title: 'Метаданные объекта',
    description:
      'Сведения об одном объекте по id (файл, стикер или запись секретов). Значения секретных полей и тексты файлов не отдаются никогда.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'create_sticker',
    title: 'Создать стикер',
    description: 'Создаёт стикер (заметку) в сейфе владельца. Можно приколоть к файлу и задать срок жизни.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 4000 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        ttl: { type: 'string', enum: TTL, default: 'forever' },
        pinnedTo: { type: 'string', description: 'id файла' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'create_secret',
    title: 'Создать запись секретов',
    description:
      'Создаёт запись в менеджере секретов. ОПАСНАЯ операция: первый вызов возвращает pending_approval и approvalId; владелец подтверждает в интерфейсе, затем вызов повторяется с approvalId.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: SECRET_TYPES, default: 'login' },
        title: { type: 'string', maxLength: 120 },
        fields: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 40 },
              value: { type: 'string', maxLength: 4000 },
              secret: { type: 'boolean', description: 'Шифровать поле (по умолчанию для паролей и ключей)' },
            },
            required: ['name', 'value'],
          },
        },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        approvalId: { type: 'string', description: 'id подтверждения из предыдущего ответа' },
      },
      required: ['title', 'fields'],
    },
  },
]

const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const isTags = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length <= 10 && v.every((t) => isStr(t, 40)))

/** Возвращает описание ошибки или null. Проверяем формы, а не смысл. */
export function validateArgs(tool: McpToolName, a: Record<string, unknown>): string | null {
  switch (tool) {
    case 'search':
      if (!isStr(a.query, 500) || !(a.query as string).trim()) return 'query: непустая строка до 500 символов'
      return null
    case 'list_files':
      if (a.cluster !== undefined && !CLUSTERS.includes(String(a.cluster))) return 'cluster: неизвестный кластер'
      return null
    case 'get_metadata':
      if (!isStr(a.id, 120) || !(a.id as string).trim()) return 'id: непустая строка'
      return null
    case 'create_sticker':
      if (!isStr(a.title, 120) || !(a.title as string).trim()) return 'title: непустая строка до 120 символов'
      if (!isStr(a.body, 4000)) return 'body: строка до 4000 символов'
      if (!isTags(a.tags)) return 'tags: до 10 строк'
      if (a.ttl !== undefined && !TTL.includes(String(a.ttl))) return 'ttl: 1h | 24h | 7d | forever'
      if (a.pinnedTo !== undefined && !isStr(a.pinnedTo, 120)) return 'pinnedTo: строка'
      return null
    case 'create_secret': {
      if (a.type !== undefined && !SECRET_TYPES.includes(String(a.type))) return 'type: неизвестный тип записи'
      if (!isStr(a.title, 120) || !(a.title as string).trim()) return 'title: непустая строка до 120 символов'
      if (!Array.isArray(a.fields) || a.fields.length === 0 || a.fields.length > 12) return 'fields: от 1 до 12 полей'
      for (const f of a.fields as Record<string, unknown>[]) {
        if (!f || !isStr(f.name, 40) || !(f.name as string).trim()) return 'fields[].name: непустая строка'
        if (!isStr(f.value, 4000)) return 'fields[].value: строка до 4000 символов'
        if (f.secret !== undefined && typeof f.secret !== 'boolean') return 'fields[].secret: boolean'
      }
      if (!isTags(a.tags)) return 'tags: до 10 строк'
      if (a.approvalId !== undefined && !isStr(a.approvalId, 80)) return 'approvalId: строка'
      return null
    }
  }
}
