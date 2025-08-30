import { NextRequest } from 'next/server'
import { getRealtimeControlSettings, setRealtimeControlSettings, RealtimeControlSettings } from '@/lib/realtimeControl'

export const runtime = 'nodejs'

function verifyAdmin(req: NextRequest) {
  const admin = process.env.REALTIME_CONTROL_ADMIN_SECRET
  if (!admin) return false
  const auth = req.headers.get('authorization') || ''
  return auth.startsWith('Bearer ') && auth.slice(7) === admin
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

