"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'
import { Select } from './ui/Select'
import { Toggle } from './ui/Toggle'
import { Button } from './ui/Button'
import toast from 'react-hot-toast'
import { fileToBase64 } from '@/lib/utils'
import { CopyButton } from './ui/CopyButton'
import type { RealtimeSession } from '@/lib/validation'

const ToolFormSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.string().transform((s) => {
    try {
      return s ? JSON.parse(s) : {}
    } catch {
      throw new Error('Invalid JSON')
    }
  })
})

export type DashboardValues = {
  toNumber: string
  record: boolean
  expiresSeconds: number
  model: string
  instructions: string
  tool_choice: 'auto' | 'required' | 'none'
  temperature: number
  max_output_tokens: string
  modalities: string[]
  voice: string
  turn_detection: 'none' | 'server_vad'
  vad_threshold: number
  vad_prefix_padding_ms: number
  vad_silence_duration_ms: number
  input_audio_type: 'audio/pcm'
  input_audio_rate: number
  transcription_enabled: boolean
  transcription_model: string
  transcription_prompt?: string
  transcription_language?: string
  transcription_logprobs?: boolean
  transcription_segments?: boolean
  noise_reduction: 'none' | 'near_field'
  imageFiles: FileList | null
}

const defaultInstructions = `You are a professional phone agent. Greet the callee, explain the purpose, and converse naturally. Be concise, polite, and helpful. If asked to perform actions you cannot, say you will follow up via email. Never share secrets. Summarize key points before ending.`

const STORAGE_KEY = 'aivoicecaller.dashboard.v1'

