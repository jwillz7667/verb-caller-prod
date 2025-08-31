export const runtime = 'edge'
import { buildServerUpdateFromEnv } from '@/lib/realtimeControl'
import { publishTranscript } from '@/lib/live'

// Basic u-law (G.711) <-> PCM16 conversions
function muLawDecode(u8: Uint8Array): Int16Array {
  const out = new Int16Array(u8.length)
  for (let i = 0; i < u8.length; i++) {
    const u = u8[i]
    let x = ~u
    let sign = (x & 0x80) ? -1 : 1
    let exponent = (x >> 4) & 0x07
    let mantissa = x & 0x0f
    let magnitude = ((mantissa << 4) + 0x08) << (exponent + 2)
    out[i] = (sign * magnitude) as number
  }
  return out
}

function muLawEncode(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i]
    let sign = (sample >> 8) & 0x80
    if (sign !== 0) sample = -sample
    if (sample > 32635) sample = 32635
    sample = sample + 132
    let exponent = 7
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    let mantissa = (sample >> (exponent + 3)) & 0x0f
    let mu = ~(sign | (exponent << 4) | mantissa)
    out[i] = mu & 0xff
  }
  return out
}

// Naive linear resampler PCM16 from srcRate to dstRate
function resamplePCM16(pcm: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return pcm
  const ratio = dstRate / srcRate
  const outLen = Math.floor(pcm.length * ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = i / ratio
    const idx0 = Math.floor(idx)
    const idx1 = Math.min(idx0 + 1, pcm.length - 1)
    const frac = idx - idx0
    out[i] = (pcm[idx0] * (1 - frac) + pcm[idx1] * frac) | 0
  }
  return out
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function uint8ToBase64(arr: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin)
}

function int16ToUint8LE(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true)
  return out
}

