export const runtime = 'edge'
import { buildServerUpdateFromEnv } from '@/lib/realtimeControl'
import { publishTranscript } from '@/lib/live'

// Constants for best practices
const TWILIO_FRAME_SIZE = 160 // 20ms of 8kHz audio
const FRAME_DURATION_MS = 20
const MAX_PENDING_FRAMES = 100 // Prevent memory bloat
const CONNECTION_TIMEOUT_MS = 30000
const HEARTBEAT_INTERVAL_MS = 10000

// Audio conversion utilities with optimized algorithms
class AudioConverter {
  private static readonly MU_LAW_BIAS = 132
  private static readonly MU_LAW_MAX = 32635
  
  static muLawDecode(u8: Uint8Array): Int16Array {
    const out = new Int16Array(u8.length)
    for (let i = 0; i < u8.length; i++) {
      const u = u8[i]
      const inv = ~u
      const sign = (inv & 0x80) ? -1 : 1
      const exponent = (inv >> 4) & 0x07
      const mantissa = inv & 0x0f
      const magnitude = ((mantissa << 4) + 0x08) << (exponent + 2)
      out[i] = sign * magnitude
    }
    return out
  }

  static muLawEncode(pcm: Int16Array): Uint8Array {
    const out = new Uint8Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) {
      let sample = pcm[i]
      const sign = (sample >> 8) & 0x80
      if (sign !== 0) sample = -sample
      sample = Math.min(sample, this.MU_LAW_MAX)
      sample += this.MU_LAW_BIAS
      
      let exponent = 7
      for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
      
      const mantissa = (sample >> (exponent + 3)) & 0x0f
      const mu = ~(sign | (exponent << 4) | mantissa)
      out[i] = mu & 0xff
    }
    return out
  }

  // High-quality linear interpolation resampler
  static resamplePCM16(pcm: Int16Array, srcRate: number, dstRate: number): Int16Array {
    if (srcRate === dstRate) return pcm
    
    const ratio = dstRate / srcRate
    const outLen = Math.floor(pcm.length * ratio)
    const out = new Int16Array(outLen)
    
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio
      const idx0 = Math.floor(srcIdx)
      const idx1 = Math.min(idx0 + 1, pcm.length - 1)
      const fraction = srcIdx - idx0
      
      // Linear interpolation
      out[i] = Math.round(pcm[idx0] * (1 - fraction) + pcm[idx1] * fraction)
    }
    
    return out
  }

  static base64ToUint8(b64: string): Uint8Array {
    const binString = atob(b64)
    const len = binString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binString.charCodeAt(i)
    }
    return bytes
  }

  static uint8ToBase64(arr: Uint8Array): string {
    const binString = Array.from(arr, byte => String.fromCharCode(byte)).join('')
    return btoa(binString)
  }

  static int16ToUint8LE(pcm: Int16Array): Uint8Array {
    const buffer = new ArrayBuffer(pcm.length * 2)
    const view = new DataView(buffer)
    for (let i = 0; i < pcm.length; i++) {
      view.setInt16(i * 2, pcm[i], true) // little-endian
    }
    return new Uint8Array(buffer)
  }

  static uint8ToInt16LE(u8: Uint8Array): Int16Array {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const out = new Int16Array(u8.length / 2)
    for (let i = 0; i < out.length; i++) {
      out[i] = view.getInt16(i * 2, true) // little-endian
    }
    return out
  }
}

// Frame buffer for smooth audio playback
class AudioFrameBuffer {
  private queue: Uint8Array[] = []
  private timer: number | null = null
  private sendFn: (data: Uint8Array) => void
  
  constructor(sendFn: (data: Uint8Array) => void) {
    this.sendFn = sendFn
  }

  enqueue(data: Uint8Array): void {
    // Prevent unbounded growth
    if (this.queue.length >= MAX_PENDING_FRAMES) {
      console.warn('[AudioBuffer] Dropping frames due to buffer overflow')
      this.queue = this.queue.slice(-MAX_PENDING_FRAMES / 2)
    }
    
    // Split into 20ms frames for Twilio
    for (let i = 0; i < data.length; i += TWILIO_FRAME_SIZE) {
      const frame = data.slice(i, Math.min(i + TWILIO_FRAME_SIZE, data.length))
      if (frame.length === TWILIO_FRAME_SIZE) {
        this.queue.push(frame)
      } else if (frame.length > 0) {
        // Pad incomplete frame with silence
        const padded = new Uint8Array(TWILIO_FRAME_SIZE)
        padded.set(frame)
        padded.fill(0xff, frame.length) // μ-law silence
        this.queue.push(padded)
      }
    }
    
    this.schedulePlayback()
  }

