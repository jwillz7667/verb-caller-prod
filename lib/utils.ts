export function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(' ')
}

export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone)
}

export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function getOriginFromRequestUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

export type Maybe<T> = T | null | undefined

export function resolveBaseUrl(reqUrl: string): string {
  const env = process.env.PUBLIC_BASE_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const origin = getOriginFromRequestUrl(reqUrl)
  return origin.replace(/\/$/, '')
}
