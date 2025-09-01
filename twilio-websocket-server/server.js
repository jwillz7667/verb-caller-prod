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
    latestMediaTimestamp: null
  };

  // Connect to OpenAI
  async function connectToOpenAI() {
    try {
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
        
        // Configure session for G.711 μ-law
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            voice: process.env.REALTIME_DEFAULT_VOICE || 'alloy',
            instructions: process.env.REALTIME_DEFAULT_INSTRUCTIONS || 'You are a helpful assistant.',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 200,
              create_response: true,
              interrupt_response: true
            }
          }
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

  // Handle OpenAI messages
  function handleOpenAIMessage(msg) {
    switch (msg.type) {
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
        
      case 'input_audio_buffer.speech_started':
        // Handle barge-in
        twilioWS.send(JSON.stringify({
          event: 'clear',
          streamSid: state.streamSid
        }));
        
        // Truncate assistant response if speaking
        if (state.lastAssistantItem && state.responseStartTimestamp !== null && state.latestMediaTimestamp !== null) {
          const audioEndMs = Math.max(0, state.latestMediaTimestamp - state.responseStartTimestamp);
          if (oaiWS && oaiWS.readyState === WebSocket.OPEN) {
            oaiWS.send(JSON.stringify({
              type: 'conversation.item.truncate',
              item_id: state.lastAssistantItem,
              content_index: 0,
              audio_end_ms: audioEndMs
            }));
          }
        }
        
        state.lastAssistantItem = null;
        state.responseStartTimestamp = null;
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
            
            // Don't cancel on every packet - let VAD handle interruptions
            // Only send audio
            oaiWS.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.media.payload
            }));
          }
          break;
          
        case 'mark':
          // Handle custom marks for turn management
          if (msg.mark?.name === 'commit' && oaiWS && oaiWS.readyState === WebSocket.OPEN) {
            oaiWS.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            oaiWS.send(JSON.stringify({ type: 'response.create' }));
            console.log('Manual turn commit');
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