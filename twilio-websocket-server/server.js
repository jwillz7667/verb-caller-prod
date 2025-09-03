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
    hasInterrupted: false     // Prevent multiple interruption attempts
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
        
        // Configure session according to OpenAI Realtime GA API documentation
        // NOTE: Include required session.type to satisfy GA API contract
        const sessionConfig = {
          type: 'realtime',
          
          // System instructions (following OpenAI cookbook best practices)
          instructions: process.env.REALTIME_DEFAULT_INSTRUCTIONS || `ROLE: Helpful AI assistant on a phone call.
OBJECTIVE: Assist the caller effectively.
PERSONALITY: Friendly, professional, conversational. Natural pacing for phone.
INSTRUCTIONS: ALWAYS follow caller instructions. Prioritize requests. Be concise. Ask for clarification when needed.
CONVERSATION: Greet warmly. Listen actively. Respond helpfully. Confirm understanding.`,
          
          // Modalities and audio formats for telephony
          modalities: ['audio', 'text'],
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          
          // Turn detection (VAD) configuration
          turn_detection: {
            type: process.env.REALTIME_VAD_MODE || 'server_vad',  // server_vad | semantic_vad | none
            threshold: parseFloat(process.env.REALTIME_VAD_THRESHOLD || '0.5'),  // 0.0 to 1.0
            prefix_padding_ms: parseInt(process.env.REALTIME_VAD_PREFIX_MS || '300'),
            silence_duration_ms: parseInt(process.env.REALTIME_VAD_SILENCE_MS || '500'),
            create_response: process.env.REALTIME_VAD_CREATE_RESPONSE ? process.env.REALTIME_VAD_CREATE_RESPONSE === 'true' : true
          },
          
          // Input audio transcription (optional)
          input_audio_transcription: process.env.REALTIME_TRANSCRIBE_INPUT === 'true' ? {
            model: 'whisper-1'
          } : null,
          
          // Tools array (for function calling)
          tools: process.env.REALTIME_TOOLS ? JSON.parse(process.env.REALTIME_TOOLS) : [],
          
          // Tool choice strategy
          tool_choice: process.env.REALTIME_TOOL_CHOICE || 'auto',  // auto, none, required, or function name
          
          // Response generation parameters
          temperature: parseFloat(process.env.REALTIME_TEMPERATURE || '0.8'),
          max_response_output_tokens: parseInt(process.env.REALTIME_MAX_TOKENS || '4096') || 4096
        };
        
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
        
      case 'response.text.delta':
        // Text response chunk (if modality includes text)
        if (msg.delta) {
          process.stdout.write(msg.delta);
        }
        break;
        
      case 'response.text.done':
        console.log('\nText response complete');
        break;
        
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
      
      case 'response.audio_transcript.delta':
        if (typeof msg.delta === 'string' && msg.response?.id) {
          process.stdout.write(msg.delta);
        }
        break;
      
      case 'response.audio_transcript.done':
        console.log('\nAudio transcript complete');
        break;
        
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
            if (process.env.REALTIME_RESPONSE_VOICE || process.env.REALTIME_RESPONSE_TEMPERATURE) {
              responseCreate.response = {};
              if (process.env.REALTIME_RESPONSE_VOICE) {
                responseCreate.response.voice = process.env.REALTIME_RESPONSE_VOICE;
              }
              if (process.env.REALTIME_RESPONSE_TEMPERATURE) {
                responseCreate.response.temperature = parseFloat(process.env.REALTIME_RESPONSE_TEMPERATURE);
              }
            }
            
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
