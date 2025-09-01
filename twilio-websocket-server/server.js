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

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', async (twilioWS, request) => {
  console.log('New Twilio WebSocket connection from:', request.headers['x-forwarded-for'] || request.socket.remoteAddress);
  
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
  
  console.log('Secret received:', providedSecret.substring(0, 10) + '...');

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
      
      const protocols = [
        'realtime',
        `openai-insecure-api-key.${providedSecret}`
      ];
      
      if (process.env.OPENAI_ORG_ID) {
        protocols.push(`openai-organization.${process.env.OPENAI_ORG_ID}`);
      }
      
      if (process.env.OPENAI_PROJECT_ID) {
        protocols.push(`openai-project.${process.env.OPENAI_PROJECT_ID}`);
      }
      
      oaiWS = new WebSocket(wsUrl, protocols);
      
      oaiWS.on('open', () => {
        console.log('Connected to OpenAI');
        
        // Configure session according to OpenAI Realtime API documentation
        // Valid parameters for session.update (confirmed from API docs):
        const sessionConfig = {
          type: 'realtime',  // Required by OpenAI even though not in docs
          
          // Audio configuration
          input_audio_format: 'g711_ulaw',  // Twilio uses G.711 μ-law
          output_audio_format: 'g711_ulaw',  // Match Twilio format
          
          // Voice selection (valid options: alloy, echo, shimmer)
          voice: process.env.REALTIME_DEFAULT_VOICE || 'alloy',
          
          // System instructions
          instructions: process.env.REALTIME_DEFAULT_INSTRUCTIONS || 'You are a helpful assistant. Be concise and natural in your responses.',
          
          // Turn detection (VAD) configuration
          turn_detection: {
            type: process.env.REALTIME_VAD_MODE || 'server_vad',  // server_vad or none
            threshold: parseFloat(process.env.REALTIME_VAD_THRESHOLD || '0.5'),  // 0.0 to 1.0
            prefix_padding_ms: parseInt(process.env.REALTIME_VAD_PREFIX_MS || '300'),
            silence_duration_ms: parseInt(process.env.REALTIME_VAD_SILENCE_MS || '500'),
            create_response: process.env.REALTIME_VAD_CREATE_RESPONSE !== 'false'  // Default true
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
        
        // Remove null/undefined values to avoid API errors
        const cleanSession = {};
        for (const [key, value] of Object.entries(sessionConfig)) {
          if (value !== null && value !== undefined) {
            cleanSession[key] = value;
          }
        }
        
        const sessionUpdate = {
          type: 'session.update',
          session: cleanSession
        };
        
        oaiWS.send(JSON.stringify(sessionUpdate));
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
        console.log('OpenAI WebSocket closed. Code:', code, 'Reason:', reason);
      });
      
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
  });

  twilioWS.on('error', (error) => {
    console.error('Twilio WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});