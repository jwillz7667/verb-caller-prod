# Twilio WebSocket Server for OpenAI Realtime API

This is a standalone WebSocket server that bridges Twilio Media Streams to OpenAI's Realtime API.

## Deploy to Railway

1. **Sign up for Railway**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Create a new project**
   - Click "New Project"
   - Choose "Deploy from GitHub repo"
   - Select your forked repo or "Empty Project" and upload these files

3. **Configure environment variables** (optional)
   - `REALTIME_DEFAULT_MODEL`: gpt-realtime
   - `REALTIME_DEFAULT_VOICE`: alloy
   - `REALTIME_DEFAULT_INSTRUCTIONS`: Your custom instructions

4. **Deploy**
   - Railway will automatically detect the Node.js app
   - It will run `npm install` and `npm start`
   - You'll get a URL like: `https://your-app.up.railway.app`

5. **Update your main app**
   - In your main app's `.env` file, add:
     ```
     TWILIO_WEBSOCKET_URL=wss://your-app.up.railway.app
     ```
   - Update the TwiML route to use this URL

## Deploy to Render

1. **Sign up for Render**
   - Go to [render.com](https://render.com)
   - Sign up with GitHub

2. **Create a new Web Service**
   - Click "New +"
   - Choose "Web Service"
   - Connect your GitHub repo or upload files

3. **Configure**
   - Name: twilio-websocket-server
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

4. **Add environment variables** (optional)
   - Same as Railway above

5. **Deploy**
   - Click "Create Web Service"
   - You'll get a URL like: `https://your-app.onrender.com`

## Deploy to Heroku

1. **Install Heroku CLI**
   ```bash
   brew tap heroku/brew && brew install heroku
   ```

2. **Login and create app**
   ```bash
   heroku login
   heroku create your-twilio-websocket
   ```

3. **Deploy**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git push heroku main
   ```

4. **Set environment variables** (optional)
   ```bash
   heroku config:set REALTIME_DEFAULT_MODEL=gpt-realtime
   ```

## Testing Locally

```bash
npm install
npm start
```

Test WebSocket connection:
```bash
wscat -c ws://localhost:3001?secret=your_openai_secret
```

## How It Works

1. Twilio sends audio via WebSocket in μ-law 8kHz format
2. Server forwards audio to OpenAI Realtime API
3. OpenAI processes and responds with audio
4. Server forwards response back to Twilio
5. Twilio plays audio to the caller

## Important Notes

- The OpenAI ephemeral token is passed via the `secret` query parameter
- The server maintains the WebSocket bridge between Twilio and OpenAI
- Audio is passed through in G.711 μ-law format (no conversion needed)
- VAD (Voice Activity Detection) is handled by OpenAI
 - For GA Realtime API, do not send the `OpenAI-Beta: realtime=v1` header