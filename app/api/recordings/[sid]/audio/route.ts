import { NextRequest } from 'next/server'
import { getTwilioClient } from '@/lib/twilio'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Validate SID format to prevent injection
const SidSchema = z.string().regex(/^RE[a-f0-9]{32}$/i, 'Invalid recording SID format')

export async function GET(req: NextRequest, { params }: { params: { sid: string } }) {
  try {
    // Validate SID parameter
    const sidResult = SidSchema.safeParse(params.sid)
    if (!sidResult.success) {
      return new Response('Invalid recording ID', { status: 400 })
    }
    const sid = sidResult.data
    
    // TODO: Add authentication check here
    // For now, we'll add a simple token check as a placeholder
    // In production, implement proper session-based auth
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    
    // Basic auth check - replace with proper authentication
    if (process.env.NODE_ENV === 'production' && !token) {
      return new Response('Unauthorized', { status: 401 })
    }
    
    const client = getTwilioClient()
    const rec = await client.recordings(sid).fetch()
    // Twilio media URL (MP3)
    const url = `https://api.twilio.com${rec.uri.replace('.json', '.mp3')}`
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
    const twRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
    if (!twRes.ok) return new Response('Failed to fetch media', { status: 502 })
    const buf = await twRes.arrayBuffer()
    return new Response(buf, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=600' } })
  } catch (e: any) {
    // Don't log sensitive error details in production
    if (process.env.NODE_ENV !== 'production') {
      console.error('GET /api/recordings/[sid]/audio error', e)
    }
    // Generic error message to avoid information disclosure
    return new Response('Unable to fetch recording', { status: 500 })
  }
}
