import { describe, expect, it } from '@jest/globals'
import { OutgoingCallSchema, RealtimeSessionSchema } from '@/lib/validation'

describe('validation', () => {
  it('validates E.164 phone', () => {
    const res = OutgoingCallSchema.safeParse({
      toNumber: '+15551231234',
      record: true,
      ephemeral: {
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          instructions: 'hello',
        }
      }
    })
    expect(res.success).toBe(true)
  })

  it('rejects bad phone', () => {
    const res = OutgoingCallSchema.safeParse({
      toNumber: '555-123',
      record: true,
      ephemeral: {
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          instructions: 'hello',
        }
      }
    })
    expect(res.success).toBe(false)
  })
})

