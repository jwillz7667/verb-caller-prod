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
  The TwiML returned uses `sips:` to route over TLS to OpenAI SIP.

### Using Prompt References (optional)
You can attach a prebuilt Prompt to the Realtime session when minting an ephemeral client secret by including a `session.prompt` object:

POST /api/realtime-token
{
  "expires_after": { "anchor": "created_at", "seconds": 600 },
  "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "prompt": { "id": "pmpt_XXXX", "version": "2" }
  }
}

Note: You can provide either `session.instructions` or `session.prompt` (or both). The server validates that at least one is present and forwards only supported session fields to OpenAI.

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

### Control Defaults via Env
- Voice: `REALTIME_DEFAULT_VOICE=alloy`
- Tool choice: `REALTIME_DEFAULT_TOOL_CHOICE=auto`
- Modalities: `REALTIME_DEFAULT_MODALITIES=audio` (comma-separated)
- Temperature: `REALTIME_DEFAULT_TEMPERATURE=0.7`
- Max tokens: `REALTIME_DEFAULT_MAX_OUTPUT_TOKENS=` (blank = infinite)
- Turn detection: `REALTIME_TURN_DETECTION=server_vad|none`
  - `REALTIME_VAD_THRESHOLD=0.5`
  - `REALTIME_VAD_PREFIX_MS=300`
  - `REALTIME_VAD_SILENCE_MS=200`
  - `REALTIME_VAD_SEMANTIC=false` (experimental semantic VAD)
- Noise reduction: `REALTIME_NOISE_REDUCTION=near_field|none`
- Input audio: `REALTIME_INPUT_AUDIO_RATE=24000`
- Transcription:
  - `REALTIME_TRANSCRIPTION_ENABLED=false`
  - `REALTIME_TRANSCRIPTION_MODEL=gpt-4o-transcribe`
  - Optional: `REALTIME_TRANSCRIPTION_PROMPT`, `REALTIME_TRANSCRIPTION_LANGUAGE`, `REALTIME_TRANSCRIPTION_LOGPROBS`, `REALTIME_TRANSCRIPTION_SEGMENTS`

Note: The Dashboard “Server Control Settings” UI can override these defaults at runtime (in-memory) when saved using `REALTIME_CONTROL_ADMIN_SECRET`.

## Environment
- `OPENAI_API_KEY`: Server-side key used to mint ephemeral client secrets.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: Twilio credentials.
- `PUBLIC_BASE_URL`: e.g., `https://verbio.app` for Twilio callbacks.
- `ALLOW_CLIENT_CREDS` / `NEXT_PUBLIC_ALLOW_CLIENT_CREDS`: Enable UI credential inputs and server acceptance (dev only). Defaults to false; do not enable in production.

## Tests
`npm test`

## Deploy
Deploy on Vercel. Ensure env vars are set in the Vercel project. No serverless-esoteric features used.
