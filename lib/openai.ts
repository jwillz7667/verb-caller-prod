import axios from 'axios'
import type { EphemeralRequest } from './validation'

function sanitizeEphemeralPayload(payload: EphemeralRequest) {
  // Deep clone to avoid mutating caller input
  const body: any = JSON.parse(JSON.stringify(payload))
  const s = body.session || {}
  if (s && s.max_output_tokens === 'inf') {
    delete s.max_output_tokens
  }
  if (s && Array.isArray(s.embedded_media) && s.embedded_media.length === 0) {
    delete s.embedded_media
  }
  if (s && s.transcription && (s.transcription.enabled === false || s.transcription.enabled === undefined)) {
    delete s.transcription
  }
  body.session = s
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
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  )
  return res.data as { client_secret: { value: string; expires_at?: number } }
}