function uint8ToInt16LE(u8: Uint8Array): Int16Array {
  const out = new Int16Array(u8.length / 2)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

export async function GET(request: Request) {
  // Upgrade incoming request to a WebSocket (Twilio Media Streams client)
  const upgrade = (request.headers.get('upgrade') || '').toLowerCase()
  const hasWsKey = !!request.headers.get('sec-websocket-key')
  if (!(upgrade === 'websocket' || hasWsKey)) {
    // Be explicit for non-upgrade hits (browsers/health checks)
    return new Response('Expected WebSocket upgrade', {
      status: 426,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
      },
    })
  }
  // @ts-ignore - WebSocketPair exists in Edge runtime
  const pair = new WebSocketPair()
  const twilioWS = pair[1] as unknown as WebSocket
  const clientWS = pair[0] as unknown as WebSocket
  
  let streamSid = ''
  let oaiWS: WebSocket | null = null
  let oaiReady = false
  let closing = false
  let pendingPcm: Int16Array[] = []
  let vadEnabled = true
  let callSid = ''
  let lastAssistantItem: string | null = null
  let responseStartTimestamp: number | null = null
  let latestMediaTimestamp: number | null = null

  function log(obj: any) {
    try { console.log('[stream]', JSON.stringify(obj)) } catch {}
    try { broadcastLog(obj) } catch {}
  }

  async function ensureOpenAI(model: string, instructions?: string, prompt?: { id: string; version?: string }) {
    if (oaiWS) return
    // Mint ephemeral secret (no custom headers available in Edge WebSocket)
    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) throw new Error('OPENAI_API_KEY missing')
    const payload: any = {
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: { type: 'realtime', model }
    }
    if (instructions) payload.session.instructions = instructions
    if (prompt) payload.session.prompt = prompt
    const token = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify(payload)
    }).then(async (r) => {
      if (!r.ok) throw new Error(`OpenAI token error ${r.status}`)
      const j = await r.json()
      const v = j?.client_secret?.value || j?.client_secret || j?.value
      if (!v) throw new Error('No client_secret value')
      return v as string
    })
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
    // Connect using recommended subprotocols: 'realtime' + ephemeral client secret
    const org = process.env.OPENAI_ORG_ID
    const project = process.env.OPENAI_PROJECT_ID
    const protocols = [
      'realtime',
      `openai-insecure-api-key.${token}`,
      ...(org ? [`openai-organization.${org}`] : []),
      ...(project ? [`openai-project.${project}`] : []),
    ]
    oaiWS = new WebSocket(url, protocols)
    oaiWS.addEventListener('open', () => {
      log({ at: 'oai.open', model, callSid, streamSid })
      oaiReady = true
      // Configure session for audio using env-driven best practices
      const update = buildServerUpdateFromEnv()
      // Force g711_ulaw passthrough for Twilio compatibility
      try {
        ;(update as any).session = {
          ...(update as any).session,
          modalities: ['audio', 'text'],
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
        }
      } catch {}
      try { oaiWS!.send(JSON.stringify(update)) } catch {}
      try {
        const t = (update as any)?.session?.turn_detection?.type
        vadEnabled = t !== 'none'
      } catch {}
      // No PCM buffering in passthrough mode
    })
    oaiWS.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data as string)
        handleOAIMessage(msg)
      } catch {
        // Some events may be binary for audio; handle below if needed
      }
    })
    oaiWS.addEventListener('error', (e) => {
      log({ at: 'oai.error', msg: String((e as any)?.message || e) })
      safeClose()
    })
    oaiWS.addEventListener('close', () => {
      oaiReady = false
      log({ at: 'oai.close', callSid, streamSid })
      if (!closing) safeClose()
    })
  }

  function concatInt16(chunks: Int16Array[]): Int16Array {
    let len = 0
    for (const c of chunks) len += c.length
    const out = new Int16Array(len)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
  }

  function sendPcmToOpenAI(pcm24k: Int16Array) {
    if (!oaiWS || !oaiReady) { pendingPcm.push(pcm24k); return }
    const u8 = int16ToUint8LE(pcm24k)
    const b64 = uint8ToBase64(u8)
    const append = { type: 'input_audio_buffer.append', audio: b64 }
    try { oaiWS.send(JSON.stringify(append)) } catch {}
  }

  function sendBase64ToOpenAI(b64: string) {
    if (!oaiWS || !oaiReady) return
    const append = { type: 'input_audio_buffer.append', audio: b64 }
    try { oaiWS.send(JSON.stringify(append)) } catch {}
  }

  let playbackQueue: Uint8Array[] = []
  let playbackTimer: number | null = null
  function clearPlaybackQueue() {
    playbackQueue = []
    if (playbackTimer != null) {
      // @ts-ignore Edge runtime timers
      clearTimeout(playbackTimer)
      playbackTimer = null
    }
  }
  function enqueuePlayback(pcm24: Int16Array) {
    // Resample 24k -> 8k and mu-law encode
    const pcm8 = resamplePCM16(pcm24, 24000, 8000)
    const ulaw = muLawEncode(pcm8)
    // Twilio expects 20ms frames: 160 samples @8kHz
    const frameBytes = 160 // samples
    for (let i = 0; i < ulaw.length; i += frameBytes) {
      playbackQueue.push(ulaw.slice(i, Math.min(i + frameBytes, ulaw.length)))
    }
    schedulePlayback()
  }
  function schedulePlayback() {
    if (playbackTimer != null) return
    const sendNext = () => {
      if (playbackQueue.length === 0) { playbackTimer = null; return }
      const chunk = playbackQueue.shift()!
      const payload = uint8ToBase64(chunk)
      const msg = { event: 'media', streamSid, media: { payload } }
      try { twilioWS.send(JSON.stringify(msg)) } catch {}
      // 20ms pacing
      // @ts-ignore Edge runtime timers
      playbackTimer = setTimeout(sendNext, 20) as unknown as number
    }
    // @ts-ignore Edge runtime timers
    playbackTimer = setTimeout(sendNext, 0) as unknown as number
  }

  async function handleOAIMessage(msg: any) {
    // Handle audio deltas from OpenAI; event names may vary by model version
    // Try response.output_audio.delta first, then response.audio.delta
    if (msg.type === 'response.audio.delta' && msg.delta) {
      // Forward g711 μ-law audio back to Twilio as-is
      const payload = msg.delta as string
      if (responseStartTimestamp == null && latestMediaTimestamp != null) {
        responseStartTimestamp = latestMediaTimestamp
      }
      if (typeof msg.item_id === 'string') {
        lastAssistantItem = msg.item_id
      }
      const out = { event: 'media', streamSid, media: { payload } }
      try { twilioWS.send(JSON.stringify(out)) } catch {}
      try { twilioWS.send(JSON.stringify({ event: 'mark', streamSid })) } catch {}
    } else if (msg.type === 'response.audio_transcript.delta' && typeof msg.delta === 'string') {
      const text = msg.delta as string
      const key = callSid || streamSid
      try { await publishTranscript(key, { t: Date.now(), type: 'audio_transcript.delta', text }) } catch {}
    } else if (msg.type === 'response.text.delta' && typeof msg.delta === 'string') {
      const text = msg.delta as string
      const key = callSid || streamSid
      try { await publishTranscript(key, { t: Date.now(), type: 'text.delta', text }) } catch {}
    } else if (msg.type === 'input_audio_buffer.speech_started') {
      // Barge-in: clear Twilio playback and truncate any in-flight assistant audio
      clearPlaybackQueue()
      try { twilioWS.send(JSON.stringify({ event: 'clear', streamSid })) } catch {}
      if (lastAssistantItem && responseStartTimestamp != null && latestMediaTimestamp != null) {
        const audio_end_ms = Math.max(0, latestMediaTimestamp - responseStartTimestamp)
        try {
          oaiWS?.send(JSON.stringify({
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms,
          }))
        } catch {}
      }
      lastAssistantItem = null
      responseStartTimestamp = null
    }
  }

  function safeClose() {
    closing = true
    try { twilioWS.close() } catch {}
    try { oaiWS?.close() } catch {}
  }

  // @ts-ignore accept() is available in Next.js Edge WS
  ;(twilioWS as any).accept?.()
  twilioWS.addEventListener('message', async (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)
      if (data.event === 'start') {
        streamSid = data.start.streamSid
        callSid = data.start.callSid || ''
        log({ at: 'twilio.start', streamSid, callSid })
        const model = (process.env.REALTIME_DEFAULT_MODEL || 'gpt-realtime')
        const instructions = process.env.REALTIME_DEFAULT_INSTRUCTIONS || undefined
        const promptId = process.env.REALTIME_DEFAULT_PROMPT_ID || undefined
        const promptVersion = process.env.REALTIME_DEFAULT_PROMPT_VERSION || undefined
        await ensureOpenAI(model, instructions, promptId ? { id: promptId, version: promptVersion } : undefined)
        // If VAD is disabled, proactively clear buffer for a fresh turn as per docs
        if (oaiWS && oaiReady && !vadEnabled) {
          try { oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.clear' })) } catch {}
        }
      } else if (data.event === 'media') {
        // Incoming μ-law 8k base64 audio from Twilio; forward to OpenAI
        const b64 = data.media.payload as string
        latestMediaTimestamp = (data?.media?.timestamp as number) ?? latestMediaTimestamp
        // Barge-in: If TTS is playing, cancel current response and clear buffer
        if (oaiWS && oaiReady) {
          try { oaiWS.send(JSON.stringify({ type: 'response.cancel' })) } catch {}
        }
        clearPlaybackQueue()
        sendBase64ToOpenAI(b64)
        if ((latestMediaTimestamp || 0) % 1000 < 20) {
          log({ at: 'twilio.media.tick', ts: latestMediaTimestamp })
        }
      } else if (data.event === 'mark' && data.mark?.name === 'commit') {
        if (oaiWS && oaiReady) {
          try { oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.commit' })) } catch {}
          try { oaiWS.send(JSON.stringify({ type: 'response.create' })) } catch {}
        }
        log({ at: 'twilio.mark.commit', streamSid })
      } else if (data.event === 'stop') {
        log({ at: 'twilio.stop', streamSid })
        safeClose()
      }
    } catch (e) {
      log({ at: 'twilio.msg.error', err: String((e as any)?.message || e) })
    }
  })
  twilioWS.addEventListener('close', () => { safeClose() })
  twilioWS.addEventListener('error', () => { safeClose() })

  // Return the accept response for the WebSocket
  // Echo back Sec-WebSocket-Protocol if provided (Twilio uses 'audio') to satisfy subprotocol negotiation
  const reqProto = request.headers.get('sec-websocket-protocol') || ''
  const chosenProto = reqProto.split(',').map((s) => s.trim()).filter(Boolean)[0]
  const headers = new Headers()
  if (chosenProto) headers.set('Sec-WebSocket-Protocol', chosenProto)
  // @ts-ignore - Edge web standard response
  return new Response(null, { status: 101, webSocket: clientWS, headers })
}

// Simple in-memory log fanout for debug clients
const logSockets: Set<WebSocket> = (globalThis as any).__logSockets || new Set()
;(globalThis as any).__logSockets = logSockets
function broadcastLog(obj: any) {
  const s = JSON.stringify(obj)
  for (const ws of Array.from(logSockets)) {
    try { (ws as any).send?.(s) } catch { try { logSockets.delete(ws) } catch {} }
  }
}
