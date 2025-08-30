import { z } from 'zod'

export const ToolSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  parameters: z.record(z.any()).default({})
})

export const TranscriptionSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().default('gpt-4o-transcribe'),
  prompt: z.string().optional(),
  language: z.string().optional(),
  logprobs: z.boolean().optional(),
  include_segments: z.boolean().optional(),
})

const RealtimeSessionCore = z.object({
  type: z.literal('realtime').default('realtime'),
  model: z.string().default('gpt-realtime'),
  instructions: z.string().min(1).optional(),
  prompt: z.object({
    id: z.string().min(1),
    version: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  tools: z.array(ToolSchema).optional().default([]),
  tool_choice: z.enum(['auto', 'required', 'none']).default('auto'),
  temperature: z.number().min(0).max(2).default(0.7),
  max_output_tokens: z.union([z.literal('inf'), z.number().int().min(1)]).default('inf'),
  modalities: z.array(z.enum(['audio', 'text'])).default(['audio']),
  voice: z.string().default('alloy'),
  turn_detection: z.object({
    type: z.enum(['none', 'server_vad']).default('server_vad'),
    threshold: z.number().min(0).max(1).default(0.5),
    prefix_padding_ms: z.number().int().min(0).max(2000).default(300),
    silence_duration_ms: z.number().int().min(50).max(5000).default(200),
    idle_timeout_ms: z.number().int().nullable().optional(),
    create_response: z.boolean().default(true),
    interrupt_response: z.boolean().default(true),
  }).default({ type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 200, create_response: true, interrupt_response: true }),
  input_audio_format: z.object({
    type: z.literal('audio/pcm').default('audio/pcm'),
    rate: z.number().int().default(24000)
  }).default({ type: 'audio/pcm', rate: 24000 }),
  transcription: TranscriptionSchema.default({ enabled: false, model: 'gpt-4o-transcribe' }),
  noise_reduction: z.enum(['none', 'near_field']).default('near_field'),
  embedded_media: z.array(
    z.object({
      type: z.literal('image'),
      mime_type: z.string(),
      data_base64: z.string(),
      name: z.string().optional()
    })
  ).optional().default([])
})

export const RealtimeSessionSchema = RealtimeSessionCore.refine(
  (s) => (typeof s.instructions === 'string' && s.instructions.length > 0) || !!s.prompt,
  { message: 'Provide either instructions or a prompt reference.' }
)

export const EphemeralRequestSchema = z.object({
  expires_after: z.object({
    anchor: z.enum(['created_at']).default('created_at'),
    seconds: z.number().int().min(60).max(3600).default(600)
  }),
  session: RealtimeSessionSchema,
  server: z.object({
    url: z.string().url(),
    secret: z.string().optional()
  }).optional()
})

export const OutgoingCallSchema = z.object({
  openaiApiKey: z.string().min(1).optional(),
  twilioAccountSid: z.string().min(1).optional(),
  twilioAuthToken: z.string().min(1).optional(),
  twilioFromNumber: z.string().min(1).optional(),
  toNumber: z.string().refine((v) => /^\+[1-9]\d{1,14}$/.test(v), 'Must be E.164'),
  record: z.boolean().default(true),
  ephemeral: EphemeralRequestSchema
})

export type ToolDef = z.infer<typeof ToolSchema>
export type RealtimeSession = z.infer<typeof RealtimeSessionSchema>
export type EphemeralRequest = z.infer<typeof EphemeralRequestSchema>
export type OutgoingCallRequest = z.infer<typeof OutgoingCallSchema>
