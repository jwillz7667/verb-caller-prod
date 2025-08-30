import type { Twilio } from 'twilio'
import twilioFactory from 'twilio'

export function getTwilioClient(opts?: { sid?: string; token?: string }) {
  const accountSid = opts?.sid || process.env.TWILIO_ACCOUNT_SID
  const authToken = opts?.token || process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials are missing')
  }
  return twilioFactory(accountSid, authToken) as Twilio
}

export function getTwilioFromNumber(fallback?: string) {
  return fallback || process.env.TWILIO_FROM_NUMBER || ''
}

