export const runtime = 'edge'

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null
  return Response.json({
    ok: true,
    commit,
    time: new Date().toISOString(),
    routes: [
      '/api/twiml',
      '/api/stream/twilio',
      '/api/stream/logs',
      '/api/live/[sid]/sse',
      '/logs'
    ]
  })
}

