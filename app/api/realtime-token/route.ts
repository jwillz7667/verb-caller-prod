import { NextRequest } from 'next/server'
import { EphemeralRequestSchema } from '@/lib/validation'
import { createEphemeralClientSecret } from '@/lib/openai'
import { allowClientCredsServer } from '@/lib/config'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = EphemeralRequestSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    const apiKey = allowClientCredsServer() ? (process.env.OPENAI_API_KEY || body.openaiApiKey) : process.env.OPENAI_API_KEY
    if (!apiKey) return Response.json({ error: 'OpenAI API key missing' }, { status: 400 })
    const token = await createEphemeralClientSecret(apiKey, parsed.data)
    if (!token || !token.client_secret || !token.client_secret.value) {
      return Response.json({ error: 'No client_secret returned from OpenAI' }, { status: 502 })
    }
    return Response.json({ client_secret: token.client_secret })
  } catch (e: any) {
    const status = e?.response?.status || 500
    const detail = e?.response?.data || { error: e?.message || 'Internal error' }
    console.error('POST /api/realtime-token error', detail)
    return Response.json(detail, { status })
  }
}
