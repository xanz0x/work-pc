import { promises as fs } from 'fs'
import path from 'path'

/**
 * Файловый слой AI-папки: скиллы, MCP-конфиги и сессии живут в репозитории
 * (каталог /ai) и редактируются через UI. Никакой базы — только диск.
 */

const ROOT = path.join(process.cwd(), 'ai')

export type SkillFile = {
  id: string
  name: string
  kind: 'tool' | 'prompt'
  tool?: string
  builtin: boolean
  enabled: boolean
  description: string
  instructions: string
}

export type McpFile = {
  id: string
  name: string
  transport: string
  host: string
  port: number
  token: string
  enabled: boolean
  tools: string[]
  note?: string
}

export type LlmToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type LlmMsg = {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: LlmToolCall[]
  tool_call_id?: string
}

export type SessionFile = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: string[]
  msgs: unknown[]
  llm: LlmMsg[]
}

const ID_RE = /^[a-zA-Z0-9._-]{1,80}$/

export function safeId(id: string): string {
  if (!ID_RE.test(id)) throw new Error('недопустимый идентификатор')
  return id
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(p: string, v: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8')
}

async function listJson<T>(dir: string): Promise<T[]> {
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: T[] = []
  for (const n of names) {
    const v = await readJson<T>(path.join(dir, n))
    if (v) out.push(v)
  }
  return out
}

/* ---------- скиллы ---------- */

export async function listSkills(): Promise<SkillFile[]> {
  const all = await listJson<SkillFile>(path.join(ROOT, 'skills'))
  return all.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name, 'ru'))
}

export async function getSkill(id: string): Promise<SkillFile | null> {
  return readJson<SkillFile>(path.join(ROOT, 'skills', `${safeId(id)}.json`))
}

export async function saveSkill(s: SkillFile): Promise<void> {
  await writeJson(path.join(ROOT, 'skills', `${safeId(s.id)}.json`), s)
}

export async function deleteSkill(id: string): Promise<void> {
  await fs.unlink(path.join(ROOT, 'skills', `${safeId(id)}.json`)).catch(() => {})
}

/* ---------- MCP ---------- */

export async function listMcp(): Promise<McpFile[]> {
  return listJson<McpFile>(path.join(ROOT, 'mcp'))
}

export async function getMcp(id: string): Promise<McpFile | null> {
  return readJson<McpFile>(path.join(ROOT, 'mcp', `${safeId(id)}.json`))
}

export async function saveMcp(m: McpFile): Promise<void> {
  await writeJson(path.join(ROOT, 'mcp', `${safeId(m.id)}.json`), m)
}

/* ---------- системный промпт ---------- */

export async function getSystemPrompt(): Promise<string> {
  try {
    return await fs.readFile(path.join(ROOT, 'system.md'), 'utf8')
  } catch {
    return 'Ты — ИИ-ассистент хранилища WorkfloW. Отвечай по-русски, кратко.'
  }
}

export async function saveSystemPrompt(text: string): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true })
  await fs.writeFile(path.join(ROOT, 'system.md'), text, 'utf8')
}

/* ---------- сессии ---------- */

export type SessionMeta = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  count: number
}

export async function listSessions(): Promise<SessionMeta[]> {
  const all = await listJson<SessionFile>(path.join(ROOT, 'sessions'))
  return all
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      count: Array.isArray(s.msgs) ? s.msgs.length : 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getSession(id: string): Promise<SessionFile | null> {
  return readJson<SessionFile>(path.join(ROOT, 'sessions', `${safeId(id)}.json`))
}

export async function saveSession(s: SessionFile): Promise<void> {
  await writeJson(path.join(ROOT, 'sessions', `${safeId(s.id)}.json`), s)
}

export async function deleteSession(id: string): Promise<void> {
  await fs.unlink(path.join(ROOT, 'sessions', `${safeId(id)}.json`)).catch(() => {})
}
