import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { joinDrive } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRoute('/ai-api/cloud/join', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  try {
    await joinDrive(String(body.code ?? ''))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return cloudError(e)
  }
})
