type TurnDetectionNone = { type: 'none' }
type TurnDetectionVad = {
  type: 'server_vad'
  threshold: number
  prefix_padding_ms: number
  silence_duration_ms: number
  create_response?: boolean
  interrupt_response?: boolean
}

export type RealtimeControlSettings = {
  voice?: string
  tool_choice?: 'auto' | 'required' | 'none'
  modalities?: Array<'audio' | 'text'>
  temperature?: number
  max_output_tokens?: number | null
  turn_detection?:
    | { type: 'none' }
    | {
        type: 'server_vad'
        threshold?: number
        prefix_padding_ms?: number
        silence_duration_ms?: number
        create_response?: boolean
        interrupt_response?: boolean
        semantic?: boolean // experimental
      }
  input_audio_format?: { type: 'audio/pcm'; rate: number }
  transcription?: {
    enabled: boolean
    model: string
    prompt?: string
    language?: string
    logprobs?: boolean
    include_segments?: boolean
  }
  noise_reduction?: 'near_field' | 'none'
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

  const noiseReduction = (process.env.REALTIME_NOISE_REDUCTION || 'near_field') as 'near_field' | 'none'
  const inputRate = parseMaybeInt(process.env.REALTIME_INPUT_AUDIO_RATE, 24000)!

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

  const session: any = {}
  if (voice) session.voice = voice
  if (toolChoice) session.tool_choice = toolChoice
  if (modalities.length > 0) session.modalities = modalities
  if (typeof temperature === 'number') session.temperature = temperature
  if (typeof maxTokens === 'number') session.max_output_tokens = maxTokens
  session.turn_detection = turn_detection
  session.input_audio_format = { type: 'audio/pcm', rate: inputRate }
  if (transcription) session.transcription = transcription
  session.noise_reduction = noiseReduction

  return { type: 'session.update', session }
}

export function buildServerUpdate() {
  const s = getRealtimeControlSettings()
  if (!s) return buildServerUpdateFromEnv()
  const session: any = {}
  if (s.voice) session.voice = s.voice
  if (s.tool_choice) session.tool_choice = s.tool_choice
  if (Array.isArray(s.modalities) && s.modalities.length > 0) session.modalities = s.modalities
  if (typeof s.temperature === 'number') session.temperature = s.temperature
  if (typeof s.max_output_tokens === 'number') session.max_output_tokens = s.max_output_tokens
  if (s.turn_detection) session.turn_detection = s.turn_detection
  if (s.input_audio_format) session.input_audio_format = s.input_audio_format
  if (s.transcription && s.transcription.enabled) session.transcription = s.transcription
  if (s.noise_reduction) session.noise_reduction = s.noise_reduction
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
