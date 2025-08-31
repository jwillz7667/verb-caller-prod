export const runtime = 'edge'

import { listTranscriptFrom } from '@/lib/live'

export async function GET(_: Request, { params }: { params: { sid: string } }) {
  const sid = params.sid
  if (!sid) return new Response('Missing sid', { status: 400 })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      let cursor = 0
      let alive = true
      // ping every 15s
      const ping = () => controller.enqueue(enc.encode(`: ping\n\n`))
      let pingTimer: any = setInterval(ping, 15000)

      const drain = async () => {
        try {
          while (alive) {
            const { items, next } = await listTranscriptFrom(sid, cursor)
            if (items.length > 0) {
              for (const raw of items) {
                controller.enqueue(enc.encode(`event: line\n`))
                controller.enqueue(enc.encode(`data: ${raw}\n\n`))
              }
              cursor = next
            }
            // backoff
            await new Promise((r) => setTimeout(r, 700))
          }
        } catch (e) {
          // end on error
          alive = false
        } finally {
          clearInterval(pingTimer)
          try { controller.close() } catch {}
        }
      }
      drain()
    },
    cancel() {}
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    }
  })
}

