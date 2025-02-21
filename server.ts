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
const model = genAI.getGenerativeModel({ 
  model: "gemini-pro",
  generationConfig: {
    maxOutputTokens: 200, // Limita o tamanho da resposta
    temperature: 0.7, // Ajusta a criatividade
    topP: 0.8, // Ajusta a diversidade
    topK: 40 // Ajusta a precisão
  }
});

// Initialize Google Cloud TTS
const ttsClient = new textToSpeech.TextToSpeechClient({
  keyFilename: process.env.GOOGLE_CLOUD_TTS_KEY
});

let currentGeminiStream: { stream: AsyncIterable<any>; controller: AbortController } | null = null;

// Connection manager to keep track of active connections
const connections = new Map<string, {
  prompt: string;
  status: 'initializing' | 'connected' | 'processing' | 'error' | 'disconnected';
  ws?: WebSocket;
  createdAt: number;
  lastActivity: number;
  isProcessing: boolean;
}>();

// Cleanup inactive connections periodically
setInterval(() => {
  const now = Date.now();
  Array.from(connections.entries()).forEach(([id, connection]) => {
    // Remove conexões inativas por mais de 5 minutos
    if (now - connection.lastActivity > 5 * 60 * 1000) {
      console.log(`Removendo conexão inativa (ID: ${id})`);
      if (connection.ws?.readyState === WebSocket.OPEN) {
        connection.ws.close();
      }
      connections.delete(id);
    }
  });
}, 60000);

app.post('/start-conversation', (req: any, res: any) => {
  try {
    console.log('Recebida solicitação para iniciar conversa');
    const { prompt } = req.body as { prompt: string };
    if (!prompt) {
      console.error('Prompt não fornecido');
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const validate = validateApiKeys();
    if (!validate.valid) {
      console.error('API key validation failed:', validate.errors);
      return res.status(400).json({ error: 'API key invalid: ' + validate.errors });
    }
    
    const connectionId = Date.now().toString();
    connections.set(connectionId, { 
      prompt,
      status: 'initializing',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isProcessing: false
    });
    
    console.log(`Nova conversa iniciada (ID: ${connectionId}) com prompt: "${prompt.substring(0, 50)}..."`);
    res.json({ connectionId, message: 'Conversation started. Connect to WebSocket to continue.' });
  } catch (error) {
    console.error('Erro ao iniciar conversa:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }

  const { pathname, query } = url.parse(request.url, true);

  if (pathname === '/ws') {
    const connectionId = Array.isArray(query.connectionId) ? query.connectionId[0] : query.connectionId;
    if (!connectionId || !connections.has(connectionId)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const connection = connections.get(connectionId);
      if (!connection) {
        console.error(`Conexão ${connectionId} não encontrada após validação`);
        ws.close();
        return;
      }
      console.log(`WebSocket: Client connected (ID: ${connectionId})`);
      setupWebSocket(ws, connection.prompt, connectionId);
    });
  } else {
    socket.destroy();
  }
});

const setupWebSocket = (ws: WebSocket, initialPrompt: string, connectionId: string) => {
  console.log(`Configurando WebSocket para conexão ${connectionId}`);

  const connectionInfo = connections.get(connectionId);
  if (!connectionInfo) {
    console.error(`Conexão ${connectionId} não encontrada`);
    ws.close();
    return;
  }

  connectionInfo.status = 'connected';
  connectionInfo.ws = ws;
  connectionInfo.lastActivity = Date.now();
  connections.set(connectionId, connectionInfo);

  const pingInterval = setInterval(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        connectionInfo.lastActivity = Date.now();
      }
    } catch (error) {
      console.error('Erro ao enviar ping:', error);
    }
  }, 30000);

  ws.on("message", async (message: any) => {
    try {
      connectionInfo.lastActivity = Date.now();
      const data = JSON.parse(message.toString());
      
      if (data.type === 'transcript') {
        const transcript = data.content;
        
        if (connectionInfo.isProcessing) {
          console.log('Já existe um processamento em andamento, interrompendo...');
          if (currentGeminiStream) {
            currentGeminiStream.controller.abort();
            currentGeminiStream = null;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`Recebida transcrição: "${transcript}" (ID: ${connectionId})`);
        
        if (transcript.trim()) {
          connectionInfo.isProcessing = true;
          connectionInfo.status = 'processing';
          try {
            await promptLLM(ws, initialPrompt, transcript, connectionId);
          } finally {
            connectionInfo.isProcessing = false;
            connectionInfo.status = 'connected';
          }
        }
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      connectionInfo.isProcessing = false;
      connectionInfo.status = 'error';
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            content: 'Erro ao processar mensagem' 
          }));
        }
      } catch (sendError) {
        console.error('Erro ao enviar mensagem de erro:', sendError);
      }
    }
  });

  ws.on("error", (error) => {
    console.error(`Erro no WebSocket (ID: ${connectionId}):`, error);
    cleanup();
  });

  ws.on("close", () => {
    console.log(`WebSocket fechado (ID: ${connectionId})`);
    cleanup();
  });

  const cleanup = () => {
    clearInterval(pingInterval);
    if (currentGeminiStream) {
      currentGeminiStream.controller.abort();
      currentGeminiStream = null;
    }
    const connection = connections.get(connectionId);
    if (connection) {
      connection.status = 'disconnected';
      connection.isProcessing = false;
      connections.delete(connectionId);
    }
  };

  // Enviar mensagem de confirmação de conexão
  try {
    ws.send(JSON.stringify({ 
      type: 'connected', 
      content: 'WebSocket connection established' 
    }));
  } catch (error) {
    console.error('Erro ao enviar mensagem de confirmação:', error);
  }
}

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\*/g, '') // Remove asteriscos
    .replace(/```[^`]*```/g, '') // Remove blocos de código
    .replace(/`[^`]*`/g, '') // Remove código inline
    .trim();
}

