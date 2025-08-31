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
  instructions?: string
  promptId?: string
  promptVersion?: string
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
        instructions: z.string().optional(),
        promptId: z.string().optional(),
        promptVersion: z.string().optional(),
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
      }).refine((v) => (v.instructions && v.instructions.trim().length > 0) || (v.promptId && v.promptId.trim().length > 0), {
        path: ['instructions'],
        message: 'Provide Instructions or a Prompt ID.'
      })
    ),
    defaultValues: {
      toNumber: '',
      record: true,
      expiresSeconds: 600,
      model: 'gpt-realtime',
      instructions: defaultInstructions,
      promptId: '',
      promptVersion: '',
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
      promptId,
      promptVersion,
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
        promptId,
        promptVersion,
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
        ...(values.instructions && values.instructions.trim().length > 0 ? { instructions: values.instructions } : {}),
        ...(values.promptId && values.promptId.trim().length > 0 ? { prompt: { id: values.promptId, ...(values.promptVersion && values.promptVersion.trim().length > 0 ? { version: values.promptVersion } : {}) } } : {}),
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
        ...(v.instructions && v.instructions.trim().length > 0 ? { instructions: v.instructions } : {}),
        ...(v.promptId && v.promptId.trim().length > 0 ? { prompt: { id: v.promptId, ...(v.promptVersion && v.promptVersion.trim().length > 0 ? { version: v.promptVersion } : {}) } } : {}),
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
        if ((session as any).instructions) update.session.instructions = (session as any).instructions
        if ((session as any).prompt) update.session.prompt = (session as any).prompt
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
        ...(v.instructions && v.instructions.trim().length > 0 ? { instructions: v.instructions } : {}),
        ...(v.promptId && v.promptId.trim().length > 0 ? { prompt: { id: v.promptId, ...(v.promptVersion && v.promptVersion.trim().length > 0 ? { version: v.promptVersion } : {}) } } : {}),
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
      const sipUri = `sips:${secret}@sip.openai.com`
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
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-6 md:grid-cols-[320px,1fr]">
      {/* Sidebar: Settings (Playground-like) */}
      <aside className="sticky top-[76px] h-[calc(100vh-120px)] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">Settings</h2>
          <div className="flex items-center gap-2">
            <Button type="button" className="px-3 py-1 text-xs" onClick={onSavePreset}>Save</Button>
            <Button type="button" className="px-3 py-1 text-xs" onClick={testWebSocket}>Test</Button>
          </div>
        </div>
        <div className="space-y-4">
          <Controller control={form.control} name="model" render={({ field }) => (
            <Select label="Model" options={[{label:'gpt-realtime', value:'gpt-realtime'},{label:'gpt-4o-realtime-preview', value:'gpt-4o-realtime-preview'}]} value={field.value} onChange={field.onChange} />
          )} />
          <Controller control={form.control} name="voice" render={({ field }) => (
            <Select label="Voice" options={['alloy','echo','fable','onyx','nova','shimmer'].map(v=>({label:v,value:v}))} value={field.value} onChange={field.onChange} />
          )} />
          <Controller control={form.control} name="tool_choice" render={({ field }) => (
            <Select label="Tool Choice" options={['auto','required','none'].map(v=>({label:v,value:v}))} value={field.value} onChange={field.onChange} />
          )} />
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Temperature: {form.watch('temperature')}</label>
            <input type="range" min={0} max={2} step={0.1} {...form.register('temperature', { valueAsNumber: true })} />
          </div>
          <Input label="Max Tokens" placeholder="inf or number" {...form.register('max_output_tokens')} />
          <Textarea label="Instructions" rows={5} {...form.register('instructions')} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Prompt ID" placeholder="pmpt_..." {...form.register('promptId')} />
            <Input label="Version" placeholder="2" {...form.register('promptVersion')} />
          </div>
          <Controller control={form.control} name="turn_detection" render={({ field }) => (
            <Select label="Turn Detection" options={[{label:'server_vad', value:'server_vad'},{label:'none', value:'none'}]} value={field.value} onChange={field.onChange} />
          )} />
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
          <Controller control={form.control} name="noise_reduction" render={({ field }) => (
            <Select label="Noise Reduction" options={[{label:'near_field', value:'near_field'},{label:'none', value:'none'}]} value={field.value} onChange={field.onChange} />
          )} />
          <Input label="Input Audio Rate" type="number" {...form.register('input_audio_rate', { valueAsNumber: true })} />
          <Controller control={form.control} name="transcription_enabled" render={({ field }) => (
            <Toggle label="Transcription" checked={field.value} onChange={field.onChange} />
          )} />
          {form.watch('transcription_enabled') && (
            <>
              <Input label="Transcription Model" {...form.register('transcription_model')} />
              <Input label="Language" {...form.register('transcription_language')} />
              <Input label="Prompt" {...form.register('transcription_prompt')} />
            </>
          )}
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Tools (JSON Schema)</label>
            <Textarea ref={toolJsonRef} placeholder='{"name":"search","description":"...","parameters":{"type":"object","properties":{"q":{"type":"string"}}}}' value={toolJson} onChange={(e) => setToolJson(e.target.value)} />
            <div className="mt-2 flex gap-2"><Button type="button" className="px-3 py-1 text-xs" onClick={addTool}>Add Tool</Button></div>
            {tools.length > 0 && (
              <ul className="mt-3 divide-y divide-neutral-800 rounded-md border border-neutral-800">
                {tools.map((t,i)=> (
                  <li key={i} className="flex items-center justify-between gap-4 p-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="truncate text-xs text-neutral-400">{t.description}</p>
                    </div>
                    <Button type="button" className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30" onClick={() => removeTool(i)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Attach Images (optional)</label>
            <input type="file" multiple accept="image/*" onChange={(e) => form.setValue('imageFiles', e.target.files)} />
          </div>
          <div className="border-t border-neutral-800 pt-3">
            <label className="mb-1 block text-sm text-neutral-300">Client Secret (optional)</label>
            <Button type="button" onClick={generateClientSecret} disabled={genLoading} className="w-full bg-brand-600 hover:bg-brand-500">{genLoading ? 'Generating…' : 'Generate'}</Button>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" role="switch" aria-checked={autoUpdateTwilio} onClick={() => setAutoUpdateTwilio((v) => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${autoUpdateTwilio ? 'bg-brand-600' : 'bg-neutral-700'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${autoUpdateTwilio ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-xs text-neutral-400">Auto-update Twilio webhook</span>
            </div>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <button type="button" role="switch" aria-checked={includeServerWebhook} onClick={() => setIncludeServerWebhook((v) => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${includeServerWebhook ? 'bg-brand-600' : 'bg-neutral-700'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${includeServerWebhook ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-xs text-neutral-400">Attach server control webhook</span>
              </div>
              <p className="text-[11px] text-neutral-500">Prod: https://verbio.app/api/realtime/control</p>
              <p className="text-[11px] text-neutral-500">This Host: {hostOrigin ? `${hostOrigin}/api/realtime/control` : '—'}</p>
              {includeServerWebhook && (
                <Input label="Webhook Secret" placeholder="Authorization: Bearer" value={serverSecret} onChange={(e) => setServerSecret(e.target.value)} />
              )}
            </div>
            {generated && (
              <div className="mt-2 space-y-2 rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                <p className="truncate font-mono text-[11px]"><span className="text-neutral-400">Client Secret: </span>{generated.secret}</p>
                <p className="truncate font-mono text-[11px]"><span className="text-neutral-400">SIP: </span>{generated.sipUri}</p>
                <p className="truncate font-mono text-[11px]"><span className="text-neutral-400">Twilio (prod): </span>{generated.twimlProd}</p>
                <p className="truncate font-mono text-[11px]"><span className="text-neutral-400">Twilio (this): </span>{generated.twimlLocal}</p>
                <div className="flex items-center justify-end gap-2">
                  <CopyButton value={generated.twimlLocal} />
                  <Button type="button" className="px-3 py-1 text-xs" disabled={twilioUpdating} onClick={async () => {
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
                  }}>{twilioUpdating ? 'Updating…' : 'Apply'}</Button>
                </div>
                {generated.expiresAt && (
                  <p className="text-[11px] text-neutral-500">Expires: {new Date(generated.expiresAt * 1000).toLocaleString()}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main: Live Call + Transcript */}
      <section className="space-y-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live Call</h2>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input label="To (E.164)" placeholder="+15551234567" {...form.register('toNumber')} />
            <Controller control={form.control} name="record" render={({ field }) => (
              <Toggle label="Record" checked={field.value} onChange={field.onChange} />
            )} />
            <Input label="Expires (sec)" type="number" placeholder="600" {...form.register('expiresSeconds', { valueAsNumber: true })} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" className="bg-brand-600 hover:bg-brand-500">Start Outgoing Call</Button>
            <Button type="button" onClick={testWebSocket}>Test WS</Button>
          </div>
        </div>

        <div className="h-[56vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <h3 className="mb-2 text-sm font-medium text-neutral-300">Transcription</h3>
          <div className="space-y-2 text-sm leading-relaxed">
            <p className="text-neutral-500">Live transcription will appear here during an active call.</p>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <h2 className="mb-2 text-lg font-semibold">Incoming Calls Setup</h2>
          <p className="text-sm text-neutral-400">Set your Twilio number Voice webhook to <code className="rounded bg-neutral-900 px-2 py-1">/api/twiml</code>. The server mints a fresh ephemeral secret and bridges to OpenAI SIP over TLS.</p>
        </div>
      </section>
    </form>
  )
}
