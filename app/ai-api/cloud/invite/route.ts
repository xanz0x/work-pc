import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { rotateInvite } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRoute('/ai-api/cloud/invite', async () => {
  try {
    return NextResponse.json({ inviteCode: await rotateInvite() })
  } catch (e) {
    return cloudError(e)
  }
})
