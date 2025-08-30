import { NextRequest } from 'next/server'
import twilio from 'twilio'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  const sipDomain = 'sip.openai.com'
  if (!secret) {
    return new Response('<Response><Say>Missing secret.</Say></Response>', {
      status: 400,
      headers: { 'Content-Type': 'text/xml' }
    })
  }
  // Optional: verify Twilio signature in production
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const signature = req.headers.get('x-twilio-signature') || undefined
  if (authToken && signature) {
    const params: Record<string, string> = {}
    for (const [k, v] of searchParams.entries()) params[k] = v
    const valid = twilio.validateRequest(authToken, signature, req.url, params)
    if (!valid) {
      return new Response('<Response><Say>Forbidden</Say></Response>', { status: 403, headers: { 'Content-Type': 'text/xml' } })
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Sip>sip:${secret}@${sipDomain}</Sip>\n  </Dial>\n</Response>`
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}
