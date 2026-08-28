import { NextResponse } from 'next/server'
import { listMcp } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await listMcp())
}
