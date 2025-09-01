import { NextRequest } from 'next/server'
import { z } from 'zod'
import { OutgoingCallSchema } from '@/lib/validation'
import { createEphemeralClientSecret } from '@/lib/openai'
import { getTwilioClient, getTwilioFromNumber } from '@/lib/twilio'
import { resolveBaseUrl } from '@/lib/utils'
import { allowClientCredsServer } from '@/lib/config'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = OutgoingCallSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const data = parsed.data

    const openaiKey = allowClientCredsServer() ? (data.openaiApiKey || process.env.OPENAI_API_KEY) : process.env.OPENAI_API_KEY
    if (!openaiKey) return Response.json({ error: 'OpenAI API key missing' }, { status: 400 })

    // Create ephemeral client secret
    const eph = await createEphemeralClientSecret(openaiKey, data.ephemeral)
    const secretVal = eph.client_secret.value

    // Create outbound call via Twilio
    const client = allowClientCredsServer()
      ? getTwilioClient({ sid: data.twilioAccountSid, token: data.twilioAuthToken })
      : getTwilioClient()
    const from = allowClientCredsServer() ? getTwilioFromNumber(data.twilioFromNumber) : getTwilioFromNumber()
    if (!from) return Response.json({ error: 'Twilio from number missing' }, { status: 400 })

    const base = resolveBaseUrl(req.url)
    const twimlUrl = `${base}/api/twiml?secret=${encodeURIComponent(secretVal)}&mode=sip&transport=tls`

    const callCreatePayload: any = {
      to: data.toNumber,
      from,
      url: twimlUrl,
      method: 'GET',
    }
    // Optional best-practice: status callbacks for call lifecycle
    const statusCb = process.env.TWILIO_STATUS_CALLBACK_URL
    if (statusCb) {
      callCreatePayload.statusCallback = statusCb
      callCreatePayload.statusCallbackMethod = process.env.TWILIO_STATUS_CALLBACK_METHOD || 'POST'
      callCreatePayload.statusCallbackEvent = (
        process.env.TWILIO_STATUS_CALLBACK_EVENTS || 'initiated,ringing,answered,completed'
      ).split(',').map((s) => s.trim()).filter(Boolean)
    }
    if (data.record) {
      callCreatePayload.record = true
      callCreatePayload.recordingChannels = 'dual'
      // Optionally: callCreatePayload.recordingTrack = 'both'
    } else {
      callCreatePayload.record = false
    }

    const call = await client.calls.create(callCreatePayload)

    return Response.json({ callSid: call.sid, client_secret: eph.client_secret, url: twimlUrl })
  } catch (err: any) {
    const status = err?.response?.status || 500
    const detail = err?.response?.data || { error: err?.message || 'Internal error' }
    console.error('POST /api/calls error', detail)
    return Response.json(detail, { status })
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