  clear(): void {
    this.queue = []
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private schedulePlayback(): void {
    if (this.timer !== null) return
    
    const sendNext = () => {
      if (this.queue.length === 0) {
        this.timer = null
        return
      }
      
      const frame = this.queue.shift()!
      this.sendFn(frame)
      
      // Maintain 20ms pacing for smooth playback
      this.timer = setTimeout(sendNext, FRAME_DURATION_MS) as unknown as number
    }
    
    this.timer = setTimeout(sendNext, 0) as unknown as number
  }
}

// Connection manager with resilience
class RealtimeConnectionManager {
  private oaiWS: WebSocket | null = null
  private oaiReady = false
  private heartbeatTimer: number | null = null
  private connectionTimer: number | null = null
  
  async connect(
    model: string,
    instructions?: string,
    prompt?: { id: string; version?: string }
  ): Promise<WebSocket> {
    if (this.oaiWS && this.oaiReady) return this.oaiWS
    
    // Clean up existing connection
    this.disconnect()
    
    // Mint ephemeral token with best practices
    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) throw new Error('OPENAI_API_KEY not configured')
    
    const tokenPayload: any = {
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: {
        type: 'realtime',
        model,
        ...(instructions && { instructions }),
        ...(prompt && { prompt })
      }
    }
    
    const tokenResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify(tokenPayload)
    })
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      throw new Error(`OpenAI token error: ${tokenResponse.status} - ${error}`)
    }
    
    const tokenData = await tokenResponse.json()
    const token = tokenData?.client_secret?.value
    if (!token) throw new Error('No client_secret in response')
    
    // Connect with proper subprotocols
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
    const protocols = [
      'realtime',
      `openai-insecure-api-key.${token}`,
      ...(process.env.OPENAI_ORG_ID ? [`openai-organization.${process.env.OPENAI_ORG_ID}`] : []),
      ...(process.env.OPENAI_PROJECT_ID ? [`openai-project.${process.env.OPENAI_PROJECT_ID}`] : [])
    ]
    
    return new Promise((resolve, reject) => {
      this.oaiWS = new WebSocket(wsUrl, protocols)
      
      // Set connection timeout
      this.connectionTimer = setTimeout(() => {
        reject(new Error('OpenAI connection timeout'))
        this.disconnect()
      }, CONNECTION_TIMEOUT_MS) as unknown as number
      
      this.oaiWS.addEventListener('open', () => {
        clearTimeout(this.connectionTimer!)
        this.connectionTimer = null
        this.oaiReady = true
        this.startHeartbeat()
        
        // Configure session with best practices
        const sessionUpdate = buildServerUpdateFromEnv()
        
        // Override for G.711 μ-law passthrough mode
        if (sessionUpdate && typeof sessionUpdate === 'object') {
          (sessionUpdate as any).session = {
            ...(sessionUpdate as any).session,
            modalities: ['audio', 'text'],
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
          }
        }
        
        this.oaiWS!.send(JSON.stringify(sessionUpdate))
        resolve(this.oaiWS!)
      })
      
      this.oaiWS.addEventListener('error', (error) => {
        clearTimeout(this.connectionTimer!)
        this.oaiReady = false
        reject(error)
      })
      
      this.oaiWS.addEventListener('close', () => {
        this.oaiReady = false
        this.stopHeartbeat()
      })
    })
  }
  
  disconnect(): void {
    this.stopHeartbeat()
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = null
    }
    if (this.oaiWS) {
      try {
        this.oaiWS.close(1000, 'Normal closure')
      } catch {}
      this.oaiWS = null
    }
    this.oaiReady = false
  }
  
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.oaiWS && this.oaiReady) {
        try {
          // Send a lightweight ping to keep connection alive
          this.oaiWS.send(JSON.stringify({ type: 'session.get' }))
        } catch {
          this.stopHeartbeat()
        }
      }
    }, HEARTBEAT_INTERVAL_MS) as unknown as number
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
  
  get isReady(): boolean {
    return this.oaiReady && this.oaiWS !== null
  }
  
  get socket(): WebSocket | null {
    return this.oaiWS
  }
}

