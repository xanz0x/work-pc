import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { driveView } from '@/lib/cloud-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/cloud', async () => {
  return NextResponse.json(await driveView())
})
