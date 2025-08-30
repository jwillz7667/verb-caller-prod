import { NextRequest } from 'next/server'
import { getTwilioClient } from '@/lib/twilio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest, { params }: { params: { sid: string } }) {
  try {
    const client = getTwilioClient()
    const rec = await client.recordings(params.sid).fetch()
    // Twilio media URL (MP3)
    const url = `https://api.twilio.com${rec.uri.replace('.json', '.mp3')}`
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
    const twRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
    if (!twRes.ok) return new Response('Failed to fetch media', { status: 502 })
    const buf = await twRes.arrayBuffer()
    return new Response(buf, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=600' } })
  } catch (e: any) {
    console.error('GET /api/recordings/[sid]/audio error', e)
    return new Response('Error', { status: 500 })
  }
}
