import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { adminOverview } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/admin/api/overview', async () => {
  requireUser()
  return NextResponse.json(await adminOverview())
})
