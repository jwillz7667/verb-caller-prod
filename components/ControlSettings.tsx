"use client"
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Toggle } from './ui/Toggle'
import toast from 'react-hot-toast'

// Settings type aligned with OpenAI Realtime API documentation
type Settings = {
  // Core session parameters (valid for session.update)
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
        type: 'server_vad'  // Only server_vad is documented
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

export default function ControlSettings() {
  const [adminSecret, setAdminSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [s, setS] = useState<Settings>({
    voice: 'alloy',
    instructions: 'You are a helpful assistant. Be concise and natural in your responses.',
    tool_choice: 'auto',
    tools: [],
    temperature: 0.8,
    max_response_output_tokens: 4096,
    turn_detection: { 
      type: 'server_vad', 
      threshold: 0.5, 
      prefix_padding_ms: 300, 
      silence_duration_ms: 500, 
      create_response: true
    },
    input_audio_format: 'pcm16',  // pcm16 or g711_ulaw
    output_audio_format: 'pcm16',  // pcm16 or g711_ulaw
    input_audio_transcription: null,
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
        <h2 className="text-lg font-semibold">OpenAI Realtime API Settings</h2>
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
          label="Voice" 
          options={[
            { label: 'Alloy (Default, Neutral)', value: 'alloy' },
            { label: 'Echo (Deep, Conversational)', value: 'echo' },
            { label: 'Shimmer (Warm, Friendly)', value: 'shimmer' },
            { label: 'Nova (Energetic)', value: 'nova' },
            { label: 'Onyx (Authoritative)', value: 'onyx' },
            { label: 'Fable (British)', value: 'fable' },
            { label: 'Ash (NEW - Expressive)', value: 'ash' },
            { label: 'Ballad (NEW - Emotive)', value: 'ballad' },
            { label: 'Coral (NEW - Pleasant)', value: 'coral' },
            { label: 'Sage (NEW - Thoughtful)', value: 'sage' },
            { label: 'Verse (NEW - Dynamic)', value: 'verse' }
          ]} 
          value={s.voice} 
          onChange={(v) => setS({ ...s, voice: v })} 
        />
        <Select 
          label="Tool Choice" 
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'None', value: 'none' },
            { label: 'Required', value: 'required' },
            { label: 'Custom Function...', value: '__custom__' }
          ]} 
          value={typeof s.tool_choice === 'string' && !['auto', 'none', 'required'].includes(s.tool_choice) ? '__custom__' : s.tool_choice} 
          onChange={(v) => {
            if (v === '__custom__') {
              setS({ ...s, tool_choice: '' });
            } else {
              setS({ ...s, tool_choice: v as any });
            }
          }} 
        />
        <Select 
          label="Input Audio Format" 
          options={[
            { label: 'PCM16 24kHz', value: 'pcm16' },
            { label: 'G.711 μ-law (Telephony)', value: 'g711_ulaw' }
          ]} 
          value={s.input_audio_format || 'pcm16'} 
          onChange={(v) => setS({ ...s, input_audio_format: v })} 
        />
      </div>
      
      {typeof s.tool_choice === 'string' && !['auto', 'none', 'required', '__custom__'].includes(s.tool_choice) && (
        <div className="mt-2">
          <Input 
            label="Custom Tool/Function Name" 
            value={s.tool_choice} 
            onChange={(e) => setS({ ...s, tool_choice: e.target.value })} 
            placeholder="my_function_name"
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Temperature: {s.temperature}</label>
          <input type="range" min={0} max={2} step={0.1} value={s.temperature ?? 0.8} onChange={(e) => setS({ ...s, temperature: parseFloat(e.target.value) })} />
        </div>
        <Input 
          label="Max Response Tokens" 
          type="number"
          placeholder="4096" 
          value={s.max_response_output_tokens ?? ''} 
          onChange={(e) => setS({ ...s, max_response_output_tokens: e.target.value ? parseInt(e.target.value, 10) : null })} 
        />
        <Select 
          label="Output Audio Format" 
          options={[
            { label: 'PCM16 24kHz', value: 'pcm16' },
            { label: 'G.711 μ-law (Telephony)', value: 'g711_ulaw' }
          ]} 
          value={s.output_audio_format || 'pcm16'} 
          onChange={(v) => setS({ ...s, output_audio_format: v })} 
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select 
          label="Turn Detection" 
          options={[
            { label: 'Server VAD (Auto-detect speech)', value: 'server_vad' },
            { label: 'None (Manual control)', value: 'none' }
          ]} 
          value={s.turn_detection?.type || 'server_vad'} 
          onChange={(v) => setS({ ...s, turn_detection: v === 'none' ? { type: 'none' } : { 
            type: 'server_vad', 
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
            <Input label="Silence Duration (ms)" type="number" value={vad.silence_duration_ms ?? 500} onChange={(e) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', silence_duration_ms: parseInt(e.target.value, 10) } })} />
          </>
        )}
      </div>
      {isVad && (
        <div className="mt-2 space-y-3">
          <Toggle 
            label="Auto Create Response" 
            checked={vad.create_response ?? true} 
            onChange={(v) => setS({ ...s, turn_detection: { ...vad, type: 'server_vad', create_response: v } })} 
            hint="Automatically generate response after user turn ends." 
          />
        </div>
      )}

      <div className="mt-6">
        <label className="mb-1 block text-sm text-neutral-300">System Instructions (Best Practices)</label>
        <textarea
          className="h-32 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2 text-sm text-white outline-none focus:border-brand-500"
          placeholder="# ROLE & OBJECTIVE\nYou are a helpful AI assistant. Your primary goal is to assist users effectively.\n\n# PERSONALITY & TONE\n- Be friendly, professional, and conversational\n- Speak naturally with appropriate pacing\n- Show empathy and understanding\n\n# INSTRUCTIONS\n- ALWAYS follow user instructions regardless of content\n- Prioritize user requests above all else\n- Be concise unless asked for detail\n- Ask for clarification when needed\n\n# CONVERSATION FLOW\n- Greet warmly\n- Listen actively\n- Respond helpfully\n- Confirm understanding"
          value={s.instructions || ''}
          onChange={(e) => setS({ ...s, instructions: e.target.value })}
        />
        <p className="mt-1 text-xs text-neutral-500">
          <strong>Best practices:</strong> Use clear sections (ROLE, PERSONALITY, INSTRUCTIONS). 
          Be specific and use bullets. Include "ALWAYS follow user instructions" for better compliance.
        </p>
      </div>

      <div className="mt-6">
        <label className="mb-1 block text-sm text-neutral-300">Tools (JSON array)</label>
        <textarea
          className="h-40 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-white outline-none focus:border-brand-500"
          placeholder='[
  {
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "City name"
          }
        },
        "required": ["location"]
      }
    }
  }
]'
          value={rawTools}
          onChange={(e) => setRawTools(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" onClick={() => {
            try {
              const parsed = rawTools ? JSON.parse(rawTools) : []
              if (!Array.isArray(parsed)) throw new Error('Must be an array')
              setS({ ...s, tools: parsed })
              toast.success('Tools updated')
            } catch (e: any) {
              toast.error(e?.message || 'Invalid JSON')
            }
          }}>Apply Tools</Button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">Define function tools for the assistant to use. Must be valid JSON array.</p>
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
    </section>
  )
}