export default function DashboardForm() {
  const form = useForm<DashboardValues>({
    resolver: zodResolver(
      z.object({
        toNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164'),
        record: z.boolean().default(true),
        expiresSeconds: z.number().min(60).max(3600).default(600),
        model: z.enum(['gpt-realtime', 'gpt-4o-realtime-preview']).default('gpt-realtime'),
        instructions: z.string().min(1),
        tool_choice: z.enum(['auto', 'required', 'none']).default('auto'),
        temperature: z.number().min(0).max(2).default(0.7),
        max_output_tokens: z.string().default('inf'),
        modalities: z.array(z.enum(['audio', 'text'])).default(['audio']),
        voice: z.enum(['alloy','echo','fable','onyx','nova','shimmer']).default('alloy'),
        turn_detection: z.enum(['none','server_vad']).default('server_vad'),
        vad_threshold: z.number().min(0).max(1).default(0.5),
        vad_prefix_padding_ms: z.number().min(0).max(2000).default(300),
        vad_silence_duration_ms: z.number().min(50).max(5000).default(200),
        input_audio_type: z.literal('audio/pcm').default('audio/pcm'),
        input_audio_rate: z.number().default(24000),
        transcription_enabled: z.boolean().default(false),
        transcription_model: z.string().default('gpt-4o-transcribe'),
        transcription_prompt: z.string().optional(),
        transcription_language: z.string().optional(),
        transcription_logprobs: z.boolean().optional(),
        transcription_segments: z.boolean().optional(),
        noise_reduction: z.enum(['none','near_field']).default('near_field'),
        imageFiles: z.any().optional(),
      })
    ),
    defaultValues: {
      toNumber: '',
      record: true,
      expiresSeconds: 600,
      model: 'gpt-realtime',
      instructions: defaultInstructions,
      tool_choice: 'auto',
      temperature: 0.7,
      max_output_tokens: 'inf',
      modalities: ['audio'],
      voice: 'alloy',
      turn_detection: 'server_vad',
      vad_threshold: 0.5,
      vad_prefix_padding_ms: 300,
      vad_silence_duration_ms: 200,
      input_audio_type: 'audio/pcm',
      input_audio_rate: 24000,
      transcription_enabled: false,
      transcription_model: 'gpt-4o-transcribe',
      noise_reduction: 'near_field',
    }
  })

  // Load persisted values (minus secrets)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const saved = JSON.parse(raw)
        form.reset({ ...form.getValues(), ...saved })
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSavePreset = useCallback(() => {
    const {
      instructions,
      model,
      tool_choice,
      temperature,
      max_output_tokens,
      modalities,
      voice,
      turn_detection,
      vad_threshold,
      vad_prefix_padding_ms,
      vad_silence_duration_ms,
      input_audio_type,
      input_audio_rate,
      transcription_enabled,
      transcription_model,
      transcription_prompt,
      transcription_language,
      transcription_logprobs,
      transcription_segments,
      noise_reduction,
    } = form.getValues()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        instructions,
        model,
        tool_choice,
        temperature,
        max_output_tokens,
        modalities,
        voice,
        turn_detection,
        vad_threshold,
        vad_prefix_padding_ms,
        vad_silence_duration_ms,
        input_audio_type,
        input_audio_rate,
        transcription_enabled,
        transcription_model,
        transcription_prompt,
        transcription_language,
        transcription_logprobs,
        transcription_segments,
        noise_reduction,
      })
    )
    toast.success('Preset saved locally')
  }, [form])

  const [tools, setTools] = useState<Array<{ name: string; description: string; parameters: any }>>([])
  const [toolJson, setToolJson] = useState('')
  const toolJsonRef = useRef<HTMLTextAreaElement>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [generated, setGenerated] = useState<null | { secret: string; sipUri: string; twimlProd: string; twimlLocal: string; expiresAt?: number }>(null)
  const [includeServerWebhook, setIncludeServerWebhook] = useState(false)
  const [serverSecret, setServerSecret] = useState('')
  const [hostOrigin, setHostOrigin] = useState('')
  const [autoUpdateTwilio, setAutoUpdateTwilio] = useState(false)
  const [twilioUpdating, setTwilioUpdating] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHostOrigin(window.location.origin)
    }
  }, [])

  const addTool = () => {
    try {
      const parsed = ToolFormSchema.parse({ name: 'tool', description: 'Describe the tool', parameters: toolJson || '{}' })
      setTools((t) => [...t, { name: parsed.name, description: parsed.description, parameters: parsed.parameters }])
      setToolJson('')
      toast.success('Tool added')
    } catch (e: any) {
      toast.error(e?.message || 'Invalid tool JSON')
    }
  }

  const removeTool = (idx: number) => setTools((t) => t.filter((_, i) => i !== idx))

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const embedded_media = [] as RealtimeSession['embedded_media']
      const files: FileList | null = values.imageFiles as any
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const b64 = await fileToBase64(f)
          embedded_media.push({ type: 'image', mime_type: f.type, data_base64: b64, name: f.name })
        }
      }

      const session: RealtimeSession = {
        type: 'realtime',
        model: values.model,
        instructions: values.instructions,
        tools,
        tool_choice: values.tool_choice,
        temperature: values.temperature,
        max_output_tokens: values.max_output_tokens === 'inf' ? 'inf' : Number(values.max_output_tokens),
        modalities: values.modalities as any,
        voice: values.voice,
        turn_detection: values.turn_detection === 'none'
          ? { type: 'none', threshold: 0.5, prefix_padding_ms: 0, silence_duration_ms: 0, create_response: true, interrupt_response: true }
          : {
              type: 'server_vad',
              threshold: values.vad_threshold,
              prefix_padding_ms: values.vad_prefix_padding_ms,
              silence_duration_ms: values.vad_silence_duration_ms,
              create_response: true,
              interrupt_response: true,
            },
        input_audio_format: { type: values.input_audio_type, rate: values.input_audio_rate },
        transcription: {
          enabled: values.transcription_enabled,
          model: values.transcription_model,
          prompt: values.transcription_prompt,
          language: values.transcription_language,
          logprobs: values.transcription_logprobs,
          include_segments: values.transcription_segments,
        },
        noise_reduction: values.noise_reduction,
        embedded_media,
      }

      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toNumber: values.toNumber,
          record: values.record,
          ephemeral: {
            expires_after: { anchor: 'created_at', seconds: values.expiresSeconds },
            session,
          }
        })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = err?.error?.message || err?.error || err?.message || `Failed: ${res.status}`
        throw new Error(msg)
      }
      const json = await res.json()
      toast.success('Call initiated')
      console.log('Call created:', json)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start call')
      console.error(e)
    }
  })

  const testWebSocket = async () => {
    try {
      const v = form.getValues()
      const session: RealtimeSession = {
        type: 'realtime',
        model: v.model,
        instructions: v.instructions,
        tools,
        tool_choice: v.tool_choice,
        temperature: v.temperature,
        max_output_tokens: v.max_output_tokens === 'inf' ? 'inf' : Number(v.max_output_tokens),
        modalities: v.modalities as any,
        voice: v.voice,
        turn_detection: v.turn_detection === 'none'
          ? { type: 'none', threshold: 0.5, prefix_padding_ms: 0, silence_duration_ms: 0, create_response: true, interrupt_response: true }
          : { type: 'server_vad', threshold: v.vad_threshold, prefix_padding_ms: v.vad_prefix_padding_ms, silence_duration_ms: v.vad_silence_duration_ms, create_response: true, interrupt_response: true },
        input_audio_format: { type: v.input_audio_type, rate: v.input_audio_rate },
        transcription: { enabled: v.transcription_enabled, model: v.transcription_model, prompt: v.transcription_prompt, language: v.transcription_language, logprobs: v.transcription_logprobs, include_segments: v.transcription_segments },
        noise_reduction: v.noise_reduction,
        embedded_media: []
      }
      const res = await fetch('/api/realtime-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: v.expiresSeconds }, session })
      })
      if (!res.ok) {
        const txt = await res.text()
        let err: any = {}
        try { err = txt ? JSON.parse(txt) : {} } catch {}
        const msg = err?.error?.message || err?.error || err?.message || `Failed: ${res.status}`
        throw new Error(msg)
      }
      const txt = await res.text()
      const json = txt ? JSON.parse(txt) : {}
      const secret: string | undefined = json?.client_secret?.value
      if (!secret) throw new Error('No secret returned')
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`
      const ws = new WebSocket(url, [
        // Using subprotocol for browser-based auth with ephemeral secrets
        `openai-insecure-api-key.${secret}`
      ])
      ws.onopen = () => {
        toast.success('WebSocket connected')
        // Build a compliant session.update payload (omit fields not supported by client_secrets)
        const update: any = {
          type: 'session.update',
          session: {}
        }
        // Allow-list typical realtime session fields for session.update
        update.session.instructions = session.instructions
        update.session.voice = session.voice
        update.session.modalities = session.modalities
        update.session.tool_choice = session.tool_choice
        if (Array.isArray(session.tools) && session.tools.length > 0) {
          update.session.tools = session.tools
        }
        if (typeof session.temperature === 'number') {
          update.session.temperature = session.temperature
        }
        if (session.max_output_tokens !== 'inf' && typeof session.max_output_tokens === 'number') {
          update.session.max_output_tokens = session.max_output_tokens
        }
        if (session.turn_detection && session.turn_detection.type === 'server_vad') {
          update.session.turn_detection = session.turn_detection
        } else {
          update.session.turn_detection = { type: 'none' }
        }
        if (session.input_audio_format) {
          update.session.input_audio_format = session.input_audio_format
        }
        if (session.transcription && session.transcription.enabled) {
          update.session.transcription = session.transcription
        }
        if (session.noise_reduction) {
          update.session.noise_reduction = session.noise_reduction
        }
        try { ws.send(JSON.stringify(update)) } catch {}
      }
      ws.onclose = () => toast('WebSocket closed')
      ws.onerror = (e) => {
        console.error('WS error', e)
        toast.error('WebSocket error')
      }
      ws.onmessage = (ev) => {
        console.log('WS message', ev.data)
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to connect WS')
    }
  }

  const generateClientSecret = async () => {
    try {
      setGenLoading(true)
      const v = form.getValues()
      const session: RealtimeSession = {
        type: 'realtime',
        model: v.model,
        instructions: v.instructions,
        tools,
        tool_choice: v.tool_choice,
        temperature: v.temperature,
        max_output_tokens: v.max_output_tokens === 'inf' ? 'inf' : Number(v.max_output_tokens),
        modalities: v.modalities as any,
        voice: v.voice,
        turn_detection: v.turn_detection === 'none'
          ? { type: 'none', threshold: 0.5, prefix_padding_ms: 0, silence_duration_ms: 0, create_response: true, interrupt_response: true }
          : { type: 'server_vad', threshold: v.vad_threshold, prefix_padding_ms: v.vad_prefix_padding_ms, silence_duration_ms: v.vad_silence_duration_ms, create_response: true, interrupt_response: true },
        input_audio_format: { type: v.input_audio_type, rate: v.input_audio_rate },
        transcription: { enabled: v.transcription_enabled, model: v.transcription_model, prompt: v.transcription_prompt, language: v.transcription_language, logprobs: v.transcription_logprobs, include_segments: v.transcription_segments },
        noise_reduction: v.noise_reduction,
        embedded_media: []
      }
      const body: any = { expires_after: { anchor: 'created_at', seconds: v.expiresSeconds }, session }
      if (includeServerWebhook) {
        const serverUrlProd = `https://verbio.app/api/realtime/control`
        body.server = { url: serverUrlProd }
        if (serverSecret) body.server.secret = serverSecret
      }
      const res = await fetch('/api/realtime-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const txt = await res.text()
        let err: any = {}
        try { err = txt ? JSON.parse(txt) : {} } catch {}
        const msg = err?.error?.message || err?.error || err?.message || 'Failed to generate token'
        throw new Error(msg)
      }
      const txt2 = await res.text()
      const json = txt2 ? JSON.parse(txt2) : {}
      const secret: string | undefined = json?.client_secret?.value
      const expiresAt: number | undefined = json?.client_secret?.expires_at
      if (!secret) throw new Error('No secret in response')
      const sipUri = `sip:${secret}@sip.openai.com`
      const twimlProd = `https://verbio.app/api/twiml?secret=${encodeURIComponent(secret)}`
      const twimlLocal = `${window.location.origin}/api/twiml?secret=${encodeURIComponent(secret)}`
      setGenerated({ secret, sipUri, twimlProd, twimlLocal, expiresAt })
      toast.success('Client secret generated')
      if (autoUpdateTwilio) {
        setTwilioUpdating(true)
        try {
          const r = await fetch('/api/twilio/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) })
          const txt = await r.text()
          const json = txt ? JSON.parse(txt) : {}
          if (!r.ok || !json?.ok) {
            const msg = json?.error || `Failed to update Twilio webhook (${r.status})`
            throw new Error(msg)
          }
          toast.success('Twilio webhook updated')
          console.log('Webhook updated:', json)
        } catch (e: any) {
          toast.error(e?.message || 'Failed to update Twilio webhook')
        } finally {
          setTwilioUpdating(false)
        }
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate')
    } finally {
      setGenLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h2 className="mb-2 text-lg font-semibold">Credentials</h2>
        <p className="text-sm text-neutral-400">Server-managed. Configure env vars in Vercel: OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.</p>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h2 className="mb-4 text-lg font-semibold">Realtime Session</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={form.control}
            name="model"
            render={({ field }) => (
              <Select label="Model" options={[
                { label: 'gpt-realtime', value: 'gpt-realtime' },
                { label: 'gpt-4o-realtime-preview', value: 'gpt-4o-realtime-preview' },
              ]} value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="voice"
            render={({ field }) => (
              <Select label="Voice" options={[
                'alloy','echo','fable','onyx','nova','shimmer'
              ].map(v => ({ label: v, value: v }))} value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="tool_choice"
            render={({ field }) => (
              <Select label="Tool Choice" options={['auto','required','none'].map(v => ({label:v, value:v}))} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Temperature: {form.watch('temperature')}</label>
            <input type="range" min={0} max={2} step={0.1} {...form.register('temperature', { valueAsNumber: true })} />
          </div>
          <Input label="Max Output Tokens" placeholder="inf or number" {...form.register('max_output_tokens')} />
          <Input label="Expires After Seconds" type="number" {...form.register('expiresSeconds', { valueAsNumber: true })} />
        </div>
        <div className="mt-4">
          <Textarea label="Instructions" {...form.register('instructions')} defaultValue={defaultInstructions} />
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={onSavePreset}>Save Preset</Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={form.control}
            name="turn_detection"
            render={({ field }) => (
              <Select label="Turn Detection" options={[{label:'none', value:'none'},{label:'server_vad', value:'server_vad'}]} value={field.value} onChange={field.onChange} />
            )}
          />
          {form.watch('turn_detection') === 'server_vad' && (
            <>
              <div>
                <label className="mb-1 block text-sm text-neutral-300">VAD Threshold: {form.watch('vad_threshold')}</label>
                <input type="range" min={0} max={1} step={0.01} {...form.register('vad_threshold', { valueAsNumber: true })} />
              </div>
              <Input label="Prefix Padding (ms)" type="number" {...form.register('vad_prefix_padding_ms', { valueAsNumber: true })} />
              <Input label="Silence Duration (ms)" type="number" {...form.register('vad_silence_duration_ms', { valueAsNumber: true })} />
            </>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={form.control}
            name="noise_reduction"
            render={({ field }) => (
              <Select label="Noise Reduction" options={[{label:'near_field', value:'near_field'},{label:'none', value:'none'}]} value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="input_audio_type"
            render={({ field }) => (
              <Select label="Input Audio Type" options={[{label:'audio/pcm', value:'audio/pcm'}]} value={field.value} onChange={field.onChange} />
            )}
          />
          <Input label="Input Audio Rate" type="number" {...form.register('input_audio_rate', { valueAsNumber: true })} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={form.control}
            name="transcription_enabled"
            render={({ field }) => (
              <Toggle label="Transcription" checked={field.value} onChange={field.onChange} />
            )}
          />
          {form.watch('transcription_enabled') && (
            <>
              <Input label="Transcription Model" {...form.register('transcription_model')} />
              <Input label="Language (optional)" {...form.register('transcription_language')} />
              <Input label="Prompt (optional)" {...form.register('transcription_prompt')} />
            </>
          )}
        </div>

        <div className="mt-6">
          <label className="mb-1 block text-sm text-neutral-300">Tools (JSON Schema)</label>
          <Textarea ref={toolJsonRef} placeholder='{"name":"search","description":"...","parameters":{"type":"object","properties":{"q":{"type":"string"}}}}' value={toolJson} onChange={(e) => setToolJson(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={addTool}>Add Tool</Button>
          </div>
          {tools.length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-800 rounded-md border border-neutral-800">
              {tools.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate text-xs text-neutral-400">{t.description}</p>
                  </div>
                  <Button type="button" className="bg-red-500/20 hover:bg-red-500/30" onClick={() => removeTool(i)}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <label className="mb-1 block text-sm text-neutral-300">Image Input (optional)</label>
          <input type="file" multiple accept="image/*" onChange={(e) => form.setValue('imageFiles', e.target.files)} />
          <p className="mt-1 text-xs text-neutral-500">Images will be embedded into the session as base64 (max 15MB total).</p>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h2 className="mb-4 text-lg font-semibold">Call</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input label="To Number (E.164)" placeholder="+1..." {...form.register('toNumber')} />
          <Controller
            control={form.control}
            name="record"
            render={({ field }) => (
              <Toggle label="Record Call" checked={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <div className="mt-4 flex gap-3">
          <Button type="submit" className="bg-brand-600 hover:bg-brand-500">Start Outgoing Call</Button>
          <Button type="button" onClick={testWebSocket}>Test WebSocket Fallback</Button>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
        <h2 className="mb-2 text-lg font-semibold">Incoming Calls Setup</h2>
        <p className="text-sm text-neutral-400">Point your Twilio number Voice webhook to <code className="rounded bg-neutral-900 px-2 py-1">/api/twiml?secret=&lt;client_secret&gt;</code>. Generate a client secret via the Realtime API and paste its value into the query param. The app responds with TwiML that bridges to OpenAI SIP.</p>
        <div className="mt-4 flex gap-3">
          <Button type="button" onClick={generateClientSecret} disabled={genLoading} className="bg-brand-600 hover:bg-brand-500">
            {genLoading ? 'Generating…' : 'Generate Client Secret'}
          </Button>
          <div className="flex items-center gap-2">
            <button type="button" role="switch" aria-checked={autoUpdateTwilio} onClick={() => setAutoUpdateTwilio((v) => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${autoUpdateTwilio ? 'bg-brand-600' : 'bg-neutral-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${autoUpdateTwilio ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-neutral-400">Auto-update Twilio webhook</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Server Control Webhook (optional)</label>
            <div className="flex items-center gap-3">
              <button type="button" role="switch" aria-checked={includeServerWebhook} onClick={() => setIncludeServerWebhook((v) => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${includeServerWebhook ? 'bg-brand-600' : 'bg-neutral-700'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${includeServerWebhook ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-neutral-400">Include in client secret (beta)</span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">URL (prod): https://verbio.app/api/realtime/control</p>
            <p className="mt-1 text-xs text-neutral-500">URL (this host): {hostOrigin ? `${hostOrigin}/api/realtime/control` : '—'}</p>
            {includeServerWebhook && (
              <p className="mt-1 text-xs text-amber-400">Note: Some accounts reject the top-level "server" parameter during token minting. We still generate the secret; configure server-side control out-of-band if needed.</p>
            )}
          </div>
          {includeServerWebhook && (
            <div>
              <Input label="Server Webhook Secret (optional)" placeholder="secret for Authorization: Bearer" value={serverSecret} onChange={(e) => setServerSecret(e.target.value)} />
            </div>
          )}
        </div>
        {generated && (
          <div className="mt-4 space-y-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">Client Secret</p>
                <p className="truncate font-mono text-sm">{generated.secret}</p>
              </div>
              <CopyButton value={generated.secret} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">SIP URI (PBX)</p>
                <p className="truncate font-mono text-sm">{generated.sipUri}</p>
              </div>
              <CopyButton value={generated.sipUri} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">Twilio Webhook (Prod)</p>
                <p className="truncate font-mono text-sm">{generated.twimlProd}</p>
              </div>
              <CopyButton value={generated.twimlProd} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">Twilio Webhook (This Host)</p>
                <p className="truncate font-mono text-sm">{generated.twimlLocal}</p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={generated.twimlLocal} />
                <Button type="button" disabled={twilioUpdating} onClick={async () => {
                  try {
                    setTwilioUpdating(true)
                    const r = await fetch('/api/twilio/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: generated.secret }) })
                    const txt = await r.text()
                    const json = txt ? JSON.parse(txt) : {}
                    if (!r.ok || !json?.ok) {
                      const msg = json?.error || `Failed (${r.status})`
                      throw new Error(msg)
                    }
                    toast.success('Twilio webhook updated')
                  } catch (e: any) {
                    toast.error(e?.message || 'Update failed')
                  } finally {
                    setTwilioUpdating(false)
                  }
                }}>{twilioUpdating ? 'Updating…' : 'Apply to Twilio'}</Button>
              </div>
            </div>
            {generated.expiresAt && (
              <p className="text-xs text-neutral-500">Expires at: {new Date(generated.expiresAt * 1000).toLocaleString()}</p>
            )}
          </div>
        )}
      </section>
    </form>
  )
}
