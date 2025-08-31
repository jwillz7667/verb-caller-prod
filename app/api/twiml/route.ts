import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { createEphemeralClientSecret } from '@/lib/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  let secret = searchParams.get('secret') || ''
  const sipDomain = 'sip.openai.com'
  // Allow toggling scheme/transport/port for interoperability testing
  const scheme = (searchParams.get('scheme') || 'sip').toLowerCase() // 'sip' | 'sips'
  const transport = (searchParams.get('transport') || 'tls').toLowerCase() // 'tls' | 'tcp' | 'udp'
  const portParam = searchParams.get('port')
  const port = portParam && /^[0-9]{2,5}$/.test(portParam) ? portParam : ''
  const mode = (searchParams.get('mode') || process.env.TWIML_DEFAULT_MODE || 'sip').toLowerCase() // 'sip' | 'stream'
  // If no secret is provided, mint one on the fly (automatic flow)
  if (!secret) {
    try {
      const openaiKey = process.env.OPENAI_API_KEY
      if (!openaiKey) {
        return new Response('<Response><Say>Server not configured.</Say></Response>', { status: 500, headers: { 'Content-Type': 'text/xml' } })
      }
      const model = (searchParams.get('model') || process.env.REALTIME_DEFAULT_MODEL || 'gpt-realtime')
      const promptId = searchParams.get('prompt_id') || undefined
      const promptVersion = searchParams.get('prompt_version') || undefined
      const instructions = searchParams.get('instructions') || process.env.REALTIME_DEFAULT_INSTRUCTIONS || undefined
      const expiresSeconds = parseInt(process.env.REALTIME_EXPIRES_SECONDS || '600', 10)
      const payload: any = {
        expires_after: { anchor: 'created_at', seconds: Number.isFinite(expiresSeconds) ? expiresSeconds : 600 },
        session: { type: 'realtime', model }
      }
      if (instructions && instructions.trim().length > 0) payload.session.instructions = instructions
      if (promptId) payload.session.prompt = { id: promptId, ...(promptVersion ? { version: promptVersion } : {}) }
      const token = await createEphemeralClientSecret(openaiKey, payload)
      secret = token?.client_secret?.value || ''
      if (!secret) {
        return new Response('<Response><Say>Failed to create token.</Say></Response>', { status: 502, headers: { 'Content-Type': 'text/xml' } })
      }
    } catch (e: any) {
      console.error('TwiML mint secret error', e?.response?.data || e)
      return new Response('<Response><Say>Error creating session.</Say></Response>', { status: 502, headers: { 'Content-Type': 'text/xml' } })
    }
  }
  // Optional: verify Twilio signature in production
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const signature = req.headers.get('x-twilio-signature') || undefined
  if (authToken && signature) {
    let params: Record<string, string> = {}
    // For GET validation, pass an empty params object and include the full URL with query
    // For POST validation, pass the form-encoded params
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const raw = await req.text()
        const usp = new URLSearchParams(raw)
        usp.forEach((v, k) => { params[k] = v })
      } else if (contentType.includes('multipart/form-data')) {
        // Best-effort: NextRequest.formData() may be used, but Twilio signatures exclude file contents
        const fd = await req.formData()
        for (const [k, v] of fd.entries()) {
          if (typeof v === 'string') params[k] = v
        }
      } else {
        params = {}
      }
    }
    const valid = twilio.validateRequest(authToken, signature, req.url, params)
    if (!valid) {
      return new Response('<Response><Say>Forbidden</Say></Response>', { status: 403, headers: { 'Content-Type': 'text/xml' } })
    }
  }
  if (mode === 'stream') {
    const u = new URL(req.url)
    const base = (process.env.PUBLIC_BASE_URL || `${u.protocol}//${u.host}`).replace(/\/$/, '')
    const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    const streamUrl = `${wsBase}/api/stream/twilio`
    const statusCb = process.env.TWILIO_STREAM_STATUS_CALLBACK_URL
    const statusAttr = statusCb ? ` statusCallback=\"${statusCb}\" statusCallbackMethod=\"${process.env.TWILIO_STREAM_STATUS_CALLBACK_METHOD || 'POST'}\" statusCallbackEvent=\"start media mark stop\"` : ''
    const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Start>\n    <Stream url=\"${streamUrl}\"${statusAttr} />\n  </Start>\n  <Pause length=\"60\"/>\n</Response>`
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Compose target URI
  let sipUri: string
  if (scheme === 'sips') {
    // TLS implied; Twilio defaults to 5061 if port omitted
    sipUri = `sips:${secret}@${sipDomain}${port ? `:${port}` : ''}`
  } else {
    // Default to SIP over TLS via transport param
    sipUri = `sip:${secret}@${sipDomain}${port ? `:${port}` : ''};transport=${transport}`
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Sip>${sipUri}</Sip>\n  </Dial>\n</Response>`
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
