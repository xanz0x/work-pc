/* ============================================================
   /ai-api/analyze — ОЧЕРЕДЬ АНАЛИЗА ФАЙЛОВ (раздел 2, 2026-09-06)
   POST {objectId} — поставить объект в очередь анализа
   (повторный вызов — повторный анализ). GET ?objectId=… —
   статус. Очередь в памяти процесса: после перезапуска статусы
   читаются из метаданных объекта. Тяжёлая работа идёт в
   lib/file-analyzer.ts и не блокирует ответ.
   ============================================================ */

import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { cloudError } from '@/lib/cloud-route'
import { getAnalysisInput, setFileAnalysis } from '@/lib/cloud-store'
import { analyzeAndStore, type AnalyzeInput, type AnalysisRunStatus } from '@/lib/file-analyzer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JobState = {
  status: 'queued' | 'running' | AnalysisRunStatus
  startedAt: string
  finishedAt?: string
  error?: string
}

/** Очередь в памяти: objectId → состояние. Финальные статусы дублируются в метаданные. */
const jobs = new Map<string, JobState>()
const JOB_HISTORY_MAX = 500

function remember(objectId: string, state: JobState): void {
  jobs.set(objectId, state)
  if (jobs.size > JOB_HISTORY_MAX) {
    const oldest = jobs.keys().next().value
    if (oldest !== undefined) jobs.delete(oldest)
  }
}

/** Фоновая работа: любые ошибки оседают в статусе, не в исключениях. */
function enqueue(input: AnalyzeInput): void {
  const state: JobState = { status: 'queued', startedAt: new Date().toISOString() }
  remember(input.id, state)
  void (async () => {
    try {
      state.status = 'running'
      const result = await analyzeAndStore(input)
      state.status = result.status
      state.finishedAt = new Date().toISOString()
      state.error = result.error
    } catch (e) {
      state.status = 'failed'
      state.finishedAt = new Date().toISOString()
      state.error = e instanceof Error ? e.message : 'неизвестная ошибка анализа'
      try {
        await setFileAnalysis(input.id, {
          analysisStatus: 'failed',
          analyzedAt: new Date().toISOString(),
          analysisError: state.error,
        })
      } catch {
        /* объект мог быть удалён — статус останется только здесь */
      }
    }
  })()
}

/** POST {objectId} — поставить анализ в очередь. */
export const POST = withRoute('/ai-api/analyze', async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as { objectId?: unknown } | null
    const objectId = typeof body?.objectId === 'string' ? body.objectId.trim() : ''
    if (!objectId) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Не указан objectId.' }, { status: 400 })

    /* Заодно проверяем существование и доступ: NOT_FOUND/FORBIDDEN отдаём сразу. */
    const input = await getAnalysisInput(objectId)
    try {
      await setFileAnalysis(objectId, { analysisStatus: 'queued' })
    } catch {
      /* метаданные могли не записаться — анализ всё равно запускаем */
    }
    enqueue({ id: input.id, name: input.name, contentType: input.contentType, size: input.size })
    return NextResponse.json({ objectId, status: 'queued' }, { status: 202 })
  } catch (e) {
    return cloudError(e)
  }
})

/** GET ?objectId=… — статус анализа. */
export const GET = withRoute('/ai-api/analyze', async (req: NextRequest) => {
  try {
    const objectId = (req.nextUrl.searchParams.get('objectId') ?? '').trim()
    if (!objectId) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Не указан objectId.' }, { status: 400 })

    const job = jobs.get(objectId)
    if (job) {
      return NextResponse.json({
        objectId,
        status: job.status,
        ...(job.error ? { error: job.error } : {}),
        ...(job.finishedAt ? { finishedAt: job.finishedAt } : { startedAt: job.startedAt }),
      })
    }

    /* Нет в памяти (перезапуск сервера) — сохранённый результат из метаданных. */
    const meta = await getAnalysisInput(objectId)
    const a = meta.analysis
    return NextResponse.json({
      objectId,
      status: a?.analysisStatus ?? null,
      ...(a?.title ? { title: a.title } : {}),
      ...(a?.description ? { description: a.description } : {}),
      ...(a?.analysisTags ? { tags: a.analysisTags } : {}),
      ...(a?.analysisKind ? { kind: a.analysisKind } : {}),
      ...(a?.analyzedAt ? { analyzedAt: a.analyzedAt } : {}),
      ...(a?.analysisError ? { error: a.analysisError } : {}),
    })
  } catch (e) {
    return cloudError(e)
  }
})
