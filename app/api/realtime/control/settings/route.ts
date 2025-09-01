import { NextRequest } from 'next/server'
import { getRealtimeControlSettings, setRealtimeControlSettings, RealtimeControlSettings } from '@/lib/realtimeControl'
import crypto from 'crypto'

export const runtime = 'nodejs'

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return crypto.timingSafeEqual(bufA, bufB)
}

function verifyAdmin(req: NextRequest): boolean {
  const admin = process.env.REALTIME_CONTROL_ADMIN_SECRET
  if (!admin || admin.length < 32) return false // Require strong secret
  
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  
  const token = auth.slice(7)
  return timingSafeEqual(token, admin)
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const s = getRealtimeControlSettings()
  return Response.json({ settings: s || null })
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = (await req.json()) as { settings: RealtimeControlSettings | null }
    setRealtimeControlSettings(body?.settings || null)
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Invalid body' }, { status: 400 })
  }
}

