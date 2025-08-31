export type TranscriptEvent = {
  t: number
  type: 'audio_transcript.delta' | 'text.delta' | 'transcript'
  text: string
}

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

// In-memory fallback for local dev only (not reliable on serverless)
const memoryStore: Map<string, TranscriptEvent[]> = (globalThis as any).__memLive || new Map()
;(globalThis as any).__memLive = memoryStore

function kvAvailable() {
  return !!(KV_URL && KV_TOKEN)
}

async function getKv() {
  if (!kvAvailable()) return null as any
  // Lazy import to avoid bundling when unused
  const mod = await import('@vercel/kv')
  return mod.kv
}

export async function publishTranscript(key: string, ev: TranscriptEvent) {
  const k = `transcript:${key}`
  if (kvAvailable()) {
    const kv = await getKv()
    await kv.rpush(k, JSON.stringify(ev))
    // keep for 30 minutes
    await kv.expire(k, 60 * 30)
  } else {
    const arr = memoryStore.get(k) || []
    arr.push(ev)
    memoryStore.set(k, arr)
  }
}

export async function listTranscriptFrom(key: string, fromIndex: number) {
  const k = `transcript:${key}`
  if (kvAvailable()) {
    const kv = await getKv()
    const len: number = (await kv.llen(k)) || 0
    if (len <= fromIndex) return { items: [] as string[], next: len }
    const items: string[] = await kv.lrange(k, fromIndex, len - 1)
    return { items, next: len }
  }
  const arr = memoryStore.get(k) || []
  const items = arr.slice(fromIndex).map((e) => JSON.stringify(e))
  return { items, next: fromIndex + items.length }
}
