You are an elite PhD-level AI coding assistant with expertise equivalent to top software developers at companies like Vercel, Google, or Meta (e.g., those behind apps like Next.js itself, Gmail, or Facebook). You specialize in Next.js, React, TypeScript, Tailwind CSS, and full-stack web development, adhering to best practices: server-side rendering (SSR) where appropriate, client-side hydration, optimistic UI updates, error boundaries, custom hooks, Zod for schema validation, TanStack Query (React Query) for data fetching, authentication with NextAuth if needed, environment variables via .env, Vercel-optimized deployment, accessibility (ARIA attributes, semantic HTML), dark mode with Tailwind, performance optimization (lazy loading, memoization), and scalable architecture (MVC-like with pages/api, app router, components, lib/utils). Code is clean, modular, well-commented, typed with TypeScript, and optimized for modern browsers. You avoid deprecated features, use async/await with Promises, and ensure security (e.g., input sanitization, CORS, no client-side secrets).

Your task is to generate the COMPLETE Next.js project code for a web application named "AIVoiceCaller". This is a professional speech-to-speech voice AI calling application using OpenAI's Realtime API (updated as of August 2025, incorporating gpt-realtime model, image inputs, reusable prompts, enhanced SIP/PBX integration, multimodal features, remote tool access, and production readiness). The app enables voice AI agents to make outgoing calls to phone numbers, follow user-provided system instructions, and handle incoming calls via configured telephony routing. It integrates with Twilio for telephony bridging to OpenAI's SIP endpoint.

### Project Overview and Requirements
- **Core Functionality**: 
  - Users configure Realtime API parameters via a dashboard.
  - For outgoing calls: The AI agent (powered by OpenAI Realtime) calls a specified phone number, engages in speech-to-speech conversation based on instructions, and records the call.
  - For incoming calls: Provide setup UI for Twilio webhooks; app generates dynamic TwiML via API route for routing to OpenAI SIP.
  - Recordings: View, play, and download past call recordings from Twilio.
- **Integration Details** (based on full Realtime API analysis from API reference and guides, including August 2025 updates):
  - Use OpenAI's Realtime API for low-latency speech-to-speech (supports text, audio, images; focus on audio, but include image upload option for multimodal).
  - Create ephemeral session tokens via POST /v1/realtime/client_secrets with session config (realtime or transcription type, now with gpt-realtime model).
  - For telephony: SIP integration primary. Client secret in SIP URI: sip:{client_secret.value}@sip.openai.com. Support PBX enhancements if applicable.
  - Bridge via Twilio: For outgoing, use Twilio REST API (POST /Accounts/{AccountSid}/Calls.json) with From (Twilio number), To (target), Url (/api/twiml?secret={client_secret.value}), Record="record-from-ringing", RecordingChannels="dual".
  - Dynamic TwiML: Next.js API route /api/twiml generates XML: <Response><Dial><Sip>sip:{secret}@sip.openai.com</Sip></Dial></Response>.
  - Handle all Realtime API events: Client events (session.update, input_audio_buffer.append/commit/clear, conversation.item.create/retrieve/truncate/delete, response.create/cancel, transcription_session.update); Server events (error, session.created/updated, transcription_session.created, conversation.item.created/added/done/retrieved/input_audio_transcription.completed/delta/segment/failed/truncated/deleted, input_audio_buffer.committed/cleared/speech_started/stopped/timeout_triggered, response.created/done).
  - Models: gpt-realtime (default, advanced/cheaper), gpt-4o-realtime-preview; prompting with instructions (reusable), tools (functions with remote access), tool_choice (auto/required/none), temperature (0-2), max_output_tokens (inf/number).
  - Audio: Input format (audio/pcm rate 24000), noise_reduction (near_field), turn_detection (none/server_vad with threshold 0.5, prefix_padding_ms 300, silence_duration_ms 200, idle_timeout_ms null, create_response true, interrupt_response true).
  - Transcription: Model (gpt-4o-transcribe), prompt, language, include logprobs/segments.
  - New Features: Image inputs (upload via form, include in session), reusable prompts (store/load from localStorage), phone connectivity enhancements.
  - For WebSocket fallback: If SIP fails, connect to wss://api.openai.com/v1/realtime?model={model}.
  - Recordings: Use Twilio API to list Calls (/Calls.json), Recordings (/Recordings.json), provide playback URLs (use HTML5 audio).
  - Limitations: No internet in code exec, max audio 15MB, sessions expire.
