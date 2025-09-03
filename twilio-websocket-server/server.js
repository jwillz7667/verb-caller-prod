require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3001;

// Audio conversion utilities
class AudioConverter {
  static muLawDecode(u8) {
    const out = new Int16Array(u8.length);
    for (let i = 0; i < u8.length; i++) {
      const u = u8[i];
      const inv = ~u;
      const sign = (inv & 0x80) ? -1 : 1;
      const exponent = (inv >> 4) & 0x07;
      const mantissa = inv & 0x0f;
      const magnitude = ((mantissa << 4) + 0x08) << (exponent + 2);
      out[i] = sign * magnitude;
    }
    return out;
  }

  static muLawEncode(pcm) {
    const out = new Uint8Array(pcm.length);
    const MU_LAW_BIAS = 132;
    const MU_LAW_MAX = 32635;
    
    for (let i = 0; i < pcm.length; i++) {
      let sample = pcm[i];
      const sign = (sample >> 8) & 0x80;
      if (sign !== 0) sample = -sample;
      sample = Math.min(sample, MU_LAW_MAX);
      sample += MU_LAW_BIAS;
      
      let exponent = 7;
      for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
      
      const mantissa = (sample >> (exponent + 3)) & 0x0f;
      const mu = ~(sign | (exponent << 4) | mantissa);
      out[i] = mu & 0xff;
    }
    return out;
  }

  static base64ToUint8(b64) {
    const binString = Buffer.from(b64, 'base64').toString('binary');
    const len = binString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  }

