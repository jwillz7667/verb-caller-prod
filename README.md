# AIVoiceCaller

Professional speech-to-speech AI calling app using OpenAI Realtime API and Twilio SIP.

## Features
- Outgoing calls bridged to OpenAI SIP with ephemeral Realtime session
- Dynamic TwiML for incoming calls routing
- Configurable realtime params (model, voice, VAD, tools, transcription)
- Optional image inputs for multimodal context
- Call history + playback of Twilio recordings

## Quickstart
1. Copy `.env.example` to `.env.local` and fill keys.
2. Install deps: `npm i`
3. Dev server: `npm run dev`
4. Open http://localhost:3000

### Outgoing Calls
- From the Dashboard, enter Twilio and OpenAI credentials if not set in env.
- Fill the target `To` number in E.164 and click Start Outgoing Call.

### Incoming Calls
- Generate a client secret via Realtime API (button to be added) or use the outgoing call flow to see a generated secret value in logs.
- Configure your Twilio phone number Voice webhook (Incoming Call) to: `https://YOUR_DOMAIN/api/twiml?secret=CLIENT_SECRET_VALUE`

### Server-Side Control (Optional)
- Endpoint: `POST https://YOUR_DOMAIN/api/realtime/control`
- Auth (optional): Set `REALTIME_CONTROL_SECRET` and send `Authorization: Bearer <secret>` from OpenAI (if supported) or leave unset to allow unauthenticated.
- Response contract: Return `{ "events": [ { "type":"session.update", "session": { ... } } ] }` to push updates like `voice`, `turn_detection`, etc.
- Defaults: Controlled via env vars (REALTIME_DEFAULT_*). See `.env.example`.
- To attach this webhook from your session, include a `server` object when minting client secrets if your account supports it:
  ```json
  {
    "expires_after": { "anchor":"created_at","seconds":600 },
    "session": { "type":"realtime", "model":"gpt-realtime", "instructions":"..." },
    "server": { "url": "https://YOUR_DOMAIN/api/realtime/control", "secret": "<optional>" }
  }
  ```
  If you receive "unknown parameter" errors when including `server`, omit it and manage settings via WebSocket `session.update` instead.

#### HMAC Signature (optional)
- Enable verification: set `REALTIME_CONTROL_SIGNING_SECRET`.
- Incoming headers expected (if provided by OpenAI):
  - `x-openai-signature` or `x-openai-signature-256`
  - `x-openai-signature-timestamp` (or `x-openai-timestamp`)
- Verification: HMAC-SHA256 over `timestamp + '.' + rawBody` (or rawBody if no timestamp), compared in constant time against the provided signature (hex or base64). Timestamp tolerance configurable via `REALTIME_CONTROL_TOLERANCE_SECONDS` (default 300s).

## Environment
- `OPENAI_API_KEY`: Server-side key used to mint ephemeral client secrets.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: Twilio credentials.

## Tests
`npm test`

## Deploy
Deploy on Vercel. Ensure env vars are set in the Vercel project. No serverless-esoteric features used.