- **UI Design**: React with Tailwind CSS, minimalistic/ultra-modern (inspired by Vercel dashboard or Stripe). Black/gray/white palette, subtle gradients, Heroicons or Lucide icons, large sans-serif typography (Inter font), ample spacing. Dark mode default (via Tailwind). Navigation: Sidebar or top nav with Dashboard, Call History. Easy to use: Form groups, tooltips (via Radix UI or Headless UI), validation with Zod.
- **Dashboard Page** (/):
  - Secure inputs: OpenAI API Key, Twilio SID/Auth Token/From Number (store in localStorage encrypted or session; warn about security).
  - All Realtime params as form fields (use React Hook Form with Zod resolver):
    - Model: Select (gpt-realtime, gpt-4o-realtime-preview).
    - Instructions: Textarea for system prompt (reusable, save/load buttons).
    - Tools: List to add/edit/delete functions (name, desc, params as JSON editor).
    - Tool Choice: Select (auto, required, none).
    - Temperature: Slider (0-2, step 0.1).
    - Max Output Tokens: Input (inf or number).
    - Output Modalities: Checkboxes (audio, text).
    - Voice: Select (alloy, echo, fable, onyx, nova, shimmer; new voices if added).
    - Turn Detection: Select (none, server_vad).
    - VAD Params: Conditional fields for threshold (slider 0-1), prefix_padding_ms (input 0-2000), etc.
    - Input Audio Format: Select (audio/pcm, rate 24000).
    - Transcription: Toggle, select model, inputs for prompt/language, toggles for logprobs/segments.
    - Noise Reduction: Select (none, near_field).
    - Expires After: Select anchor (created_at), input seconds (600).
    - Image Input: File upload for multimodal (optional, base64 encode and include in session).
  - Call Section: Input for target number (E.164, validate with Zod), Toggle record, Button "Start Outgoing Call".
  - On submit: Validate, POST to OpenAI for client_secret {expires_after, session: {type:"realtime", model, instructions, tools, ...}}. Then, server-side POST to Twilio /Calls.json with Url=/api/twiml?secret={value}.
  - Show loading/toast (use react-hot-toast), handle errors (modals).
- **Call History Page** (/history): Table or list of calls (fetch Twilio /Calls.json via API route, store in state or Supabase if added; include date, to, sid, recording URL). Play button with <audio> tag.
- **Incoming Calls Setup**: Dashboard section: Generate TwiML URL (/api/twiml), instructions for Twilio webhook setup.
- **Other Features**:
  - Logging: console.log with levels, or use Sentry.
  - Error Handling: Custom Error types, try/catch in async funcs.
  - Networking: Axios or fetch with async/await, JSON handling.
  - Audio Playback: HTML5 <audio> with controls.
  - Tests: Include Jest unit tests for utils, components, API routes.
  - Dependencies: next, react, react-dom, tailwindcss, @types/react, typescript, zod, react-hook-form, react-slider, react-hot-toast, axios, twilio (client for REST).
  - Deployment: Vercel-ready, with env vars.

Generate the code as a full Next.js project structure: List files (e.g., app/layout.tsx, app/page.tsx, app/api/twiml/route.ts, components/Dashboard.tsx, etc.), then provide complete code for each. Use app router (Next.js 14+). Folders: app, components, lib, public, styles. End with setup instructions (e.g., "npm init next-app, add deps, set .env with keys, npm run dev").

Ensure code is bug-free, professional, and on par with top quality.