import axios from 'axios'
import type { EphemeralRequest } from './validation'

function sanitizeEphemeralPayload(payload: EphemeralRequest) {
  // Deep clone to avoid mutating caller input
  const body: any = JSON.parse(JSON.stringify(payload))
  const allowedSession = new Set(['type', 'model', 'instructions'])
  const s = body.session || {}
  const filteredSession: Record<string, any> = {}
  for (const k of Object.keys(s)) {
    if (allowedSession.has(k)) filteredSession[k] = s[k]
  }
  // Only keep top-level fields allowed by the endpoint
  const cleaned: any = {
    expires_after: body.expires_after,
    session: filteredSession,
  }
  return cleaned
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
  const data = res.data as any
  if (data?.error) {
    const err: any = new Error(data.error?.message || 'OpenAI error')
    err.response = { status: res.status, data }
    throw err
  }
  let value: string | undefined
  let expires_at: number | undefined
  if (data?.client_secret?.value) {
    value = data.client_secret.value
    expires_at = data.client_secret.expires_at
  } else if (typeof data?.client_secret === 'string') {
    value = data.client_secret
    expires_at = data?.expires_at
  } else if (typeof data?.value === 'string') {
    value = data.value
    expires_at = data?.expires_at
  }
  return { client_secret: { value: value as string, expires_at } }
}
