import { NextRequest } from 'next/server'
import { getTwilioClient } from '@/lib/twilio'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const callSid = searchParams.get('callSid') || undefined
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
    console.error('GET /api/recordings error', err)
    return Response.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
