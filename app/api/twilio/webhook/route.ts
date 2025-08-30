import { NextRequest } from 'next/server'
import { getTwilioClient, getTwilioFromNumber } from '@/lib/twilio'
import { resolveBaseUrl } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { secret?: string; phoneNumber?: string }
    const secret = body.secret
    if (!secret) return Response.json({ error: 'Missing secret' }, { status: 400 })
    const client = getTwilioClient()
    const base = resolveBaseUrl(req.url)
    const phone = body.phoneNumber || getTwilioFromNumber()
    if (!phone) return Response.json({ error: 'Server TWILIO_FROM_NUMBER not configured and no phoneNumber provided' }, { status: 400 })
    const twimlUrl = `${base}/api/twiml?secret=${encodeURIComponent(secret)}`

    const nums = await client.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 20 })
    if (!nums || nums.length === 0) return Response.json({ error: `Twilio number not found: ${phone}` }, { status: 404 })
    const target = nums[0]
    const updated = await client.incomingPhoneNumbers(target.sid).update({ voiceUrl: twimlUrl, voiceMethod: 'GET' })

    return Response.json({ ok: true, sid: updated.sid, phoneNumber: updated.phoneNumber, voiceUrl: updated.voiceUrl })
  } catch (e: any) {
    const status = e?.status || e?.response?.status || 500
    const detail = e?.response?.data || { error: e?.message || 'Internal error' }
    console.error('POST /api/twilio/webhook error', detail)
    return Response.json(detail, { status })
  }
}

