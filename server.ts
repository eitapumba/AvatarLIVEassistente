import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech';
import url from 'url';
import { WebSocket } from 'ws';
import { validateApiKeys } from './utils/validateApiKeys';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Initialize Google Cloud TTS
const ttsClient = new textToSpeech.TextToSpeechClient({
  keyFilename: process.env.GOOGLE_CLOUD_TTS_KEY
});

let currentGeminiStream: { stream: AsyncIterable<any>; controller: AbortController } | null = null;

// Connection manager to keep track of active connections
const connections = new Map();

app.post('/start-conversation', (req: any, res: any) => {
  const { prompt } = req.body as { prompt: string };
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const validate = validateApiKeys();
  if (!validate.valid) {
    console.error('API key validation failed. Fix the following errors and run `npm run start` again:', validate.errors)
    return res.status(400).json({ error: 'API key invalid: ' + validate.errors });
  }
  
  const connectionId = Date.now().toString();
  connections.set(connectionId, { prompt });
  res.json({ connectionId, message: 'Conversation started. Connect to WebSocket to continue.' });
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }

  const { pathname, query } = url.parse(request.url, true);

  if (pathname === '/ws') {
    const connectionId = query.connectionId;
    if (!connectionId || !connections.has(connectionId)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const connection = connections.get(connectionId);
      console.log(`WebSocket: Client connected (ID: ${connectionId})`);
      setupWebSocket(ws, connection.prompt, connectionId);
    });
  } else {
    socket.destroy();
  }
});

const setupWebSocket = (ws: WebSocket, initialPrompt: string, connectionId: string | string[]) => {
  ws.on("message", async (message: any) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'transcript') {
        const transcript = data.content;
        console.log(`Web Speech API: [Transcript] ${transcript} (ID: ${connectionId})`);
        
        if (currentGeminiStream) {
          console.log('Interrupting current stream');
          currentGeminiStream.controller.abort();
          currentGeminiStream = null;
          ws.send(JSON.stringify({ type: 'interrupt' }));
        }

        await promptLLM(ws, initialPrompt, transcript, connectionId);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on("close", () => {
    console.log(`WebSocket: Client disconnected (ID: ${connectionId})`);
    connections.delete(connectionId);
  });

  connections.set(connectionId, { ...connections.get(connectionId), ws });
}

async function startGoogleTTS(ws: WebSocket, text: string, connectionId: string | string[]) {
  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { 
        ssml: `<speak>${text}</speak>`,
      },
      voice: {
        languageCode: 'pt-BR',
        name: 'pt-BR-Neural2-B',
        ssmlGender: 'MALE' as const
      },
      audioConfig: {
        audioEncoding: 'LINEAR16' as const,
        sampleRateHertz: 16000,
        effectsProfileId: ['large-home-entertainment-class-device'],
        pitch: 2.0,
        speakingRate: 1.3
      },
    });

    if (response.audioContent) {
      const audioContent = Buffer.from(response.audioContent);
      const chunkSize = 4096;
      let i = 0;
      
      while (i < audioContent.length) {
        if (!connections.has(connectionId)) {
          console.log(`TTS process stopped: Connection ${connectionId} no longer exists`);
          break;
        }
        const end = Math.min(i + chunkSize, audioContent.length);
        const chunk = audioContent.slice(i, end);
        ws.send(chunk);
        i += chunkSize;
        
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }
  } catch (error) {
    console.error(`Error in Google TTS (ID: ${connectionId}):`, error);
  }
}

async function promptLLM(ws: WebSocket, initialPrompt: string, prompt: string, connectionId: string | string[]) {
  try {
    const controller = new AbortController();
    
    const chat = model.startChat({
      history: initialPrompt ? [{
        role: 'user',
        parts: [{ text: initialPrompt }]
      }] : []
    });

    const result = await chat.sendMessageStream(prompt);
    currentGeminiStream = { stream: result.stream, controller };

    let fullResponse: string = '';

    try {
      for await (const chunk of result.stream) {
        if (!connections.has(connectionId)) {
          console.log(`LLM process stopped: Connection ${connectionId} no longer exists`);
          break;
        }

        const chunkText = chunk.text();
        fullResponse += chunkText;

        ws.send(JSON.stringify({ type: 'text', content: chunkText }));

        if (chunkText.match(/[.!?]\s*$/)) {
          await startGoogleTTS(ws, fullResponse, connectionId);
          fullResponse = '';
        }
      }

      if (fullResponse.length > 0) {
        await startGoogleTTS(ws, fullResponse, connectionId);
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Gemini stream aborted due to new speech');
      } else {
        throw error;
      }
    }

    currentGeminiStream = null;

  } catch (error) {
    console.error(`Error in promptLLM (ID: ${connectionId}):`, error);
  }
}

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});