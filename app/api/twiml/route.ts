import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { createEphemeralClientSecret } from '@/lib/openai'
import { getRealtimeControlSettings } from '@/lib/realtimeControl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Helper to escape XML special characters
const escapeXml = (str: string): string => {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  let secret = searchParams.get('secret') || ''
  const sipDomain = 'sip.openai.com'
  
  // Validate and sanitize scheme parameter
  const schemeParam = searchParams.get('scheme')?.toLowerCase()
  const scheme = (schemeParam === 'sips' || schemeParam === 'sip') ? schemeParam : 'sips'
  
  // Validate and sanitize transport parameter  
  const transportParam = searchParams.get('transport')?.toLowerCase()
  const transport = (transportParam === 'tls' || transportParam === 'tcp' || transportParam === 'udp') ? transportParam : 'tls'
  
  // Validate port parameter (must be valid port number)
  const portParam = searchParams.get('port')
  const portNum = portParam ? parseInt(portParam, 10) : 0
  const port = (portNum >= 1 && portNum <= 65535) ? portNum.toString() : ''
  
  // Validate mode parameter
  const modeParam = searchParams.get('mode')?.toLowerCase()
  const defaultMode = process.env.TWIML_DEFAULT_MODE?.toLowerCase()
  const mode = (modeParam === 'stream' || modeParam === 'sip' || modeParam === 'simple') ? modeParam : 
               (defaultMode === 'stream' || defaultMode === 'sip' || defaultMode === 'simple') ? defaultMode : 'sip'
  // If no secret is provided, mint one on the fly (automatic flow)
  if (!secret) {
    try {
      const openaiKey = process.env.OPENAI_API_KEY
      if (!openaiKey) {
        return new Response('<Response><Say>Server not configured.</Say></Response>', { status: 500, headers: { 'Content-Type': 'text/xml' } })
      }
      // Get custom settings from UI if available
      const customSettings = getRealtimeControlSettings()
      
      // Use custom settings if available, otherwise fall back to env/query params
      const model = (searchParams.get('model') || process.env.REALTIME_DEFAULT_MODEL || 'gpt-realtime')
      const promptId = searchParams.get('prompt_id') || undefined
      const promptVersion = searchParams.get('prompt_version') || undefined
      
      // Build session config from custom settings or defaults
      const instructionsParam = searchParams.get('instructions')
      const instructions = customSettings?.instructions || 
                          instructionsParam?.slice(0, 1000) || 
                          process.env.REALTIME_DEFAULT_INSTRUCTIONS || 
                          'You are a helpful assistant. Be concise and natural in your responses.'
      
      const expiresSeconds = parseInt(process.env.REALTIME_EXPIRES_SECONDS || '600', 10)
      const payload: any = {
        expires_after: { anchor: 'created_at', seconds: Number.isFinite(expiresSeconds) ? expiresSeconds : 600 },
        session: { 
          type: 'realtime', 
          model,
          // Essential for telephony - set modalities and audio formats
          modalities: ['audio', 'text'],  // Both audio and text for telephony
          input_audio_format: 'g711_ulaw',  // Twilio uses G.711 μ-law
          output_audio_format: 'g711_ulaw', // Match Twilio format
          // Apply custom settings if available
          ...(customSettings?.voice && { voice: customSettings.voice }),
          ...(customSettings?.temperature && { temperature: customSettings.temperature }),
          ...(customSettings?.max_response_output_tokens && { max_response_output_tokens: customSettings.max_response_output_tokens }),
          ...(customSettings?.turn_detection && { turn_detection: customSettings.turn_detection }),
          ...(customSettings?.tools && { tools: customSettings.tools }),
          ...(customSettings?.tool_choice && { tool_choice: customSettings.tool_choice }),
          ...(customSettings?.input_audio_transcription && { input_audio_transcription: customSettings.input_audio_transcription }),
        }
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
  
  // Simple mode - just play a message for now
  if (mode === 'simple') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! The AI voice system is currently being configured. WebSocket connections are not supported on Vercel. Please deploy the WebSocket endpoint to Railway or another platform that supports persistent connections.</Say>
</Response>`
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
  }
  
  if (mode === 'stream') {
    // Use external WebSocket URL if configured (e.g., Railway deployment)
    let streamUrl: string
    if (process.env.TWILIO_WEBSOCKET_URL) {
      // External WebSocket server (Railway, Render, etc.)
      // Railway strips query params, so we encode the secret in the path
      const wsBase = process.env.TWILIO_WEBSOCKET_URL.replace(/\/$/, '')
      streamUrl = `${wsBase}/${encodeURIComponent(secret)}`
    } else {
      // Fallback to local WebSocket (won't work on Vercel)
      const u = new URL(req.url)
      const base = (process.env.PUBLIC_BASE_URL || `${u.protocol}//${u.host}`).replace(/\/$/, '')
      const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      streamUrl = `${wsBase}/api/stream/twilio?secret=${encodeURIComponent(secret)}`
    }
    const statusCb = process.env.TWILIO_STREAM_STATUS_CALLBACK_URL
    const statusAttr = statusCb ? ` statusCallback=\"${escapeXml(statusCb)}\" statusCallbackMethod=\"${process.env.TWILIO_STREAM_STATUS_CALLBACK_METHOD || 'POST'}\" statusCallbackEvent=\"start media mark stop\"` : ''
    const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Start>\n    <Stream url=\"${escapeXml(streamUrl)}\"${statusAttr} />\n  </Start>\n  <Pause length=\"60\"/>\n</Response>`
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Compose target URI with proper escaping
  // OpenAI requires sip: with transport=tls, not sips:
  let sipUri: string
  if (transport === 'tls') {
    // Use sip: with transport=tls for OpenAI (port 5061 is default for TLS)
    sipUri = `sip:${secret}@${sipDomain}${port ? `:${port}` : ':5061'};transport=tls`
  } else {
    // Non-TLS transport
    sipUri = `sip:${secret}@${sipDomain}${port ? `:${port}` : ''};transport=${transport}`
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Sip>${escapeXml(sipUri)}</Sip>\n  </Dial>\n</Response>`
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
