import { NextRequest } from 'next/server'
import { createClient } from 'redis'

export const runtime = 'nodejs'

function getRedis() {
  const url = process.env.REDIS_URL || ''
  if (!url) throw new Error('REDIS_URL not set')
  const client = createClient({ url })
  return client
}

export async function GET(req: NextRequest, { params }: { params: { sid: string } }) {
  const sid = params.sid
  if (!sid) return new Response('Missing sid', { status: 400 })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const key = `transcript:${sid}`
      const r = getRedis()
      await r.connect()
      let cursor = 0
      const ping = setInterval(() => controller.enqueue(enc.encode(`: ping\n\n`)), 15000)

      const loop = async () => {
        try {
          while (true) {
            const len = await r.lLen(key)
            if (len > cursor) {
              const items = await r.lRange(key, cursor, len - 1)
              for (const raw of items) {
                controller.enqueue(enc.encode(`event: line\n`))
                controller.enqueue(enc.encode(`data: ${raw}\n\n`))
              }
              cursor = len
            }
            await new Promise((res) => setTimeout(res, 700))
          }
        } catch (e) {
          // fallthrough to finally
        } finally {
          clearInterval(ping)
          try { await r.quit() } catch {}
          try { controller.close() } catch {}
        }
      }
      loop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    }
  })
}

