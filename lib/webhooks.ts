import crypto from 'crypto'

function timingSafeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function parseSignatureHeader(sig: string | null | undefined) {
  if (!sig) return null
  // Accept raw signature or key=value pairs like "v1=..." or "sha256=..."
  if (sig.includes('=')) {
    const parts = sig.split(',').map((p) => p.trim())
    const m: Record<string, string> = {}
    for (const p of parts) {
      const [k, v] = p.split('=')
      if (k && v) m[k] = v
    }
    return m['v1'] || m['sha256'] || Object.values(m)[0] || null
  }
  return sig
}

export function verifyHmacSignature({
  rawBody,
  signature,
  secret,
  timestamp,
  toleranceSeconds = 300,
}: {
  rawBody: string
  signature: string | null | undefined
  secret: string
  timestamp?: string | null
  toleranceSeconds?: number
}) {
  const sig = parseSignatureHeader(signature)
  if (!sig) return false

  const ts = timestamp || ''
  if (ts) {
    const now = Math.floor(Date.now() / 1000)
    const t = parseInt(ts as string, 10)
    if (Number.isFinite(t) && Math.abs(now - t) > toleranceSeconds) return false
  }

  const payload = ts ? `${ts}.${rawBody}` : rawBody
  const h = crypto.createHmac('sha256', secret).update(payload)
  const expectedHex = h.digest('hex')
  const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64')

  const provided = sig.replace(/^sha256=/, '')
  const a = Buffer.from(provided)
  const bHex = Buffer.from(expectedHex)
  const bB64 = Buffer.from(expectedBase64)

  return timingSafeEqual(a, bHex) || timingSafeEqual(a, bB64)
}