async function startGoogleTTS(ws: WebSocket, text: string, connectionId: string) {
  if (!text.trim()) {
    console.log('Texto vazio recebido para TTS, ignorando');
    return;
  }

  try {
    console.log(`Iniciando TTS para texto: "${text.substring(0, 50)}..." (ID: ${connectionId})`);
    const cleanedText = cleanTextForSpeech(text);
    
    if (!cleanedText.trim()) {
      console.log('Texto limpo ficou vazio, ignorando');
      return;
    }

    const [response] = await ttsClient.synthesizeSpeech({
      input: { 
        ssml: `<speak>${cleanedText}</speak>`,
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
        pitch: -2.0,
        speakingRate: 1.3
      },
    });

    if (!response.audioContent) {
      console.error('TTS não retornou conteúdo de áudio');
      return;
    }

    const audioContent = Buffer.from(response.audioContent);
    console.log(`Áudio gerado: ${audioContent.length} bytes`);

    const chunkSize = 4096;
    let i = 0;
    
    while (i < audioContent.length) {
      if (!connections.has(connectionId)) {
        console.log(`Processo TTS interrompido: Conexão ${connectionId} não existe mais`);
        break;
      }
      
      if (ws.readyState !== WebSocket.OPEN) {
        console.log(`Processo TTS interrompido: WebSocket não está mais aberto`);
        break;
      }

      const end = Math.min(i + chunkSize, audioContent.length);
      const chunk = audioContent.slice(i, end);
      ws.send(chunk);
      i += chunkSize;
      
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  } catch (error) {
    console.error(`Erro no TTS (ID: ${connectionId}):`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        content: 'Erro ao gerar áudio' 
      }));
    }
  }
}

async function promptLLM(ws: WebSocket, initialPrompt: string, prompt: string, connectionId: string) {
  try {
    console.log(`Iniciando LLM para prompt: "${prompt}" (ID: ${connectionId})`);
    const controller = new AbortController();
    
    const chat = model.startChat({
      history: [{
        role: 'user',
        parts: [{ text: initialPrompt }]
      }]
    });

    const result = await chat.sendMessageStream(prompt);
    currentGeminiStream = { stream: result.stream, controller };

    let fullResponse: string = '';
    let sentenceBuffer: string = '';

    try {
      for await (const chunk of result.stream) {
        if (!connections.has(connectionId)) {
          console.log(`Processo LLM interrompido: Conexão ${connectionId} não existe mais`);
          break;
        }

        if (ws.readyState !== WebSocket.OPEN) {
          console.log(`Processo LLM interrompido: WebSocket não está mais aberto`);
          break;
        }

        const chunkText = chunk.text();
        fullResponse += chunkText;
        sentenceBuffer += chunkText;

        ws.send(JSON.stringify({ type: 'text', content: chunkText }));

        if (sentenceBuffer.match(/[.!?]\s*$/)) {
          console.log(`Enviando sentença para TTS: "${sentenceBuffer}"`);
          await startGoogleTTS(ws, sentenceBuffer, connectionId);
          sentenceBuffer = '';
        }
      }

      if (sentenceBuffer.length > 0) {
        console.log(`Enviando buffer final para TTS: "${sentenceBuffer}"`);
        await startGoogleTTS(ws, sentenceBuffer, connectionId);
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Stream Gemini interrompido por nova fala');
      } else {
        throw error;
      }
    }

    currentGeminiStream = null;

  } catch (error) {
    console.error(`Erro no LLM (ID: ${connectionId}):`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        content: 'Erro ao processar resposta' 
      }));
    }
  }
}

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});