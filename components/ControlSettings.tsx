"use client"
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Toggle } from './ui/Toggle'
import toast from 'react-hot-toast'

type Settings = {
  model?: string  // gpt-realtime or gpt-4o-realtime-preview
  voice?: string  // alloy, echo, shimmer, nova, sage (new 2025 voices)
  tool_choice?: 'auto' | 'required' | 'none' | string  // Can be specific function name
  tools?: any[]
  modalities?: Array<'audio' | 'text' | 'image'>  // Image support added in 2025
  temperature?: number
  max_response_output_tokens?: number | null  // Renamed from max_output_tokens
  turn_detection?:
    | { type: 'none' }
    | {
        type: 'server_vad' | 'semantic_vad'  // semantic_vad added
        threshold?: number
        prefix_padding_ms?: number
        silence_duration_ms?: number
        create_response?: boolean
      }
  input_audio_format?: string  // g711_ulaw, pcm16, etc.
  output_audio_format?: string  // g711_ulaw, pcm16, etc.
  input_audio_transcription?: {
    model: string  // whisper-1
  } | null
  transcription?: {
    enabled: boolean
    model: string
    prompt?: string
    language?: string
    logprobs?: boolean
    include_segments?: boolean
  }
  instructions?: string  // System instructions
  prompt?: { id: string; version?: string }  // Reusable prompts (2025)
}

