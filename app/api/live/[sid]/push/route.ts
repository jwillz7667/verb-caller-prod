import { NextRequest } from 'next/server'
import { createClient } from 'redis'
import { z } from 'zod'

export const runtime = 'nodejs'

// Validate SID format to prevent injection
const SidSchema = z.string().regex(/^[A-Za-z0-9_-]{10,100}$/)

// Validate transcript data
const TranscriptSchema = z.object({
  t: z.number().optional(),
  type: z.string().max(50),
  text: z.string().max(10000),
}).passthrough()

function getRedis() {
  const url = process.env.REDIS_URL || ''
  if (!url) throw new Error('REDIS_URL not set')
  const client = createClient({ url })
  return client
}

export async function POST(req: NextRequest, { params }: { params: { sid: string } }) {
  try {
    // Validate and sanitize SID
    const sidResult = SidSchema.safeParse(params.sid)
    if (!sidResult.success) {
      return Response.json({ error: 'Invalid session ID' }, { status: 400 })
    }
    const sid = sidResult.data
    // Parse and validate body
    const rawBody = await req.json().catch(() => null)
    if (!rawBody) return Response.json({ error: 'Invalid request body' }, { status: 400 })
    
    const bodyResult = TranscriptSchema.safeParse(rawBody)
    if (!bodyResult.success) {
      return Response.json({ error: 'Invalid transcript data' }, { status: 400 })
    }
    const body = bodyResult.data
    
    // Use safe key construction
    const key = `transcript:${sid}`
    const r = getRedis()
    await r.connect()
    // Limit data size and set appropriate TTL
    const data = JSON.stringify(body)
    if (data.length > 50000) {
      await r.quit()
      return Response.json({ error: 'Data too large' }, { status: 413 })
    }
    
    await r.rPush(key, data)
    await r.expire(key, 60 * 30) // 30 minutes TTL
    await r.quit()
    return Response.json({ ok: true })
  } catch (e: any) {
    // Don't expose internal errors
    console.error('[Push] Error:', e)
    return Response.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

