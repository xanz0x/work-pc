import { NextResponse } from 'next/server'
import { CloudError } from '@/lib/cloud-store'

const STATUS: Record<string, number> = { NO_KEY: 503, PROVIDER: 503, NOT_FOUND: 404, INVALID_ARGS: 400, FORBIDDEN: 403 }

export function cloudError(e: unknown): NextResponse {
  if (!(e instanceof CloudError)) throw e
  return NextResponse.json({ code: e.code, error: e.message }, { status: STATUS[e.code] ?? 503 })
}