export default function ControlSettings() {
  const [adminSecret, setAdminSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [s, setS] = useState<Settings>({
    model: 'gpt-realtime',  // Latest 2025 model
    voice: 'alloy',
    tool_choice: 'auto',
    tools: [],
    modalities: ['audio', 'text'],  // Default to audio and text
    temperature: 0.8,
    max_response_output_tokens: 4096,
    turn_detection: { 
      type: 'server_vad', 
      threshold: 0.5, 
      prefix_padding_ms: 300, 
      silence_duration_ms: 500, 
      create_response: true
    },
    input_audio_format: 'pcm16',  // or g711_ulaw for telephony
    output_audio_format: 'pcm16',  // or g711_ulaw for telephony
    input_audio_transcription: null,
    transcription: { enabled: false, model: 'whisper-1' },
    instructions: 'You are a helpful assistant. Be concise and natural in your responses.',
  })

  async function load() {
    try {
      setLoading(true)
      const r = await fetch('/api/realtime/control/settings', { headers: { Authorization: `Bearer ${adminSecret}` } })
      if (r.status === 401) throw new Error('Unauthorized — check admin secret')
      const j = await r.json()
      if (j?.settings) setS({ ...s, ...j.settings })
    } catch (e: any) {
      toast.error(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    try {
      setSaving(true)
      const r = await fetch('/api/realtime/control/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSecret}` },
        body: JSON.stringify({ settings: s }),
      })
      if (r.status === 401) throw new Error('Unauthorized — check admin secret')
      if (!r.ok) throw new Error('Save failed')
      toast.success('Server control settings saved')
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const isVad = s.turn_detection?.type === 'server_vad'
  const vad = (s.turn_detection as any) || {}
  const [rawTools, setRawTools] = useState('')
  useEffect(() => {
    if (Array.isArray(s.tools)) {
      try { setRawTools(JSON.stringify(s.tools, null, 2)) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Server Control Settings</h2>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Input label="Admin Secret (not stored)" placeholder="REALTIME_CONTROL_ADMIN_SECRET" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} />
        <Button type="button" onClick={load} disabled={loading || !adminSecret}>
          {loading ? 'Loading…' : 'Load'}
        </Button>
        <Button type="button" onClick={save} disabled={saving || !adminSecret} className="bg-brand-600 hover:bg-brand-500">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select 
          label="Model" 
          options={[
            { label: 'gpt-realtime (Latest 2025)', value: 'gpt-realtime' },
            { label: 'gpt-4o-realtime-preview', value: 'gpt-4o-realtime-preview' },
            { label: 'gpt-4o-mini-realtime (Coming Soon)', value: 'gpt-4o-mini-realtime' }
          ]} 
          value={s.model || 'gpt-realtime'} 
          onChange={(v) => setS({ ...s, model: v })} 
        />
        <Select 
          label="Voice" 
          options={[
            { label: 'Alloy (Default)', value: 'alloy' },
            { label: 'Echo', value: 'echo' },
            { label: 'Shimmer', value: 'shimmer' },
            { label: 'Nova (New 2025)', value: 'nova' },
            { label: 'Sage (New 2025)', value: 'sage' }
          ]} 
          value={s.voice} 
          onChange={(v) => setS({ ...s, voice: v })} 
        />
        <Select label="Tool Choice" options={[ 'auto','required','none' ].map(v => ({ label: v, value: v }))} value={s.tool_choice} onChange={(v) => setS({ ...s, tool_choice: v as any })} />
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Modalities</label>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.modalities?.includes('audio') || false} onChange={(e) => {
              const set = new Set(s.modalities || [])
              e.target.checked ? set.add('audio') : set.delete('audio')
              setS({ ...s, modalities: Array.from(set) as any })
            }} /> audio</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.modalities?.includes('text') || false} onChange={(e) => {
              const set = new Set(s.modalities || [])
              e.target.checked ? set.add('text') : set.delete('text')
              setS({ ...s, modalities: Array.from(set) as any })
            }} /> text</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.modalities?.includes('image') || false} onChange={(e) => {
              const set = new Set(s.modalities || [])
              e.target.checked ? set.add('image') : set.delete('image')
              setS({ ...s, modalities: Array.from(set) as any })
            }} /> image (2025)</label>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Temperature: {s.temperature}</label>
          <input type="range" min={0} max={2} step={0.1} value={s.temperature ?? 0.7} onChange={(e) => setS({ ...s, temperature: parseFloat(e.target.value) })} />
        </div>
        <Input 
          label="Max Response Tokens (blank=4096)" 
          placeholder="4096" 
          value={s.max_response_output_tokens ?? '' as any} 
          onChange={(e) => setS({ ...s, max_response_output_tokens: e.target.value ? parseInt(e.target.value, 10) : null })} 
        />
        <Select 
          label="Input Audio Format" 
          options={[
            { label: 'PCM16 24kHz', value: 'pcm16' },
            { label: 'G.711 μ-law (Telephony)', value: 'g711_ulaw' },
            { label: 'G.711 A-law', value: 'g711_alaw' }
          ]} 
          value={s.input_audio_format || 'pcm16'} 
          onChange={(v) => setS({ ...s, input_audio_format: v })} 
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select 
          label="Output Audio Format" 
          options={[
            { label: 'PCM16 24kHz', value: 'pcm16' },
            { label: 'G.711 μ-law (Telephony)', value: 'g711_ulaw' },
            { label: 'G.711 A-law', value: 'g711_alaw' }
          ]} 
          value={s.output_audio_format || 'pcm16'} 
          onChange={(v) => setS({ ...s, output_audio_format: v })} 
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select 
          label="Turn Detection" 
          options={[
            { label: 'Server VAD (Silence-based)', value: 'server_vad' },
            { label: 'Semantic VAD (AI-based, 2025)', value: 'semantic_vad' },
            { label: 'None (Manual)', value: 'none' }
          ]} 
          value={s.turn_detection?.type || 'server_vad'} 
          onChange={(v) => setS({ ...s, turn_detection: v === 'none' ? { type: 'none' } : { 
            type: v as 'server_vad' | 'semantic_vad', 
            threshold: vad.threshold ?? 0.5, 
            prefix_padding_ms: vad.prefix_padding_ms ?? 300, 
            silence_duration_ms: vad.silence_duration_ms ?? 500, 
            create_response: vad.create_response ?? true
          }})} 
        />
        {isVad && (
          <>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">VAD Threshold: {vad.threshold ?? 0.5}</label>
              <input type="range" min={0} max={1} step={0.01} value={vad.threshold ?? 0.5} onChange={(e) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', threshold: parseFloat(e.target.value) } })} />
            </div>
            <Input label="Prefix Padding (ms)" type="number" value={vad.prefix_padding_ms ?? 300} onChange={(e) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', prefix_padding_ms: parseInt(e.target.value, 10) } })} />
            <Input label="Silence Duration (ms)" type="number" value={vad.silence_duration_ms ?? 200} onChange={(e) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', silence_duration_ms: parseInt(e.target.value, 10) } })} />
          </>
        )}
      </div>
      {isVad && (
        <div className="mt-2 space-y-3">
          <Toggle 
            label="Auto Create Response" 
            checked={vad.create_response ?? true} 
            onChange={(v) => setS({ ...s, turn_detection: { ...vad, type: s.turn_detection?.type as any, create_response: v } })} 
            hint="Automatically generate response after user turn ends." 
          />
        </div>
      )}

      <div className="mt-6">
        <label className="mb-1 block text-sm text-neutral-300">System Instructions</label>
        <textarea
          className="h-24 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2 text-sm text-white outline-none focus:border-brand-500"
          placeholder="You are a helpful assistant. Be concise and natural in your responses."
          value={s.instructions || ''}
          onChange={(e) => setS({ ...s, instructions: e.target.value })}
        />
        <p className="mt-1 text-xs text-neutral-500">System instructions for the AI assistant's behavior.</p>
      </div>

      <div className="mt-6">
        <label className="mb-1 block text-sm text-neutral-300">Tools (JSON array) - MCP Support (2025)</label>
        <textarea
          className="h-40 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-white outline-none focus:border-brand-500"
          placeholder='[\n  {\n    "type": "mcp_server",\n    "name": "filesystem",\n    "server_url": "ws://localhost:8765",\n    "tools": ["read_file", "write_file"]\n  },\n  {\n    "type": "function",\n    "function": {\n      "name": "get_weather",\n      "description": "Get weather for a location",\n      "parameters": {}\n    }\n  }\n]'
          value={rawTools}
          onChange={(e) => setRawTools(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" onClick={() => {
            try {
              const parsed = rawTools ? JSON.parse(rawTools) : []
              if (!Array.isArray(parsed)) throw new Error('Must be an array')
              setS({ ...s, tools: parsed })
              toast.success('Tools updated in memory')
            } catch (e: any) {
              toast.error(e?.message || 'Invalid JSON')
            }
          }}>Apply Tools</Button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">Define function tools or MCP servers. Supports async function calls (2025).</p>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-medium text-neutral-300">Input Audio Transcription (Optional)</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Toggle 
            label="Enable Transcription" 
            checked={!!s.input_audio_transcription} 
            onChange={(v) => setS({ ...s, input_audio_transcription: v ? { model: 'whisper-1' } : null })} 
          />
          {s.input_audio_transcription && (
            <Select
              label="Transcription Model"
              options={[
                { label: 'Whisper-1', value: 'whisper-1' }
              ]}
              value={s.input_audio_transcription.model || 'whisper-1'}
              onChange={(v) => setS({ ...s, input_audio_transcription: { model: v } })}
            />
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">Transcribe user audio input for logging and analysis.</p>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-medium text-neutral-300">Reusable Prompt (2025 Feature)</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input 
            label="Prompt ID" 
            placeholder="prompt_abc123" 
            value={s.prompt?.id || ''} 
            onChange={(e) => setS({ ...s, prompt: e.target.value ? { ...s.prompt, id: e.target.value } : undefined })} 
          />
          <Input 
            label="Prompt Version (Optional)" 
            placeholder="v1.0" 
            value={s.prompt?.version || ''} 
            onChange={(e) => setS({ ...s, prompt: s.prompt ? { ...s.prompt, version: e.target.value || undefined } : undefined })} 
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500">Use saved prompts across sessions for consistency.</p>
      </div>
    </section>
  )
}
