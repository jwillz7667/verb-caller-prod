import { NextRequest } from 'next/server'
import { buildServerUpdateFromEnv } from '@/lib/realtimeControl'

export const runtime = 'nodejs'

function verifySecret(req: NextRequest) {
  const expected = process.env.REALTIME_CONTROL_SECRET
  if (!expected) return true // allow if not configured
  const auth = req.headers.get('authorization') || ''
  const hSecret = req.headers.get('x-webhook-secret') || ''
  if (auth.startsWith('Bearer ') && auth.slice(7) === expected) return true
  if (hSecret && hSecret === expected) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({}))
    // Log the incoming event minimally
    console.log('Realtime control webhook event:', body?.type || body?.event?.type || 'unknown')

    // Build a session.update from env defaults and return as events[]
    const update = buildServerUpdateFromEnv()
    return Response.json({ events: [update] })
  } catch (e: any) {
    console.error('POST /api/realtime/control error', e)
    return Response.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  // Simple status endpoint
  const update = buildServerUpdateFromEnv()
  return Response.json({ ok: true, update })
}

