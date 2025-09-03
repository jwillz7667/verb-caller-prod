# OpenAI Realtime API - 2025 Best Practices & Event Types

## Latest Updates (September 1, 2025)

### New Features
- **gpt-realtime model**: 66.5% function calling accuracy (vs 49.7% for Dec 2024 model)
- **No session limits**: Unlimited simultaneous sessions as of Feb 3, 2025
- **Image support**: Send images alongside audio/text
- **MCP server support**: Automatic tool handling via Model Context Protocol
- **Async function calling**: Long-running functions don't block conversation
- **Reusable prompts**: Save and reuse prompts across sessions
- **SIP support**: Direct phone network integration
- **New voices**: Nova and Sage added (Oct 2024)

### Models Available
- `gpt-realtime` - Latest production model (recommended)
- `gpt-4o-realtime-preview` - Previous generation
- `gpt-4o-mini-realtime` - Coming soon (lightweight version)

### Voice Options
- `alloy` - Default, balanced voice
- `echo` - Warm, conversational
- `shimmer` - Expressive, energetic
- `nova` - NEW 2025: Natural, refined
- `sage` - NEW 2025: Authoritative, clear

## Complete Event Type Reference

### Client Events (Client → Server)

#### 1. session.update
Updates session configuration. Send after `session.created`.
```json
{
  "type": "session.update",
  "session": {
    "modalities": ["audio", "text"],
    "voice": "alloy",
    "instructions": "System instructions",
    "input_audio_format": "g711_ulaw",
    "output_audio_format": "g711_ulaw",
    "input_audio_transcription": {
      "model": "whisper-1"
    },
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "prefix_padding_ms": 300,
      "silence_duration_ms": 500,
      "create_response": true
    },
    "tools": [],
    "tool_choice": "auto",
    "temperature": 0.8,
    "max_response_output_tokens": 4096
  }
}
```

#### 2. input_audio_buffer.append
Adds audio to the input buffer.
```json
{
  "type": "input_audio_buffer.append",
  "audio": "base64_encoded_audio"
}
```

#### 3. input_audio_buffer.commit
Commits audio buffer to create a user message.
```json
{
  "type": "input_audio_buffer.commit"
}
```

#### 4. input_audio_buffer.clear
Clears the audio input buffer.
```json
{
  "type": "input_audio_buffer.clear"
}
```

#### 5. conversation.item.create
Adds items to conversation context.
```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "Hello"
      }
    ]
  }
}
```

#### 6. conversation.item.truncate
Truncates an ongoing assistant response (for barge-in).
```json
{
  "type": "conversation.item.truncate",
  "item_id": "item_abc123",
  "content_index": 0,
  "audio_end_ms": 1500
}
```

#### 7. conversation.item.delete
Removes an item from conversation.
```json
{
  "type": "conversation.item.delete",
  "item_id": "item_abc123"
}
```

#### 8. response.create
Triggers response generation with optional overrides.
```json
{
  "type": "response.create",
  "response": {
    "modalities": ["audio", "text"],
    "instructions": null,
    "voice": null,
    "output_audio_format": "g711_ulaw",
    "tools": [],
    "tool_choice": "auto",
    "temperature": null,
    "max_output_tokens": null
  }
}
```

#### 9. response.cancel
Cancels the current response generation.
```json
{
  "type": "response.cancel"
}
```

### Server Events (Server → Client)

#### Session Events
- `session.created` - Initial session creation
- `session.updated` - Configuration update confirmed
- `error` - Error occurred (connection stays open)

#### Conversation Events
- `conversation.created` - New conversation started
- `conversation.item.created` - Item added to conversation
- `conversation.item.deleted` - Item removed
- `conversation.item.truncated` - Item truncated

#### Input Audio Events
- `input_audio_buffer.committed` - Buffer committed successfully
- `input_audio_buffer.cleared` - Buffer cleared
- `input_audio_buffer.speech_started` - User started speaking
- `input_audio_buffer.speech_stopped` - User stopped speaking

#### Response Events
- `response.created` - Response generation started
- `response.done` - Response complete
- `response.cancelled` - Response cancelled
- `response.output_item.added` - New output item
- `response.output_item.done` - Output item complete
- `response.content_part.added` - Content part added
- `response.content_part.done` - Content part complete

#### Audio Response Events
- `response.audio.delta` - Audio chunk (base64)
- `response.audio.done` - Audio complete
- `response.audio_transcript.delta` - Transcript chunk
- `response.audio_transcript.done` - Transcript complete

