import { NextResponse } from 'next/server'
import { listMcp } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/mcp', async () => NextResponse.json(await listMcp()))
