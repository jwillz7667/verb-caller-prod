// Minimal typings for OpenAI Realtime events (August 2025 snapshot)
// This is not exhaustive; it captures common fields for logging and basic handling.
export type ClientEvent =
  | { type: 'session.update'; session?: any }
  | { type: 'input_audio_buffer.append'; audio?: string }
  | { type: 'input_audio_buffer.commit' }
  | { type: 'input_audio_buffer.clear' }
  | { type: 'conversation.item.create'; item?: any }
  | { type: 'conversation.item.delete'; id: string }
  | { type: 'conversation.item.truncate'; id: string }
  | { type: 'response.create'; response?: any }
  | { type: 'response.cancel'; id?: string }
  | { type: 'transcription_session.update'; params?: any }

export type ServerEvent =
  | { type: 'error'; error: { message: string; code?: string } }
  | { type: 'session.created'; session: any }
  | { type: 'session.updated'; session: any }
  | { type: 'transcription_session.created'; session: any }
  | { type: 'conversation.item.created'; item: any }
  | { type: 'conversation.item.added'; item: any }
  | { type: 'conversation.item.done'; item: any }
  | { type: 'conversation.item.retrieved'; item: any }
  | { type: 'conversation.item.input_audio_transcription.completed'; item: any; text?: string }
  | { type: 'conversation.item.delta'; delta?: any }
  | { type: 'conversation.item.segment'; segment?: any }
  | { type: 'conversation.item.failed'; reason?: string }
  | { type: 'conversation.item.truncated'; id?: string }
  | { type: 'conversation.item.deleted'; id: string }
  | { type: 'input_audio_buffer.committed' }
  | { type: 'input_audio_buffer.cleared' }
  | { type: 'input_audio_buffer.speech_started' }
  | { type: 'input_audio_buffer.speech_stopped' }
  | { type: 'input_audio_buffer.timeout_triggered' }
  | { type: 'response.created'; response: any }
  | { type: 'response.done'; response: any }

export type AnyEvent = ClientEvent | ServerEvent

export function safeParseEvent(data: any): AnyEvent | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.type !== 'string') return null
  return data as AnyEvent
}

