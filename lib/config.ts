export const isProd = process.env.NODE_ENV === 'production'

export function allowClientCredsServer() {
  // Only allow if explicitly enabled; safest default is false
  return process.env.ALLOW_CLIENT_CREDS === 'true' && !isProd
}

export function allowClientCredsClient() {
  // Client reads build-time NEXT_PUBLIC_ flag
  return process.env.NEXT_PUBLIC_ALLOW_CLIENT_CREDS === 'true'
}

