type TurnDetectionNone = { type: 'none' }
type TurnDetectionVad = {
  type: 'server_vad'
  threshold: number
  prefix_padding_ms: number
  silence_duration_ms: number
  create_response?: boolean
  interrupt_response?: boolean
}

// Aligned with OpenAI Realtime API session.update parameters
export type RealtimeControlSettings = {
  // Core session parameters
  voice?: string  // alloy, echo, shimmer
  instructions?: string  // System instructions
  input_audio_format?: string  // g711_ulaw, pcm16
  output_audio_format?: string  // g711_ulaw, pcm16
  input_audio_transcription?: {
    model: string  // whisper-1
  } | null
  turn_detection?:
    | { type: 'none' }
    | {
        type: 'server_vad'
        threshold?: number
        prefix_padding_ms?: number
        silence_duration_ms?: number
        create_response?: boolean
      }
  tools?: any[]  // Function tools array
  tool_choice?: 'auto' | 'none' | 'required' | string  // Strategy or specific function
  temperature?: number  // 0.0 to 2.0
  max_response_output_tokens?: number | null  // Max tokens for response
}

let dynamicSettings: RealtimeControlSettings | null = null

export function setRealtimeControlSettings(s: RealtimeControlSettings | null) {
  dynamicSettings = s
}

export function getRealtimeControlSettings(): RealtimeControlSettings | null {
  return dynamicSettings
}

export function buildServerUpdateFromEnv() {
  const voice = process.env.REALTIME_DEFAULT_VOICE || undefined
  const toolChoice = process.env.REALTIME_DEFAULT_TOOL_CHOICE || undefined
  const modalities = (process.env.REALTIME_DEFAULT_MODALITIES || 'audio')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const temperature = parseMaybeFloat(process.env.REALTIME_DEFAULT_TEMPERATURE)
  const maxTokens = parseMaybeInt(process.env.REALTIME_DEFAULT_MAX_OUTPUT_TOKENS)

  const turnType = (process.env.REALTIME_TURN_DETECTION || 'server_vad').toLowerCase()
  const vad: TurnDetectionVad = {
    type: 'server_vad',
    threshold: parseMaybeFloat(process.env.REALTIME_VAD_THRESHOLD, 0.5)!,
    prefix_padding_ms: parseMaybeInt(process.env.REALTIME_VAD_PREFIX_MS, 300)!,
    silence_duration_ms: parseMaybeInt(process.env.REALTIME_VAD_SILENCE_MS, 200)!,
    create_response: true,
    interrupt_response: true,
  }
  const turn_detection: TurnDetectionNone | TurnDetectionVad = turnType === 'none' ? { type: 'none' } : vad

  const noiseReduction = (process.env.REALTIME_NOISE_REDUCTION || 'near_field') as 'near_field' | 'far_field' | 'none'
  const inputRate = parseMaybeInt(process.env.REALTIME_INPUT_AUDIO_RATE, 24000)!
  const realtimeMode = (process.env.REALTIME_MODE || process.env.TWIML_DEFAULT_MODE || '').toLowerCase()
  const preferCodec = (process.env.REALTIME_AUDIO_CODEC || '').toLowerCase()
  const useG711 = realtimeMode === 'sip' || preferCodec === 'g711_ulaw' || preferCodec === 'g711'

  const transcriptionEnabled = (process.env.REALTIME_TRANSCRIPTION_ENABLED || 'false').toLowerCase() === 'true'
  const transcription = transcriptionEnabled
    ? {
        enabled: true,
        model: process.env.REALTIME_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe',
        prompt: process.env.REALTIME_TRANSCRIPTION_PROMPT || undefined,
        language: process.env.REALTIME_TRANSCRIPTION_LANGUAGE || undefined,
        logprobs: parseMaybeBool(process.env.REALTIME_TRANSCRIPTION_LOGPROBS),
        include_segments: parseMaybeBool(process.env.REALTIME_TRANSCRIPTION_SEGMENTS),
      }
    : undefined

  const instructions = process.env.REALTIME_DEFAULT_INSTRUCTIONS || `ROLE: Helpful AI assistant.
OBJECTIVE: Assist users effectively.
PERSONALITY: Friendly, professional, conversational.
INSTRUCTIONS: ALWAYS follow user instructions. Prioritize requests. Be concise unless asked for detail.
CONVERSATION: Listen actively. Respond helpfully. Confirm understanding.`
  
  const session: any = {}
  if (voice) session.voice = voice
  if (instructions) session.instructions = instructions
  if (toolChoice) session.tool_choice = toolChoice
  if (typeof temperature === 'number') session.temperature = temperature
  if (typeof maxTokens === 'number') session.max_response_output_tokens = maxTokens
  session.turn_detection = turn_detection
  
  if (useG711) {
    // For SIP/telephony, use G.711 μ-law
    session.input_audio_format = 'g711_ulaw'
    session.output_audio_format = 'g711_ulaw'
  } else {
    // For WebRTC/browser, use PCM16
    session.input_audio_format = 'pcm16'
    session.output_audio_format = 'pcm16'
  }
  
  // Add input audio transcription if enabled
  if (transcriptionEnabled) {
    session.input_audio_transcription = { model: 'whisper-1' }
  }

  return { type: 'session.update', session }
}

export function buildServerUpdate() {
  const s = getRealtimeControlSettings()
  if (!s) return buildServerUpdateFromEnv()
  const session: any = {}
  
  // Apply valid session.update parameters
  if (s.voice) session.voice = s.voice
  if (s.instructions) session.instructions = s.instructions
  if (s.tool_choice) session.tool_choice = s.tool_choice
  if (Array.isArray(s.tools) && s.tools.length > 0) session.tools = s.tools
  if (typeof s.temperature === 'number') session.temperature = s.temperature
  if (typeof s.max_response_output_tokens === 'number') session.max_response_output_tokens = s.max_response_output_tokens
  if (s.turn_detection) session.turn_detection = s.turn_detection
  if (s.input_audio_format) session.input_audio_format = s.input_audio_format
  if (s.output_audio_format) session.output_audio_format = s.output_audio_format
  if (s.input_audio_transcription) session.input_audio_transcription = s.input_audio_transcription
  
  // If no settings were applied, fall back to env defaults
  if (Object.keys(session).length === 0) {
    return buildServerUpdateFromEnv()
  }
  
  return { type: 'session.update', session }
}

function parseMaybeFloat(v?: string, fallback?: number) {
  if (v == null) return fallback
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}
function parseMaybeInt(v?: string, fallback?: number) {
  if (v == null) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}
function parseMaybeBool(v?: string) {
  if (v == null) return undefined
  const s = v.toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return undefined
}
