import { NextRequest } from 'next/server'
import { getTwilioClient } from '@/lib/twilio'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Validate call SID format
const CallSidSchema = z.string().regex(/^CA[a-f0-9]{32}$/i).optional()

export async function GET(req: NextRequest) {
  try {
    // TODO: Add proper authentication here
    // For production, implement session-based auth or API key validation
    const authHeader = req.headers.get('authorization')
    if (process.env.NODE_ENV === 'production' && !authHeader) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }
    
    const { searchParams } = new URL(req.url)
    const callSidParam = searchParams.get('callSid') || undefined
    
    // Validate callSid parameter
    const callSidResult = CallSidSchema.safeParse(callSidParam)
    if (!callSidResult.success && callSidParam !== undefined) {
      return Response.json({ error: 'Invalid call SID format' }, { status: 400 })
    }
    const callSid = callSidResult.data
    const client = getTwilioClient()
    if (callSid) {
      const recs = await client.recordings.list({ callSid, limit: 20 })
      const withUrls = recs.map((r) => ({
        sid: r.sid,
        callSid: r.callSid,
        dateCreated: r.dateCreated,
        duration: r.duration,
        mediaUrl: `/api/recordings/${r.sid}/audio`
      }))
      return Response.json(withUrls)
    }
    const recs = await client.recordings.list({ limit: 50 })
    const withUrls = recs.map((r) => ({
      sid: r.sid,
      callSid: r.callSid,
      dateCreated: r.dateCreated,
      duration: r.duration,
      mediaUrl: `/api/recordings/${r.sid}/audio`
    }))
    return Response.json(withUrls)
  } catch (err: any) {
    // Don't expose internal errors in production
    if (process.env.NODE_ENV !== 'production') {
      console.error('GET /api/recordings error', err)
      return Response.json({ error: err?.message || 'Internal error' }, { status: 500 })
    }
    return Response.json({ error: 'Unable to fetch recordings' }, { status: 500 })
  }
}