#### Text Response Events
- `response.text.delta` - Text chunk
- `response.text.done` - Text complete

#### Function Calling Events
- `response.function_call_arguments.delta` - Function args chunk
- `response.function_call_arguments.done` - Function call ready

#### Transcription Events
- `conversation.item.input_audio_transcription.completed` - User audio transcribed
- `conversation.item.input_audio_transcription.failed` - Transcription failed

#### Rate Limit Events
- `rate_limits.updated` - Current rate limit status

## Turn Detection Modes

### 1. server_vad (Silence-based)
Automatically detects end of turn based on silence duration.
```json
{
  "type": "server_vad",
  "threshold": 0.5,
  "prefix_padding_ms": 300,
  "silence_duration_ms": 500,
  "create_response": true
}
```

### 2. semantic_vad (AI-based, 2025)
Uses AI to detect when user has completed their thought.
```json
{
  "type": "semantic_vad",
  "threshold": 0.5,
  "prefix_padding_ms": 300,
  "silence_duration_ms": 500,
  "create_response": true
}
```

### 3. none (Manual)
No automatic turn detection; responses triggered manually.
```json
{
  "type": "none"
}
```

## Audio Formats

### Supported Formats
- `pcm16` - 16-bit PCM at 24kHz (default)
- `g711_ulaw` - G.711 μ-law 8kHz (telephony standard)
- `g711_alaw` - G.711 A-law 8kHz

### Token Usage
- Audio input: ~800 tokens/minute
- Audio output: ~1150 tokens/minute
- Text: Standard GPT-4 rates

## Best Practices

### 1. Session Configuration
- Specify the model via WebSocket URL: `wss://api.openai.com/v1/realtime?model=gpt-realtime`
- Do not include `model` or `type` in `session.update`
- Configure VAD based on use case:
  - Phone: `server_vad` with 500ms silence
  - Desktop: `semantic_vad` for natural conversation
  - Manual: `none` for push-to-talk

### 2. Barge-in Handling
```javascript
// On speech_started event:
1. Clear Twilio audio queue
2. Truncate assistant response if speaking
3. Calculate audio_end_ms from timestamps
```

### 3. Audio Streaming
- Send audio in 20ms chunks for smooth playback
- Use marks for synchronization with Twilio
- Buffer management prevents audio cutoff

### 4. Error Recovery
- Errors don't close connection
- Implement exponential backoff for reconnection
- Log all error events for debugging

### 5. Performance Optimization
- Reuse WebSocket connections when possible
- Batch configuration updates in single session.update
- Use appropriate max_response_output_tokens

### 6. Security
- Use ephemeral tokens (never expose API keys)
- Tokens expire after 10 minutes by default
- Implement HMAC verification for webhooks

## Telephony Integration (Twilio)

### Media Streams Configuration
```javascript
// Twilio uses G.711 μ-law at 8kHz
{
  "input_audio_format": "g711_ulaw",
  "output_audio_format": "g711_ulaw"
}
```

### Important Considerations
1. Twilio audio is 8kHz, OpenAI expects 24kHz
2. Use base64 encoding for audio transfer
3. Implement proper timestamp tracking
4. Handle Twilio marks for synchronization

## MCP Server Integration (2025)

### Configuration
```json
{
  "tools": [{
    "type": "mcp_server",
    "name": "filesystem",
    "server_url": "ws://localhost:8765",
    "tools": ["read_file", "write_file"]
  }]
}
```

### Benefits
- Automatic tool discovery
- Built-in error handling
- Async execution support

## Limits & Quotas

- Max context: 128,000 tokens
- Max session duration: 15 minutes
- Max response tokens: Configurable (default 4096)
- Simultaneous sessions: Unlimited (as of Feb 2025)

## Migration from Preview

### Key Changes
1. Model name: `gpt-4o-realtime-preview` → `gpt-realtime`
2. Required parameter: Must include `session.type: "realtime"`
3. New features: Image support, MCP servers, async functions
4. Price reduction: 20% cheaper than preview model

## Debugging Tips

1. **Enable verbose logging**: Log all events
2. **Track timestamps**: Essential for audio sync
3. **Monitor token usage**: Via rate_limits events
4. **Test VAD settings**: Adjust for environment
5. **Validate audio format**: Ensure correct encoding