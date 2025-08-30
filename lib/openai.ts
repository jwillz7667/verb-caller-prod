import axios from 'axios'
import type { EphemeralRequest } from './validation'

export async function createEphemeralClientSecret(apiKey: string, payload: EphemeralRequest) {
  const res = await axios.post(
    'https://api.openai.com/v1/realtime/client_secrets',
    payload,
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

