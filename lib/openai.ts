import axios from 'axios'
import type { EphemeralRequest } from './validation'

function sanitizeEphemeralPayload(payload: EphemeralRequest) {
  // Deep clone to avoid mutating caller input
  const body: any = JSON.parse(JSON.stringify(payload))
  const s = body.session || {}
  // Whitelist only fields that the client_secrets endpoint accepts.
  const allowed = new Set(['type', 'model', 'instructions'])
  const filtered: Record<string, any> = {}
  for (const k of Object.keys(s)) {
    if (allowed.has(k)) filtered[k] = s[k]
  }
  body.session = filtered
  return body
}

export async function createEphemeralClientSecret(apiKey: string, payload: EphemeralRequest) {
  const body = sanitizeEphemeralPayload(payload)
  const res = await axios.post(
    'https://api.openai.com/v1/realtime/client_secrets',
    body,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      timeout: 15000
    }
  )
  return res.data as { client_secret: { value: string; expires_at?: number } }
}
