import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

function escapeXml(str: string): string {
  return str.replace(/[<>&"']/g, (c) => {
    const chars: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;'
    }
    return chars[c] || c
  })
}

export async function POST(req: NextRequest) {
  try {
    const u = new URL(req.url)
    const base = (process.env.PUBLIC_BASE_URL || `${u.protocol}//${u.host}`).replace(/\/$/, '')

    // Twilio posts Dial outcome fields in application/x-www-form-urlencoded
    const contentType = req.headers.get('content-type') || ''
    let dialCallStatus = ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const raw = await req.text()
      const usp = new URLSearchParams(raw)
      dialCallStatus = usp.get('DialCallStatus') || ''
    }

    // If the SIP call failed or no-answer, fallback to Media Streams
    if (['failed', 'no-answer', 'busy'].includes(dialCallStatus)) {
      const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      const streamUrl = `${wsBase}/api/stream/twilio`
      const statusCb = process.env.TWILIO_STREAM_STATUS_CALLBACK_URL
      const statusAttr = statusCb ? ` statusCallback="${escapeXml(statusCb)}" statusCallbackMethod="${process.env.TWILIO_STREAM_STATUS_CALLBACK_METHOD || 'POST'}" statusCallbackEvent="start media mark stop"` : ''
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="alice">Connecting to backup media stream.</Say>\n  <Start>\n    <Stream url="${escapeXml(streamUrl)}"${statusAttr} />\n  </Start>\n  <Pause length="60"/>\n</Response>`
      return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Otherwise end cleanly
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup/>\n</Response>`
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
  } catch (e: any) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup/>\n</Response>`
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
  }
}