import Fastify from 'fastify';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { TwilioRealtimeTransportLayer } from '@openai/agents-extensions';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables. You must have OpenAI Realtime API access.
const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set it in the .env file.');
  process.exit(1);
}
const PORT = +(process.env.PORT || 5050);

// Initialize Fastify
const fastify = Fastify({ trustProxy: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const agent = new RealtimeAgent({
  name: 'Triage Agent',
  instructions:
    'You are a helpful assistant that starts every conversation with a creative greeting.',
});

// Root Route
fastify.get('/', async (request, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Health check (useful for Railway/containers)
fastify.get('/health', async (request, reply) => {
  reply.type('text/plain').send('OK');
});

// Route for Twilio to handle incoming and outgoing calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
  const twimlResponse = `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>O.K. you can start talking!</Say>
    <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
    </Connect>
</Response>`.trim();
  reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, async (connection, req) => {
    try {
      const state = {
        userOverrides: null,
        userVoice: null,
        userOutputAudioFormat: null,
      };

      // Peek Twilio 'start' to capture <Parameter name="session" value=...>
      connection.socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg && msg.event === 'start') {
            const cp = (msg.start && msg.start.customParameters) ? msg.start.customParameters : {};
            if (cp && typeof cp.session === 'string') {
              try {
                const rawJson = Buffer.from(cp.session, 'base64').toString('utf8');
                const overrides = JSON.parse(rawJson);
                if (overrides && typeof overrides === 'object') {
                  if (typeof overrides.voice === 'string') state.userVoice = overrides.voice;
                  if (typeof overrides.output_audio_format === 'string') state.userOutputAudioFormat = overrides.output_audio_format;
                  const allowed = ['instructions','input_audio_transcription','tools','tool_choice'];
                  const filtered = {};
                  for (const k of allowed) { if (k in overrides) filtered[k] = overrides[k]; }
                  state.userOverrides = filtered;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      });

      const twilioTransportLayer = new TwilioRealtimeTransportLayer({
        twilioWebSocket: connection.socket,
      });

      const session = new RealtimeSession(agent, {
        transport: twilioTransportLayer,
      });

      await session.connect({
        apiKey: OPENAI_API_KEY,
      });
      console.log('Connected to the OpenAI Realtime API');

      // Apply GA session.update after connect (respect user overrides + env)
      const sessionConfig = { type: 'realtime' };
      const u = state.userOverrides || {};
      if (typeof u.instructions === 'string' && u.instructions.trim()) sessionConfig.instructions = u.instructions;
      if (u.input_audio_transcription && typeof u.input_audio_transcription === 'object') sessionConfig.input_audio_transcription = u.input_audio_transcription;
      if (Array.isArray(u.tools)) sessionConfig.tools = u.tools;
      if (typeof u.tool_choice === 'string') sessionConfig.tool_choice = u.tool_choice;
      // Additional client controls (best effort; ignored if not GA-supported)
      if (typeof u.voice === 'string') sessionConfig.voice = u.voice;
      if (typeof u.input_audio_format === 'string') sessionConfig.input_audio_format = u.input_audio_format;
      if (typeof u.output_audio_format === 'string') sessionConfig.output_audio_format = u.output_audio_format;
      if (Array.isArray(u.modalities)) sessionConfig.modalities = u.modalities;
      if (typeof u.temperature === 'number') sessionConfig.temperature = u.temperature;
      if (typeof u.max_response_output_tokens === 'number' || u.max_response_output_tokens === 'inf' || u.max_response_output_tokens === null) sessionConfig.max_response_output_tokens = u.max_response_output_tokens;
      if (!('input_audio_transcription' in sessionConfig) && process.env.REALTIME_TRANSCRIBE_INPUT === 'true') {
        sessionConfig.input_audio_transcription = { model: 'whisper-1' };
      }
      if (!('tools' in sessionConfig) && process.env.REALTIME_TOOLS) {
        try { sessionConfig.tools = JSON.parse(process.env.REALTIME_TOOLS); } catch (_) {}
      }
      if (!('tool_choice' in sessionConfig) && process.env.REALTIME_TOOL_CHOICE) {
        sessionConfig.tool_choice = process.env.REALTIME_TOOL_CHOICE;
      }
      try {
        await session.update(sessionConfig);
        console.log('Session updated with GA config');
      } catch (e) {
        console.error('session.update failed:', e);
      }

      // Stream all GA events for observability
      (async () => {
        try {
          for await (const ev of session.events()) {
            switch (ev.type) {
              case 'response.started':
              case 'response.created':
                console.log('Response started');
                break;
              case 'response.completed':
              case 'response.done':
                console.log('Response completed');
                break;
              case 'audio.delta':
              case 'response.output_audio.delta':
                // Audio chunks are bridged by the transport layer automatically
                break;
              case 'audio.completed':
              case 'response.output_audio.done':
                console.log('Audio output complete');
                break;
              case 'transcript.delta':
              case 'response.output_audio_transcript.delta':
                if (typeof ev.delta === 'string') process.stdout.write(ev.delta);
                break;
              case 'transcript.completed':
              case 'response.output_audio_transcript.done':
                process.stdout.write('\n');
                break;
              case 'text.delta':
              case 'response.output_text.delta':
                if (typeof ev.delta === 'string') process.stdout.write(ev.delta);
                break;
              case 'text.completed':
              case 'response.output_text.done':
                process.stdout.write('\n');
                break;
              case 'tool_call':
              case 'response.function_call_arguments.delta':
                console.log('Tool call activity');
                break;
              case 'handoff':
                console.log('Handoff suggested');
                break;
              case 'rate_limits.updated':
                console.log('Rate limits updated');
                break;
              case 'error':
                console.error('Realtime error:', ev.error || ev);
                break;
              default:
                // Log other events without noise
                break;
            }
          }
        } catch (loopErr) {
          console.error('Session event loop error:', loopErr);
        }
      })();

      // Graceful teardown on WS close
      connection.socket.on('close', async () => {
        try {
          if (session && typeof session.disconnect === 'function') {
            await session.disconnect();
          }
        } catch (_) {}
      });
    } catch (err) {
      console.error('Failed to initialize Realtime session:', err);
      try { connection.socket.close(1011, 'Init failed'); } catch (_) {}
    }
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});

process.on('SIGINT', () => {
  fastify.close();
  process.exit(0);
});