export async function GET(request: Request) {
  // Validate WebSocket upgrade request
  const upgrade = request.headers.get('upgrade')?.toLowerCase()
  const wsKey = request.headers.get('sec-websocket-key')
  
  if (upgrade !== 'websocket' || !wsKey) {
    return new Response('Expected WebSocket upgrade', {
      status: 426,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Content-Type': 'text/plain'
      }
    })
  }
  
  // Create WebSocket pair for Twilio connection
  // @ts-ignore - WebSocketPair exists in Edge runtime
  const pair = new WebSocketPair()
  const [client, server] = pair
  const twilioWS = server as unknown as WebSocket
  const clientWS = client as unknown as WebSocket
  
  // Connection state
  const connectionManager = new RealtimeConnectionManager()
  const audioBuffer = new AudioFrameBuffer((frame) => {
    const payload = AudioConverter.uint8ToBase64(frame)
    const msg = {
      event: 'media',
      streamSid: state.streamSid,
      media: { payload }
    }
    try {
      twilioWS.send(JSON.stringify(msg))
    } catch (e) {
      console.error('[Twilio] Failed to send audio frame:', e)
    }
  })
  
  // Session state
  const state = {
    streamSid: '',
    callSid: '',
    vadEnabled: true,
    lastAssistantItem: null as string | null,
    responseStartTimestamp: null as number | null,
    latestMediaTimestamp: null as number | null,
    closing: false
  }
  
  // Logging utility
  const log = (data: any) => {
    console.log('[Stream]', JSON.stringify(data))
  }
  
  // Clean shutdown handler
  const cleanup = () => {
    if (state.closing) return
    state.closing = true
    
    audioBuffer.clear()
    connectionManager.disconnect()
    
    try { twilioWS.close(1000, 'Normal closure') } catch {}
    try { clientWS.close(1000, 'Normal closure') } catch {}
  }
  
  // Handle OpenAI Realtime messages
  const handleOpenAIMessage = async (msg: any) => {
    switch (msg.type) {
      case 'response.audio.delta':
        // G.711 μ-law audio passthrough, paced via buffer for smoothness
        if (msg.delta) {
          if (state.responseStartTimestamp === null && state.latestMediaTimestamp !== null) {
            state.responseStartTimestamp = state.latestMediaTimestamp
          }
          if (msg.item_id) {
            state.lastAssistantItem = msg.item_id
          }

          // Enqueue to frame buffer which paces frames at 20ms
          const u8 = AudioConverter.base64ToUint8(msg.delta)
          audioBuffer.enqueue(u8)
        }
        break
        
      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        // Publish transcripts for live view
        if (msg.delta) {
          const key = state.callSid || state.streamSid
          await publishTranscript(key, {
            t: Date.now(),
            type: msg.type.includes('audio') ? 'audio_transcript.delta' : 'text.delta',
            text: msg.delta
          }).catch(() => {})
        }
        break
        
      case 'input_audio_buffer.speech_started':
        // Handle barge-in: clear playback and truncate assistant response
        audioBuffer.clear()
        twilioWS.send(JSON.stringify({
          event: 'clear',
          streamSid: state.streamSid
        }))
        
        // Truncate assistant audio if speaking
        if (state.lastAssistantItem && state.responseStartTimestamp !== null && state.latestMediaTimestamp !== null) {
          const audioEndMs = Math.max(0, state.latestMediaTimestamp - state.responseStartTimestamp)
          const oaiWS = connectionManager.socket
          if (oaiWS) {
            oaiWS.send(JSON.stringify({
              type: 'conversation.item.truncate',
              item_id: state.lastAssistantItem,
              content_index: 0,
              audio_end_ms: audioEndMs
            }))
          }
        }
        
        state.lastAssistantItem = null
        state.responseStartTimestamp = null
        break
        
      case 'response.created':
      case 'response.done':
      case 'session.created':
      case 'session.updated':
      case 'conversation.item.created':
      case 'conversation.item.done':
      case 'conversation.item.delta':
      case 'conversation.item.truncated':
      case 'input_audio_buffer.committed':
      case 'input_audio_buffer.cleared':
      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
        log({ source: 'openai', type: msg.type })
        break
      case 'error':
        console.error('[OpenAI] Error:', msg.error)
        break
    }
  }
  
  // Accept WebSocket connection
  // @ts-ignore - accept() exists in Edge runtime
  twilioWS.accept?.()
  
  // Handle Twilio Media Streams messages
  twilioWS.addEventListener('message', async (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)
      
      switch (data.event) {
        case 'start':
          state.streamSid = data.start.streamSid
          state.callSid = data.start.callSid || ''
          log({ event: 'start', streamSid: state.streamSid, callSid: state.callSid })
          
          // Initialize OpenAI connection
          const model = process.env.REALTIME_DEFAULT_MODEL || 'gpt-4o-realtime-preview'
          const instructions = process.env.REALTIME_DEFAULT_INSTRUCTIONS
          const promptId = process.env.REALTIME_DEFAULT_PROMPT_ID
          const promptVersion = process.env.REALTIME_DEFAULT_PROMPT_VERSION
          
          try {
            const oaiWS = await connectionManager.connect(
              model,
              instructions,
              promptId ? { id: promptId, version: promptVersion } : undefined
            )
            
            // Set up OpenAI message handler
            oaiWS.addEventListener('message', (ev) => {
              try {
                const msg = JSON.parse(ev.data as string)
                handleOpenAIMessage(msg).catch(console.error)
              } catch {}
            })
            
            oaiWS.addEventListener('error', () => cleanup())
            oaiWS.addEventListener('close', () => {
              if (!state.closing) cleanup()
            })
            
            // Check VAD configuration
            const sessionConfig = buildServerUpdateFromEnv()
            state.vadEnabled = (sessionConfig as any)?.session?.turn_detection?.type !== 'none'
            
            // Clear buffer for manual turn if VAD disabled
            if (!state.vadEnabled) {
              oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.clear' }))
            }
          } catch (error) {
            console.error('[OpenAI] Connection failed:', error)
            cleanup()
          }
          break
          
        case 'media':
          // Forward μ-law audio to OpenAI
          if (data.media?.payload) {
            state.latestMediaTimestamp = data.media.timestamp ?? state.latestMediaTimestamp

            const oaiWS = connectionManager.socket
            if (oaiWS && connectionManager.isReady) {
              // Send audio in G.711 μ-law format
              oaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              }))
            }
          }
          break
          
        case 'mark':
          // Handle custom marks for turn management
          if (data.mark?.name === 'commit') {
            const oaiWS = connectionManager.socket
            if (oaiWS && connectionManager.isReady) {
              oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
              oaiWS.send(JSON.stringify({ type: 'response.create' }))
            }
            log({ event: 'mark.commit', streamSid: state.streamSid })
          }
          break
          
        case 'stop':
          log({ event: 'stop', streamSid: state.streamSid })
          cleanup()
          break
      }
    } catch (error) {
      console.error('[Twilio] Message handling error:', error)
    }
  })
  
  twilioWS.addEventListener('close', cleanup)
  twilioWS.addEventListener('error', (error) => {
    console.error('[Twilio] WebSocket error:', error)
    cleanup()
  })
  
  // Return WebSocket upgrade response
  const requestProtocol = request.headers.get('sec-websocket-protocol')
  const responseHeaders = new Headers()
  
  // Echo back the first requested protocol (Twilio uses 'audio')
  if (requestProtocol) {
    const protocol = requestProtocol.split(',')[0].trim()
    if (protocol) {
      responseHeaders.set('Sec-WebSocket-Protocol', protocol)
    }
  }
  
  // @ts-ignore - Edge runtime WebSocket response
  return new Response(null, {
    status: 101,
    // @ts-ignore - webSocket is valid in Edge runtime
    webSocket: clientWS,
    headers: responseHeaders
  } as any)
}

export async function HEAD() {
  // Health check endpoint
  return new Response(null, { status: 204 })
}