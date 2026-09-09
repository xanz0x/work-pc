/* ============================================================
   ПРИЁМ ФАЙЛОВ (главный сценарий продукта)
   Человек добавляет файл — и дальше всё делает программа:
     1. файл физически уезжает в выбранную папку хранения
        (POST /ai-api/cloud/upload → lib/cloud-store),
     2. ИИ-архивариус читает его и даёт название, описание и метки
        (POST /ai-api/analyze, затем опрос статуса),
     3. библиотека и карта обновляются событием `wsx:cloud-changed`.
   Ошибка одного файла не роняет остальные: у каждого свой статус.
   ============================================================ */

export type IntakeState = 'upload' | 'analyzing' | 'done' | 'partial' | 'failed'

export type IntakeTrack = {
  /** id объекта на общем диске (пусто, пока файл не загружен). */
  id: string
  /** Имя файла с диска. */
  name: string
  state: IntakeState
  /** Название от ИИ. */
  title?: string
  description?: string
  tags?: string[]
  error?: string
}

const POLL_MS = 1500
const POLL_ATTEMPTS = 80
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const notifyChanged = () => window.dispatchEvent(new Event('wsx:cloud-changed'))

type AnalyzeStatus = {
  status?: string
  title?: string
  description?: string
  tags?: string[]
  error?: string
}

async function uploadOne(file: File, dir: string): Promise<{ id: string; name: string }> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('dir', dir)
  const r = await fetch('/ai-api/cloud/upload', { method: 'POST', body: fd })
  const body = (await r.json().catch(() => ({}))) as { file?: { id: string; name: string }; error?: string }
  if (!r.ok || !body.file?.id) throw new Error(body.error ?? `Загрузка не удалась (${r.status})`)
  return body.file
}

async function analyzeOne(objectId: string): Promise<AnalyzeStatus> {
  const start = await fetch('/ai-api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectId }),
  })
  if (!start.ok) {
    const j = (await start.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? `Разбор не запустился (${start.status})`)
  }
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    await sleep(POLL_MS)
    const r = await fetch(`/ai-api/analyze?objectId=${encodeURIComponent(objectId)}`, { cache: 'no-store' })
    if (!r.ok) continue
    const s = (await r.json()) as AnalyzeStatus
    if (s.status === 'done' || s.status === 'partial' || s.status === 'failed') return s
  }
  throw new Error('Разбор длится дольше ожидаемого — статус появится в библиотеке сам')
}

/**
 * Полный приём списка файлов. `onProgress` вызывается на каждом изменении:
 * интерфейс рисует ровно то, что происходит, без выдуманных процентов.
 */
export async function intakeFiles(
  files: File[],
  onProgress: (tracks: IntakeTrack[]) => void,
  dir = '',
): Promise<IntakeTrack[]> {
  const tracks: IntakeTrack[] = files.map((f) => ({ id: '', name: f.name, state: 'upload' }))
  const push = () => onProgress(tracks.map((t) => ({ ...t })))
  push()

  for (let i = 0; i < files.length; i += 1) {
    try {
      const saved = await uploadOne(files[i], dir)
      tracks[i] = { ...tracks[i], id: saved.id, name: saved.name || files[i].name, state: 'analyzing' }
      push()
      notifyChanged()
      const s = await analyzeOne(saved.id)
      tracks[i] = {
        ...tracks[i],
        state: s.status === 'failed' ? 'failed' : s.status === 'partial' ? 'partial' : 'done',
        ...(s.title ? { title: s.title } : {}),
        ...(s.description ? { description: s.description } : {}),
        ...(s.tags ? { tags: s.tags } : {}),
        ...(s.error ? { error: s.error } : {}),
      }
    } catch (e) {
      tracks[i] = { ...tracks[i], state: 'failed', error: e instanceof Error ? e.message : 'Не удалось принять файл' }
    }
    push()
    notifyChanged()
  }
  return tracks.map((t) => ({ ...t }))
}
