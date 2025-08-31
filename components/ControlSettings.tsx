"use client"
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Toggle } from './ui/Toggle'
import toast from 'react-hot-toast'

type Settings = {
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
        semantic?: boolean
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

export default function ControlSettings() {
  const [adminSecret, setAdminSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [s, setS] = useState<Settings>({
    voice: 'alloy',
    tool_choice: 'auto',
    modalities: ['audio'],
    temperature: 0.7,
    max_output_tokens: null,
    turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 200, create_response: true, interrupt_response: true, semantic: false },
    input_audio_format: { type: 'audio/pcm', rate: 24000 },
    transcription: { enabled: false, model: 'gpt-4o-transcribe' },
    noise_reduction: 'near_field',
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
        <Select label="Voice" options={[ 'alloy','echo','fable','onyx','nova','shimmer' ].map(v => ({ label: v, value: v }))} value={s.voice} onChange={(v) => setS({ ...s, voice: v })} />
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
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Temperature: {s.temperature}</label>
          <input type="range" min={0} max={2} step={0.1} value={s.temperature ?? 0.7} onChange={(e) => setS({ ...s, temperature: parseFloat(e.target.value) })} />
        </div>
        <Input label="Max Output Tokens (blank=inf)" placeholder="" value={s.max_output_tokens ?? '' as any} onChange={(e) => setS({ ...s, max_output_tokens: e.target.value ? parseInt(e.target.value, 10) : null })} />
        <Select label="Noise Reduction" options={[ {label: 'near_field', value:'near_field'}, {label: 'none', value: 'none'} ]} value={s.noise_reduction || 'near_field'} onChange={(v) => setS({ ...s, noise_reduction: v as any })} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select label="Turn Detection" options={[ {label:'server_vad', value:'server_vad'}, {label:'none', value:'none'} ]} value={s.turn_detection?.type || 'server_vad'} onChange={(v) => setS({ ...s, turn_detection: v === 'none' ? { type: 'none' } : { type: 'server_vad', threshold: vad.threshold ?? 0.5, prefix_padding_ms: vad.prefix_padding_ms ?? 300, silence_duration_ms: vad.silence_duration_ms ?? 200, create_response: vad.create_response ?? true, interrupt_response: vad.interrupt_response ?? true, semantic: vad.semantic ?? false } })} />
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
          <Toggle label="Semantic VAD (experimental)" checked={!!vad.semantic} onChange={(v) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', semantic: v } })} hint="Enable semantic-based end-of-turn detection." />
          <Toggle label="Auto Create Response" checked={vad.create_response ?? true} onChange={(v) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', create_response: v } })} hint="If off, responses are triggered manually." />
          <Toggle label="Interrupt Response" checked={vad.interrupt_response ?? true} onChange={(v) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', interrupt_response: v } })} hint="Allow barge-in to stop TTS." />
          <Input label="Idle Timeout (ms, optional)" type="number" value={vad.idle_timeout_ms ?? ''} onChange={(e) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', idle_timeout_ms: e.target.value ? parseInt(e.target.value, 10) : undefined } })} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Toggle label="Transcription" checked={!!s.transcription?.enabled} onChange={(v) => setS({ ...s, transcription: { ...(s.transcription || { model: 'gpt-4o-transcribe' }), enabled: v } })} />
        {s.transcription?.enabled && (
          <>
            <Input label="Transcription Model" value={s.transcription?.model || 'gpt-4o-transcribe'} onChange={(e) => setS({ ...s, transcription: { ...(s.transcription as any), model: e.target.value } })} />
            <Input label="Language" value={s.transcription?.language || ''} onChange={(e) => setS({ ...s, transcription: { ...(s.transcription as any), language: e.target.value } })} />
            <Input label="Prompt" value={s.transcription?.prompt || ''} onChange={(e) => setS({ ...s, transcription: { ...(s.transcription as any), prompt: e.target.value } })} />
          </>
        )}
      </div>
    </section>
  )
}
