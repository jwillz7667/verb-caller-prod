import { NextRequest } from 'next/server'
import { z } from 'zod'
import { OutgoingCallSchema } from '@/lib/validation'
import { createEphemeralClientSecret } from '@/lib/openai'
import { getTwilioClient, getTwilioFromNumber } from '@/lib/twilio'
import { resolveBaseUrl } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = OutgoingCallSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const data = parsed.data

    const openaiKey = data.openaiApiKey || process.env.OPENAI_API_KEY
    if (!openaiKey) return Response.json({ error: 'OpenAI API key missing' }, { status: 400 })

    // Create ephemeral client secret
    const eph = await createEphemeralClientSecret(openaiKey, data.ephemeral)
    const secretVal = eph.client_secret.value

    // Create outbound call via Twilio
    const client = getTwilioClient({ sid: data.twilioAccountSid, token: data.twilioAuthToken })
    const from = getTwilioFromNumber(data.twilioFromNumber)
    if (!from) return Response.json({ error: 'Twilio from number missing' }, { status: 400 })

    const base = resolveBaseUrl(req.url)
    const twimlUrl = `${base}/api/twiml?secret=${encodeURIComponent(secretVal)}`

    const callCreatePayload: any = {
      to: data.toNumber,
      from,
      url: twimlUrl,
    }
    if (data.record) {
      callCreatePayload.record = 'record-from-ringing'
      callCreatePayload.recordingChannels = 'dual'
    }

    const call = await client.calls.create(callCreatePayload)

    return Response.json({ callSid: call.sid, client_secret: eph.client_secret, url: twimlUrl })
  } catch (err: any) {
    console.error('POST /api/calls error', err)
    return Response.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sid = searchParams.get('sid') || undefined
    const twilioSid = process.env.TWILIO_ACCOUNT_SID
    const twilioToken = process.env.TWILIO_AUTH_TOKEN
    const client = getTwilioClient({ sid: twilioSid, token: twilioToken })
    if (sid) {
      const call = await client.calls(sid).fetch()
      return Response.json(call)
    }
    const list = await client.calls.list({ limit: 50 })
    return Response.json(list)
  } catch (err: any) {
    console.error('GET /api/calls error', err)
    return Response.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