  static uint8ToBase64(arr) {
    return Buffer.from(arr).toString('base64');
  }
}

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Production-ready logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data,
    env: process.env.NODE_ENV || 'development'
  };
  
  if (process.env.NODE_ENV === 'production') {
    // In production, output structured JSON logs
    console.log(JSON.stringify(logEntry));
  } else {
    // In development, use readable format
    console.log(`[${timestamp}] ${level}: ${message}`, data);
  }
}

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', async (twilioWS, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
  log('info', 'New Twilio WebSocket connection', { clientIp });
  
  // Parse secret from URL path or query parameters
  const fullUrl = request.url || '';
  
  // Try multiple ways to get the secret
  let providedSecret = null;
  
  // Method 1: Extract from path (for Railway which strips query params)
  // Expected format: /ek_xxxxx or /ek%5Fxxxxx (URL encoded)
  if (fullUrl.startsWith('/')) {
    const pathSegment = fullUrl.split('?')[0].substring(1); // Remove leading /
    if (pathSegment) {
      providedSecret = decodeURIComponent(pathSegment);
    }
  }
  
  // Method 2: Direct query parameter (for local dev)
  if (!providedSecret && fullUrl.includes('?')) {
    const queryString = fullUrl.split('?')[1];
    const params = new URLSearchParams(queryString);
    providedSecret = params.get('secret');
  }
  
  // Method 3: Parse with url module (backup)
  if (!providedSecret) {
    const queryParams = url.parse(fullUrl, true).query;
    providedSecret = queryParams.secret;
  }
  
  if (!providedSecret) {
    console.error('No secret provided. URL was:', fullUrl);
    twilioWS.close(1008, 'Secret required');
    return;
  }
  
  const maskedSecret = providedSecret.length > 8
    ? `${providedSecret.substring(0, 4)}…${providedSecret.substring(providedSecret.length - 4)}`
    : '***';
  console.log('Secret received:', maskedSecret);

  let oaiWS = null;
  const state = {
    streamSid: '',
    callSid: '',
    lastAssistantItem: null,
    responseStartTimestamp: null,
    latestMediaTimestamp: null,
    isResponseActive: false,  // Track if response is currently active
    hasInterrupted: false,    // Prevent multiple interruption attempts
    userOverrides: null,      // Session overrides passed from UI via TwiML <Parameter>
    userVoice: null,          // Optional voice preference for response.create
    userOutputAudioFormat: null // Optional output audio format preference for response.create
  };

  // Connect to OpenAI
  async function connectToOpenAI() {
    try {
      // Use latest gpt-realtime model (2025 version)
      const model = process.env.REALTIME_DEFAULT_MODEL || 'gpt-realtime';
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
      
      console.log('Connecting to OpenAI with model:', model);
      
      // Prefer Authorization header over insecure subprotocol for production (GA Realtime requires no beta header)
      const headers = {
        Authorization: `Bearer ${providedSecret}`
      };
      if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
      if (process.env.OPENAI_PROJECT_ID) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;

      oaiWS = new WebSocket(wsUrl, 'realtime', {
        headers,
        handshakeTimeout: parseInt(process.env.REALTIME_WS_TIMEOUT_MS || '15000'),
        perMessageDeflate: false
      });
      
      oaiWS.on('open', () => {
        console.log('Connected to OpenAI');
        
        // Build session.update according to GA specs with UI overrides
        // Start with required type only; do not include unsupported fields
        const sessionConfig = { type: 'realtime' };

        // Apply user overrides first (from TwiML <Parameter name="session" value=...>)
        const u = state.userOverrides || {};
        if (typeof u.instructions === 'string' && u.instructions.trim()) sessionConfig.instructions = u.instructions;
        if (u.turn_detection && typeof u.turn_detection === 'object') sessionConfig.turn_detection = u.turn_detection;
        if (u.input_audio_transcription && typeof u.input_audio_transcription === 'object') sessionConfig.input_audio_transcription = u.input_audio_transcription;
        if (Array.isArray(u.tools)) sessionConfig.tools = u.tools;
        if (typeof u.tool_choice === 'string') sessionConfig.tool_choice = u.tool_choice;

        // Apply safe defaults only if not supplied by user (avoid overriding ephemeral token settings)
        if (!('turn_detection' in sessionConfig)) {
          sessionConfig.turn_detection = {
            type: process.env.REALTIME_VAD_MODE || 'server_vad',
            threshold: parseFloat(process.env.REALTIME_VAD_THRESHOLD || '0.5'),
            prefix_padding_ms: parseInt(process.env.REALTIME_VAD_PREFIX_MS || '300'),
            silence_duration_ms: parseInt(process.env.REALTIME_VAD_SILENCE_MS || '500'),
            create_response: process.env.REALTIME_VAD_CREATE_RESPONSE ? process.env.REALTIME_VAD_CREATE_RESPONSE === 'true' : true
          };
        }
        if (!('input_audio_transcription' in sessionConfig) && process.env.REALTIME_TRANSCRIBE_INPUT === 'true') {
          sessionConfig.input_audio_transcription = { model: 'whisper-1' };
        }
        if (!('tools' in sessionConfig) && process.env.REALTIME_TOOLS) {
          try { sessionConfig.tools = JSON.parse(process.env.REALTIME_TOOLS); } catch (_) {}
        }
        if (!('tool_choice' in sessionConfig) && process.env.REALTIME_TOOL_CHOICE) {
          sessionConfig.tool_choice = process.env.REALTIME_TOOL_CHOICE;
        }
        
        // Remove null/undefined values and ensure required type field
        const cleanSession = {};
        for (const [key, value] of Object.entries(sessionConfig)) {
          if (value !== null && value !== undefined) {
            cleanSession[key] = value;
          }
        }
        
        // Store config for later use after session.created
        state.pendingSessionConfig = cleanSession;
        console.log('Session config prepared, waiting for session.created event...');
      });
      
      oaiWS.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          handleOpenAIMessage(msg);
        } catch (e) {
          console.error('Failed to parse OpenAI message:', e);
        }
      });
      
      oaiWS.on('error', (error) => {
        console.error('OpenAI WebSocket error:', error.message || error);
        // Close Twilio connection if OpenAI fails
        twilioWS.close(1011, 'OpenAI connection failed');
      });
      
      oaiWS.on('close', (code, reason) => {
        const reasonText = Buffer.isBuffer(reason) ? reason.toString() : (reason || '').toString();
        console.log('OpenAI WebSocket closed. Code:', code, 'Reason:', reasonText);
      });

      if (typeof oaiWS.on === 'function') {
        oaiWS.on('unexpectedResponse', (req, res) => {
          console.error('OpenAI unexpectedResponse:', res?.statusCode, res?.statusMessage);
        });
      }
      
    } catch (error) {
      console.error('Failed to connect to OpenAI:', error.message || error);
      twilioWS.close(1011, 'Failed to connect to OpenAI');
    }
  }

  // Handle OpenAI messages (all event types)
  function handleOpenAIMessage(msg) {
    switch (msg.type) {
      // Session events
      case 'session.created':
        console.log('Session created:', msg.session?.id);
        
        // Now send the session.update with our configuration
        if (state.pendingSessionConfig) {
          const sessionUpdate = {
            type: 'session.update',
            session: state.pendingSessionConfig
          };
          console.log('Sending session.update after session.created');
          oaiWS.send(JSON.stringify(sessionUpdate));
          state.pendingSessionConfig = null;
        }
        break;
        
      case 'session.updated':
        console.log('Session updated');
        break;
        
      // Conversation events
      case 'conversation.created':
        console.log('Conversation created:', msg.conversation?.id);
        break;
        
      case 'conversation.item.created':
        if (msg.item?.type === 'message' && msg.item?.role === 'assistant') {
          console.log('Assistant message created:', msg.item?.id);
          if (msg.item?.id) {
            state.lastAssistantItem = msg.item.id;
          }
        }
        break;
        
      case 'conversation.item.deleted':
        console.log('Conversation item deleted:', msg.item_id);
        break;
        
      case 'conversation.item.truncated':
        console.log('Conversation item truncated:', msg.item_id);
        break;
        
      // Input audio buffer events
      case 'input_audio_buffer.committed':
        console.log('Input audio committed');
        break;
        
      case 'input_audio_buffer.cleared':
        console.log('Input audio buffer cleared');
        break;
        
      case 'input_audio_buffer.speech_started':
        console.log('Speech started - handling barge-in');
        // Clear Twilio's audio queue
        twilioWS.send(JSON.stringify({
          event: 'clear',
          streamSid: state.streamSid
        }));
        
        // Only truncate if there's an active response and we haven't already interrupted
        if (state.isResponseActive && state.lastAssistantItem && !state.hasInterrupted) {
          const audioEndMs = state.responseStartTimestamp !== null 
            ? Math.max(0, (state.latestMediaTimestamp || 0) - state.responseStartTimestamp)
            : 0;
          
          if (oaiWS && oaiWS.readyState === WebSocket.OPEN) {
            console.log('Truncating assistant response at', audioEndMs, 'ms');
            oaiWS.send(JSON.stringify({
              type: 'conversation.item.truncate',
              item_id: state.lastAssistantItem,
              content_index: 0,
              audio_end_ms: audioEndMs
            }));
            state.hasInterrupted = true;
          }
        }
        break;
        
      case 'input_audio_buffer.speech_stopped':
        console.log('Speech stopped');
        break;
        
      // Response events
      case 'response.created':
        console.log('Response created:', msg.response?.id);
        state.isResponseActive = true;
        state.hasInterrupted = false;
        break;
      
      case 'response.output_item.added':
        console.log('Output item added:', msg.item?.id);
        if (msg.item?.id) {
          state.lastAssistantItem = msg.item.id;
        }
        break;
        
      case 'response.output_item.done':
        console.log('Output item done:', msg.item?.id);
        break;
        
      case 'response.content_part.added':
        console.log('Content part added');
        break;
        
      case 'response.content_part.done':
        console.log('Content part done');
        break;
        
      // GA: response.output_text.delta (support legacy alias response.text.delta)
      case 'response.output_text.delta':
      case 'response.text.delta':
        // Text response chunk (if modality includes text)
        if (msg.delta) {
          process.stdout.write(msg.delta);
        }
        break;
        
      // GA: response.output_text.done (support legacy alias response.text.done)
      case 'response.output_text.done':
      case 'response.text.done':
        console.log('\nText response complete');
        break;
        
      // GA: response.output_audio.delta (support legacy alias response.audio.delta)
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        // Forward audio to Twilio
        if (msg.delta && twilioWS.readyState === WebSocket.OPEN) {
          if (state.responseStartTimestamp === null && state.latestMediaTimestamp !== null) {
            state.responseStartTimestamp = state.latestMediaTimestamp;
          }
          if (msg.item_id) {
            state.lastAssistantItem = msg.item_id;
          }
          
          const mediaMsg = {
            event: 'media',
            streamSid: state.streamSid,
            media: { payload: msg.delta }
          };
          twilioWS.send(JSON.stringify(mediaMsg));
          
          // Send mark for synchronization
          twilioWS.send(JSON.stringify({
            event: 'mark',
            streamSid: state.streamSid
          }));
        }
        break;
      
      // GA: response.output_audio_transcript.delta (support legacy alias response.audio_transcript.delta)
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (typeof msg.delta === 'string' && msg.response?.id) {
          process.stdout.write(msg.delta);
        }
        break;
      
      // GA: response.output_audio_transcript.done (support legacy alias response.audio_transcript.done)
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        console.log('\nAudio transcript complete');
        break;
        
      // GA: response.output_audio.done (support legacy alias response.audio.done)
      case 'response.output_audio.done':
      case 'response.audio.done':
        console.log('Audio response complete');
        break;
        
      case 'response.done':
        console.log('Full response complete');
        state.isResponseActive = false;
        state.lastAssistantItem = null;
        state.responseStartTimestamp = null;
        break;
        
      case 'response.cancelled':
        console.log('Response cancelled');
        state.isResponseActive = false;
        state.lastAssistantItem = null;
        state.responseStartTimestamp = null;
        break;
        
      case 'response.function_call_arguments.delta':
        // Function call arguments chunk
        if (msg.delta) {
          console.log('Function call args:', msg.delta);
        }
        break;
        
      case 'response.function_call_arguments.done':
        console.log('Function call complete:', msg.name);
        break;
        
      // Transcription events
      case 'conversation.item.input_audio_transcription.completed':
        console.log('User transcription:', msg.transcript);
        break;
        
      case 'conversation.item.input_audio_transcription.failed':
        console.error('Transcription failed:', msg.error);
        break;
        
      // Rate limit events
      case 'rate_limits.updated':
        console.log('Rate limits:', msg.rate_limits);
        break;
        
      case 'error':
        console.error('OpenAI error:', msg.error);
        break;
    }
  }

  // Handle Twilio messages
  twilioWS.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.event) {
        case 'start':
          state.streamSid = msg.start.streamSid;
          state.callSid = msg.start.callSid || '';
          console.log('Stream started:', state.streamSid);
          // Read custom parameters from Twilio to capture UI overrides
          try {
            const cp = (msg.start && msg.start.customParameters) ? msg.start.customParameters : {};
            let overrides = null;
            if (cp && typeof cp.session === 'string') {
              // Expect base64-encoded JSON
              const raw = Buffer.from(cp.session, 'base64').toString('utf8');
              overrides = JSON.parse(raw);
            }
            if (overrides && typeof overrides === 'object') {
              // Extract voice and output format separately for response.create
              if (typeof overrides.voice === 'string') state.userVoice = overrides.voice;
              if (typeof overrides.output_audio_format === 'string') state.userOutputAudioFormat = overrides.output_audio_format;
              // Filter to known, GA-allowed session.update fields only
              const allowed = [
                'instructions','input_audio_transcription',
                'turn_detection','tools','tool_choice','temperature','max_response_output_tokens'
              ];
              const filtered = {};
              for (const k of allowed) { if (k in overrides) filtered[k] = overrides[k]; }
              state.userOverrides = filtered;
              console.log('Applied user overrides from Twilio parameters');
            }
          } catch (e) {
            console.error('Failed to parse Twilio customParameters.session:', e?.message || e);
          }
          
          // Connect to OpenAI
          await connectToOpenAI();
          startHeartbeat();
          break;
          
        case 'media':
          // Forward audio to OpenAI
          if (msg.media?.payload && oaiWS && oaiWS.readyState === WebSocket.OPEN) {
            state.latestMediaTimestamp = msg.media.timestamp || state.latestMediaTimestamp;
            
            // Append audio to input buffer
            // OpenAI will handle VAD and turn detection based on session config
            oaiWS.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.media.payload  // Base64 encoded G.711 μ-law audio
            }));
          }
          break;
          
        case 'mark':
          // Handle custom marks for turn management
          if (msg.mark?.name === 'commit' && oaiWS && oaiWS.readyState === WebSocket.OPEN) {
            // Manually commit audio buffer and create response
            oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            
            // response.create with minimal overrides (all optional)
            const responseCreate = { type: 'response.create' };
            
            // Only add response config if we have specific overrides
            const r = {};
            if (state.userVoice) r.voice = state.userVoice;
            if (state.userOverrides && typeof state.userOverrides.temperature === 'number') r.temperature = state.userOverrides.temperature;
            if (state.userOverrides && typeof state.userOverrides.max_response_output_tokens === 'number') r.max_output_tokens = state.userOverrides.max_response_output_tokens;
            // Ensure telephony-compatible audio in response (Twilio expects G.711 μ-law)
            r.output_audio_format = (typeof state.userOutputAudioFormat === 'string')
              ? state.userOutputAudioFormat
              : 'g711_ulaw';
            if (Object.keys(r).length > 0) responseCreate.response = r;
            
            oaiWS.send(JSON.stringify(responseCreate));
            console.log('Manual turn commit with response creation');
          }
          break;
          
        case 'stop':
          console.log('Stream stopped');
          if (oaiWS) {
            oaiWS.close();
          }
          break;
      }
    } catch (error) {
      console.error('Failed to handle Twilio message:', error);
    }
  });

  twilioWS.on('close', () => {
    console.log('Twilio WebSocket closed');
    if (oaiWS) {
      oaiWS.close();
    }
    stopHeartbeat();
  });

  twilioWS.on('error', (error) => {
    console.error('Twilio WebSocket error:', error);
  });

  // Heartbeat to keep proxies from closing idle connections
  let heartbeatInterval = null;
  function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(() => {
      try {
        if (twilioWS && twilioWS.readyState === WebSocket.OPEN) twilioWS.ping();
        if (oaiWS && oaiWS.readyState === WebSocket.OPEN) oaiWS.ping();
      } catch (e) {}
    }, parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || '25000'));
  }
  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
  
  // Show proper URL based on environment
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`Health check: https://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`);
  } else if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`Health check: ${process.env.RENDER_EXTERNAL_URL}/health`);
  } else if (process.env.NODE_ENV === 'production') {
    console.log(`Health check available on port ${PORT}`);
  } else {
    console.log(`Health check: http://localhost:${PORT}/health`);
  }
});

// Process-level hardening
function gracefulShutdown(signal) {
  try {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    try {
      if (wss) {
        for (const client of wss.clients) {
          try { client.close(); } catch (_) {}
        }
        try { wss.close(); } catch (_) {}
      }
    } catch (_) {}
    server.close(() => {
      console.log('HTTP server closed. Exiting.');
      process.exit(0);
    });
    // Fallback timeout
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (e) {
    process.exit(1);
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
