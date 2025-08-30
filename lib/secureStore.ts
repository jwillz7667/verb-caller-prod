"use client"

// Minimal client-side secure storage helper using Web Crypto API.
// It derives a key from a passphrase and stores cipher text in localStorage.
// Note: This is best-effort only. Do NOT rely on this for high-security secrets.

async function deriveKey(passphrase: string) {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('aivoicecaller-salt'), iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptAndStore(key: string, value: string, passphrase: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await deriveKey(passphrase)
  const enc = new TextEncoder()
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(value))
  const bytes = new Uint8Array(cipher)
  const payload = {
    iv: Array.from(iv),
    data: Array.from(bytes)
  }
  localStorage.setItem(key, JSON.stringify(payload))
}

export async function loadAndDecrypt(key: string, passphrase: string): Promise<string | null> {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const { iv, data } = JSON.parse(raw)
  const k = await deriveKey(passphrase)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, k, new Uint8Array(data))
  const dec = new TextDecoder()
  return dec.decode(plain)
}

export function clearStored(key: string) {
  localStorage.removeItem(key)
}

