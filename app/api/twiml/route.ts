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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Sip>sip:${secret}@${sipDomain}</Sip>\n  </Dial>\n</Response>`
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}
