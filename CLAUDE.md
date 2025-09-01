# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Voice Caller - A production-grade speech-to-speech calling application that bridges Twilio telephony with OpenAI's Realtime API. The app supports both SIP-based and WebSocket Media Streams connections, with ephemeral token generation for secure real-time sessions.

## Architecture

### Tech Stack
- **Framework**: Next.js 14 with App Router (Edge Runtime)
- **Language**: TypeScript (strict mode)
- **Styling**: TailwindCSS
- **State**: React Hook Form with Zod validation
- **APIs**: OpenAI Realtime API, Twilio Voice & Media Streams
- **Testing**: Jest with Testing Library

### Key Directories
- `app/api/`: Edge runtime API routes
  - `realtime-token/`: Ephemeral token generation for OpenAI
  - `twiml/`: Dynamic TwiML generation for Twilio
  - `stream/twilio/`: WebSocket bridge for Media Streams
  - `live/`: Server-sent events for real-time updates
  - `realtime/control/`: Webhook for server-side session control
- `lib/`: Core business logic and utilities
  - `realtimeControl.ts`: Session configuration management
  - `openai.ts`: OpenAI API client wrapper
  - `twilio.ts`: Twilio client utilities
  - `validation.ts`: Zod schemas for data validation
- `components/`: React components
  - `DashboardForm.tsx`: Main control interface
  - `ControlSettings.tsx`: Realtime session parameters UI

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run production server
npm start

# Run linting
npm run lint

# Run tests (with no test warning suppression)
npm test
```

## API Architecture

### Connection Modes
1. **SIP Mode** (default): Direct SIP connection to `sip.openai.com`
   - TwiML endpoint: `/api/twiml`
   - Supports TLS transport on port 5061

2. **Media Streams Mode**: WebSocket bridge for carriers that can't reach SIP
   - TwiML endpoint: `/api/twiml?mode=stream`
   - WebSocket server: `/api/stream/twilio`
   - Audio conversion: G.711 μ-law 8kHz ↔ PCM16 24kHz

### Authentication Flow
1. Server mints ephemeral client secrets via OpenAI API
2. Tokens expire after configurable duration (default: 600s)
3. Optional server-side control webhook for session management
4. HMAC signature verification available for webhook security

## Environment Configuration

Critical environment variables:
- `OPENAI_API_KEY`: Required for token generation
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`: Twilio credentials
- `PUBLIC_BASE_URL`: Canonical HTTPS URL for callbacks (must match exact host Twilio calls)
- `REALTIME_*`: Default session parameters (voice, VAD, transcription, etc.)

## Testing Approach

Tests use Jest with TypeScript support. Test files follow the pattern `*.test.ts(x)` or `*.spec.ts(x)`. The configuration uses `jsdom` environment with path aliases matching the TypeScript config.

## Key Implementation Patterns

1. **Edge Runtime**: All API routes use Edge Runtime for optimal performance
2. **Ephemeral Security**: Never store long-lived credentials; mint per-session tokens
3. **Audio Processing**: Custom μ-law encode/decode with linear resampling for Twilio compatibility
4. **WebSocket Bridging**: Dual WebSocket connections (Twilio ↔ Server ↔ OpenAI) with frame pacing at 20ms
5. **Real-time Updates**: SSE endpoints for live transcription and call status updates

## Session Configuration

The app supports comprehensive Realtime API parameters:
- Voice selection (alloy, echo, shimmer)
- VAD configuration (threshold, prefix, silence duration)
- Transcription settings (model, language, prompt)
- Tool choice and modalities
- Input/output audio configuration

Server-side control webhook (`/api/realtime/control`) enables dynamic session updates during calls.