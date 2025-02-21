import VideoBox from '@/app/components/VideoBox';
import SpeechRecognition from '@/app/components/SpeechRecognition';
import cn from '@/app/utils/TailwindMergeAndClsx';
import IconSparkleLoader from "@/media/IconSparkleLoader";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SimliClient } from 'simli-client';

interface AvatarInteractionProps {
  simli_faceid: string;
  initialPrompt: string;
  onStart: () => void;
  showDottedFace: boolean;
}

const AvatarInteraction: React.FC<AvatarInteractionProps> = ({
  simli_faceid,
  initialPrompt,
  onStart,
  showDottedFace
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isAvatarVisible, setIsAvatarVisible] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const simliClientRef = useRef<SimliClient | null>(null);

  // Criar SimliClient apenas quando necessário
  const getSimliClient = useCallback(() => {
    if (!simliClientRef.current) {
      simliClientRef.current = new SimliClient();
    }
    return simliClientRef.current;
  }, []);

  const initializeSimliClient = useCallback(() => {
    if (videoRef.current && audioRef.current) {
      console.log('Inicializando SimliClient...');
      const client = getSimliClient();

      client.Initialize({
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY || '',
        faceID: simli_faceid,
        handleSilence: false,
        maxSessionLength: 300,
        maxIdleTime: 150,
        videoRef: videoRef,
        audioRef: audioRef
      });

      console.log('SimliClient inicializado');
    } else {
      console.error('Video ou Audio ref não estão prontos');
      throw new Error('Refs não estão prontos');
    }
  }, [simli_faceid, getSimliClient]);

  const cleanupConnections = useCallback(() => {
    try {
      if (simliClientRef.current) {
        simliClientRef.current.close();
        simliClientRef.current = null;
      }
      
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    } catch (error) {
      console.error('Erro ao limpar conexões:', error);
    }
  }, []);

  const handleStop = useCallback(() => {
    setIsLoading(false);
    setError('');
    setIsAvatarVisible(false);
    setIsListening(false);
    cleanupConnections();
  }, [cleanupConnections]);

  const processAudioData = useCallback((arrayBuffer: ArrayBuffer) => {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return;
    const client = simliClientRef.current;
    if (!client) return;

    try {
      const audioData = new Int16Array(arrayBuffer);
      if (audioData.length === 0) {
        console.warn('Buffer de áudio vazio recebido');
        return;
      }

      const uint8Data = new Uint8Array(audioData.buffer);
      const chunkSize = 4096;
      
      console.log(`Processando áudio: ${uint8Data.length} bytes em chunks de ${chunkSize}`);
      
      for (let i = 0; i < uint8Data.length; i += chunkSize) {
        const chunk = uint8Data.slice(i, Math.min(i + chunkSize, uint8Data.length));
        if (chunk.length > 0) {
          client.sendAudioData(chunk);
        }
      }
    } catch (error) {
      console.error('Erro ao processar áudio:', error);
    }
  }, []);

  const initializeWebSocket = useCallback((connectionId: string, retryCount = 0) => {
    try {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        console.log('Fechando conexão WebSocket existente...');
        socketRef.current.close();
      }

      console.log(`Iniciando nova conexão WebSocket (ID: ${connectionId})...`);
      socketRef.current = new WebSocket(`ws://localhost:8080/ws?connectionId=${connectionId}`);

      let wsTimeout = setTimeout(() => {
        if (socketRef.current?.readyState !== WebSocket.OPEN) {
          console.error('Timeout na conexão WebSocket');
          if (retryCount < 2) {
            console.log(`Tentando reconectar WebSocket (tentativa ${retryCount + 1})...`);
            initializeWebSocket(connectionId, retryCount + 1);
          } else {
            setError('Não foi possível estabelecer conexão WebSocket após 3 tentativas');
            handleStop();
          }
        }
      }, 5000);

      socketRef.current.onopen = () => {
        clearTimeout(wsTimeout);
        console.log(`WebSocket conectado com sucesso (ID: ${connectionId})`);
      };

      socketRef.current.onmessage = async (event) => {
        try {
          if (event.data instanceof Blob) {
            const arrayBuffer = await event.data.arrayBuffer();
            console.log(`Recebido áudio: ${arrayBuffer.byteLength} bytes`);
            await processAudioData(arrayBuffer);
          } else {
            const message = JSON.parse(event.data);
            console.log('Mensagem recebida:', message);
            if (message.type === 'interrupt') {
              console.log('Interrompendo resposta atual');
              simliClientRef.current?.ClearBuffer();
            }
          }
        } catch (error) {
          console.error('Erro ao processar mensagem do WebSocket:', error);
        }
      };

      socketRef.current.onerror = (error) => {
        console.error(`Erro no WebSocket (ID: ${connectionId}):`, error);
        setError('Erro na conexão WebSocket. Verifique se o servidor está rodando.');
      };

      socketRef.current.onclose = (event) => {
        console.log(`WebSocket fechado (ID: ${connectionId}). Código: ${event.code}, Razão: ${event.reason}`);
        if (!isLoading) {
          handleStop();
        }
      };
    } catch (error) {
      console.error('Erro ao inicializar WebSocket:', error);
      if (retryCount < 2) {
        console.log(`Tentando reconectar WebSocket (tentativa ${retryCount + 1})...`);
        setTimeout(() => initializeWebSocket(connectionId, retryCount + 1), 1000);
      } else {
        setError('Falha ao inicializar WebSocket após 3 tentativas');
        handleStop();
      }
    }
  }, [processAudioData, handleStop, isLoading]);

  const startConversation = useCallback(async () => {
    try {
      console.log('Iniciando conversa com prompt:', initialPrompt);
      const response = await fetch('http://localhost:8080/start-conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: initialPrompt
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro ao iniciar conversa');
      }

      const data = await response.json();
      console.log('Conversa iniciada com sucesso. ID:', data.connectionId);
      initializeWebSocket(data.connectionId);
    } catch (error) {
      console.error('Erro ao iniciar conversa:', error);
      setError('Falha ao iniciar. Por favor, tente novamente.');
      handleStop();
    }
  }, [initialPrompt, initializeWebSocket, handleStop]);

  const handleStart = useCallback(async () => {
    setIsLoading(true);
    setError('');
    onStart();

    try {
      console.log('Iniciando sistema...');
      
      // 1. Primeiro inicializa o SimliClient
      initializeSimliClient();
      console.log('SimliClient inicializado');

      // 2. Aguarda a conexão do SimliClient
      await new Promise<void>((resolve, reject) => {
        let connectionTimeout: NodeJS.Timeout;
        let tracksReceived = { audio: false, video: false };
        let iceConnected = false;
        let retryCount = 0;
        const MAX_RETRIES = 3;

        const checkConnection = () => {
          console.log(`Verificando conexão - Tracks Audio: ${tracksReceived.audio}, Video: ${tracksReceived.video}, ICE: ${iceConnected}`);
          if (iceConnected) {
            clearTimeout(connectionTimeout);
            console.log('Conexão ICE estabelecida, ativando avatar...');
            setIsAvatarVisible(true);
            // Aguarda um momento para iniciar o reconhecimento de voz
            setTimeout(() => {
              if (iceConnected) {
                console.log('Iniciando reconhecimento de voz...');
                setIsListening(true);
                resolve();
              }
            }, 2000);
          }
        };

        const handleTrack = (track: MediaStreamTrack) => {
          console.log('Track recebido:', track.kind);
          if (track.kind === 'audio') {
            tracksReceived.audio = true;
          } else if (track.kind === 'video') {
            tracksReceived.video = true;
          }
          console.log('Estado dos tracks atualizado:', tracksReceived);
        };

        const handleInitialConnect = () => {
          console.log('SimliClient conectado com sucesso');
          iceConnected = true;
          checkConnection();
        };

        const handleIceState = (state: string) => {
          console.log('Estado ICE:', state);
          if (state === 'connected' || state === 'completed') {
            iceConnected = true;
            checkConnection();
          } else if (state === 'disconnected' || state === 'failed') {
            console.log('ICE desconectado ou falhou, tentando reconexão...');
            iceConnected = false;
            setIsAvatarVisible(false);
            setIsListening(false);
            retryConnection();
          }
        };

        const retryConnection = () => {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`Tentativa ${retryCount} de ${MAX_RETRIES}`);
            tracksReceived = { audio: false, video: false };
            iceConnected = false;
            
            // Limpa o cliente atual
            const client = simliClientRef.current;
            if (client) {
              client.off('connected', handleInitialConnect);
              client.off('error', handleInitialError);
              client.off('track', handleTrack);
              client.off('iceConnectionStateChange', handleIceState);
              client.close();
              simliClientRef.current = null;
            }

            // Aguarda antes de tentar novamente
            setTimeout(() => {
              console.log('Tentando reconexão...');
              initializeSimliClient();
              const newClient = simliClientRef.current;
              if (newClient) {
                newClient.on('connected', handleInitialConnect);
                newClient.on('error', handleInitialError);
                newClient.on('track', handleTrack);
                newClient.on('iceConnectionStateChange', handleIceState);
                newClient.start();
              }
            }, 2000);
          } else {
            console.error('Máximo de tentativas de conexão atingido');
            reject(new Error('Máximo de tentativas de conexão atingido'));
          }
        };

        const handleInitialError = (error: any) => {
          console.error('Erro na conexão inicial do SimliClient:', error);
          retryConnection();
        };

        const client = simliClientRef.current;
        if (!client) {
          reject(new Error('SimliClient não inicializado'));
          return;
        }

        client.on('connected', handleInitialConnect);
        client.on('error', handleInitialError);
        client.on('track', handleTrack);
        client.on('iceConnectionStateChange', handleIceState);

        client.start();
        console.log('SimliClient.start() chamado');

        connectionTimeout = setTimeout(() => {
          console.log('Verificando estado final da conexão antes do timeout');
          console.log(`Estado atual - Audio: ${tracksReceived.audio}, Video: ${tracksReceived.video}, ICE: ${iceConnected}`);
          if (!iceConnected) {
            console.log('Timeout atingido, tentando reconexão...');
            retryConnection();
          }
        }, 15000);

        return () => {
          clearTimeout(connectionTimeout);
          if (client) {
            client.off('connected', handleInitialConnect);
            client.off('error', handleInitialError);
            client.off('track', handleTrack);
            client.off('iceConnectionStateChange', handleIceState);
          }
        };
      });

      // 3. Depois inicia a conversa e WebSocket
      await startConversation();
      console.log('Sistema inicializado com sucesso');
      setIsLoading(false);
    } catch (error) {
      console.error('Erro ao iniciar sistema:', error);
      setError('Falha ao iniciar. Por favor, tente novamente.');
      handleStop();
    }
  }, [onStart, startConversation, initializeSimliClient]);

  const handleTranscript = useCallback((transcript: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'transcript',
        content: transcript
      }));
    }
  }, []);

  useEffect(() => {
    // Limpar conexões quando o componente for desmontado
    return () => {
      cleanupConnections();
    };
  }, [cleanupConnections]);

  useEffect(() => {
    const client = simliClientRef.current;
    if (client) {
      const handleError = (error: any) => {
        console.error('Erro no SimliClient:', error);
        setError('Erro na conexão. Por favor, tente novamente.');
        handleStop();
      };

      const handleDisconnect = () => {
        console.log('SimliClient desconectado');
        if (isAvatarVisible) {
          setError('Conexão perdida. Por favor, tente novamente.');
          handleStop();
        }
      };

      const handleIceState = (state: string) => {
        console.log('Estado da conexão ICE:', state);
        if (state === 'failed' || state === 'disconnected') {
          console.error('Falha na conexão ICE:', state);
          setError('Falha na conexão. Por favor, tente novamente.');
          handleStop();
        }
      };

      client.on('error', handleError);
      client.on('disconnected', handleDisconnect);
      client.on('iceConnectionStateChange', handleIceState);

      return () => {
        client.off('error', handleError);
        client.off('disconnected', handleDisconnect);
        client.off('iceConnectionStateChange', handleIceState);
      };
    }
  }, [handleStop, isAvatarVisible]);

  return (
    <>
      <div
        className={cn(
          "transition-all duration-300",
          showDottedFace ? "h-0 overflow-hidden opacity-0" : "h-auto opacity-100"
        )}
        style={{ minHeight: isAvatarVisible ? '360px' : '0' }}
      >
        <VideoBox video={videoRef} audio={audioRef} />
      </div>
      <div className="flex flex-col items-center">
        {!isAvatarVisible ? (
          <button
            onClick={handleStart}
            disabled={isLoading}
            className={cn(
              "w-full h-[52px] mt-4 disabled:bg-[#343434] disabled:text-white disabled:hover:rounded-[100px] bg-simliblue text-white py-3 px-6 rounded-[100px] transition-all duration-300 hover:text-black hover:bg-white hover:rounded-sm",
              "flex justify-center items-center"
            )}
          >
            {isLoading ? (
              <>
                <IconSparkleLoader className="h-[20px] animate-loader" />
                <span className="ml-2 font-abc-repro-mono">Conectando...</span>
              </>
            ) : (
              <span className="font-abc-repro-mono font-bold w-[164px]">
                Iniciar Interação
              </span>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-4 w-full">
            <button
              onClick={handleStop}
              className={cn(
                "mt-4 group text-white flex-grow bg-red hover:rounded-sm hover:bg-white h-[52px] px-6 rounded-[100px] transition-all duration-300"
              )}
            >
              <span className="font-abc-repro-mono group-hover:text-black font-bold w-[164px] transition-all duration-300">
                Parar Interação
              </span>
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-4 text-red-500 text-center">{error}</p>
      )}
      <SpeechRecognition
        onTranscript={handleTranscript}
        isListening={isListening}
      />
    </>
  );
};

export default AvatarInteraction;