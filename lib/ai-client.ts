import type { ChatMsg } from '@/components/chat/types'

/** Клиент AI-папки: всё, что лежит файлами в /ai, редактируется этими ручками. */

export type SessionMetaDto = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  count: number
}

export type SessionDto = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: string[]
  msgs: ChatMsg[]
}

export type SkillDto = {
  id: string
  name: string
  kind: 'tool' | 'prompt'
  tool?: string
  builtin: boolean
  enabled: boolean
  description: string
  instructions: string
}

export type McpDto = {
  id: string
  name: string
  transport: string
  host: string
  port: number
  /** Токен наружу не отдаётся: известно только, задан он в окружении или нет. */
  tokenSet: boolean
  enabled: boolean
  tools: string[]
  note?: string
}

const J = { 'Content-Type': 'application/json' }

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`сервер ответил ${r.status}`)
  return r.json() as Promise<T>
}

async function jsend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: J,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`сервер ответил ${r.status}`)
  return r.json() as Promise<T>
}

export const aiApi = {
  sessions: () => jget<SessionMetaDto[]>('/ai-api/sessions'),
  session: (id: string) => jget<SessionDto>(`/ai-api/sessions/${id}`),
  createSession: (id: string, title: string) =>
    jsend<SessionDto>('/ai-api/sessions', 'POST', { id, title }).catch(() => null),
  patchSession: (
    id: string,
    patch: { title?: string; msgs?: ChatMsg[]; pinned?: string[]; createdAt?: number },
  ) => jsend<{ ok: boolean }>(`/ai-api/sessions/${id}`, 'PATCH', patch).catch(() => null),
  deleteSession: (id: string) =>
    fetch(`/ai-api/sessions/${id}`, { method: 'DELETE' }).catch(() => null),

  skills: () => jget<SkillDto[]>('/ai-api/skills'),
  addSkill: (b: { name: string; description?: string; instructions: string }) =>
    jsend<SkillDto>('/ai-api/skills', 'POST', b),
  putSkill: (
    id: string,
    b: Partial<Pick<SkillDto, 'name' | 'description' | 'instructions' | 'enabled'>>,
  ) => jsend<SkillDto>(`/ai-api/skills/${id}`, 'PUT', b),
  delSkill: (id: string) => fetch(`/ai-api/skills/${id}`, { method: 'DELETE' }),

  mcp: () => jget<McpDto[]>('/ai-api/mcp'),
  putMcp: (id: string, b: Partial<Pick<McpDto, 'host' | 'port' | 'enabled'>>) =>
    jsend<McpDto>(`/ai-api/mcp/${id}`, 'PUT', b),
  mcpAction: (id: string, b: { action: 'test' | 'pull'; query?: string }) =>
    jsend<Record<string, unknown>>(`/ai-api/mcp/${id}`, 'POST', b),

  systemPrompt: () => jget<{ text: string }>('/ai-api/system'),
  saveSystemPrompt: (text: string) => jsend<{ ok: boolean }>('/ai-api/system', 'PUT', { text }),

  /** Состояние входа: нужно, чтобы честно показать «Войти» до первого хода. */
  authSession: () =>
    jget<{ authed: boolean; configured: boolean }>('/ai-api/auth/session').catch(() => ({
      authed: false,
      configured: true,
    })),
  logout: () => fetch('/ai-api/auth/session', { method: 'DELETE' }).catch(() => null),
}
