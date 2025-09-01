import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const required: Record<string, boolean> = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: !!process.env.TWILIO_FROM_NUMBER,
  }
  const optional: Record<string, boolean> = {
    PUBLIC_BASE_URL: !!process.env.PUBLIC_BASE_URL,
    OPENAI_ORG_ID: !!process.env.OPENAI_ORG_ID,
    OPENAI_PROJECT_ID: !!process.env.OPENAI_PROJECT_ID,
    TWILIO_STATUS_CALLBACK_URL: !!process.env.TWILIO_STATUS_CALLBACK_URL,
  }
  const ok = Object.values(required).every(Boolean)
  return Response.json({ ok, required, optional })
}

