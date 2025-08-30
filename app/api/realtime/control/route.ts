import { NextRequest } from 'next/server'
import { buildServerUpdateFromEnv } from '@/lib/realtimeControl'
import { verifyHmacSignature } from '@/lib/webhooks'

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
  // Read raw body for signature verification
  const raw = await req.text()
  const body = raw ? JSON.parse(raw) : {}

  // AuthZ: Accept either Bearer shared secret or HMAC signature if configured
  const hasBearerOk = verifySecret(req)
  let hasHmacOk = true
  const signingSecret = process.env.REALTIME_CONTROL_SIGNING_SECRET
  if (signingSecret) {
    const sig = req.headers.get('x-openai-signature') || req.headers.get('x-openai-signature-256')
    const ts = req.headers.get('x-openai-signature-timestamp') || req.headers.get('x-openai-timestamp')
    const tol = parseInt(process.env.REALTIME_CONTROL_TOLERANCE_SECONDS || '300', 10)
    hasHmacOk = verifyHmacSignature({ rawBody: raw, signature: sig, secret: signingSecret, timestamp: ts, toleranceSeconds: Number.isFinite(tol) ? tol : 300 })
  }
  if (!hasBearerOk && !hasHmacOk) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
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
