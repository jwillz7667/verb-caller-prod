import { NextRequest } from 'next/server'
import { createClient } from 'redis'

export const runtime = 'nodejs'

function getRedis() {
  const url = process.env.REDIS_URL || ''
  if (!url) throw new Error('REDIS_URL not set')
  const client = createClient({ url })
  return client
}

export async function POST(req: NextRequest, { params }: { params: { sid: string } }) {
  try {
    const sid = params.sid
    if (!sid) return Response.json({ error: 'Missing sid' }, { status: 400 })
    const body = await req.json().catch(() => null)
    if (!body) return Response.json({ error: 'Missing body' }, { status: 400 })
    const key = `transcript:${sid}`
    const r = getRedis()
    await r.connect()
    await r.rPush(key, JSON.stringify(body))
    await r.expire(key, 60 * 30)
    await r.quit()
    return Response.json({ ok: true })
  } catch (e: any) {
    const msg = e?.message || 'push error'
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}

