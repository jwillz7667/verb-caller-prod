type TurnDetectionNone = { type: 'none' }
type TurnDetectionVad = {
  type: 'server_vad'
  threshold: number
  prefix_padding_ms: number
  silence_duration_ms: number
  create_response?: boolean
  interrupt_response?: boolean
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

