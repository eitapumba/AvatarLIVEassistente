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
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const simliClientRef = useRef<SimliClient | null>(null);
  const connectionAttempts = useRef(0);
  const maxAttempts = 3;

  // Criar SimliClient apenas quando necessário
  const getSimliClient = useCallback(() => {
    if (!simliClientRef.current) {
      simliClientRef.current = new SimliClient();
    }
    return simliClientRef.current;
  }, []);

  const cleanupConnections = useCallback(() => {
    console.log('Limpando conexões...');
    
    // 1. Limpa WebSocket
    if (socketRef.current) {
      try {
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.close();
        }
      } catch (error) {
        console.error('Erro ao fechar WebSocket:', error);
      }
      socketRef.current = null;
    }

    // 2. Limpa SimliClient
    if (simliClientRef.current) {
      try {
        simliClientRef.current.ClearBuffer();
      } catch (error) {
        console.error('Erro ao limpar SimliClient:', error);
      }
      simliClientRef.current = null;
    }

    // 3. Reseta estados
    setIsAvatarVisible(false);
    setIsListening(false);
    setConnectionState('idle');
    setError('');
    setIsLoading(false);
  }, []);

  const resetState = useCallback(() => {
    cleanupConnections();
    onStart();
  }, [cleanupConnections, onStart]);

  const handleStop = useCallback(() => {
    console.log('Parando sistema...');
    setIsListening(false); // Primeiro desativa o microfone
    setTimeout(() => {
      resetState(); // Depois limpa o resto
    }, 100); // Delay necessário entre desativar microfone e resetar estado
  }, [resetState]);

  const initializeSimliClient = useCallback(() => {
    if (!videoRef.current || !audioRef.current) {
      throw new Error('Refs não estão prontos');
    }

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

    return client;
  }, [simli_faceid, getSimliClient]);

  const processAudioData = useCallback(async (audioData: ArrayBuffer) => {
    try {
      if (!simliClientRef.current) {
        console.warn('SimliClient não inicializado. Ignorando dados de áudio.');
        return;
      }

      // Converte ArrayBuffer para Uint8Array
      const uint8Data = new Uint8Array(audioData);

      // Tenta enviar o áudio com retry
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 100;

      const sendAudioWithRetry = async (): Promise<void> => {
        try {
          await simliClientRef.current?.sendAudioData(uint8Data);
        } catch (error) {
          console.error(`Erro ao enviar chunk de áudio (tentativa ${retryCount + 1}):`, error);
          if (retryCount < maxRetries) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return sendAudioWithRetry();
          }
          throw error;
        }
      };

      await sendAudioWithRetry();
    } catch (error) {
      console.error('Erro fatal ao processar áudio:', error);
      handleStop();
    }
  }, [handleStop]);

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
      }, 5000); // Timeout WebSocket conforme documentação

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
        handleStop();
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
    try {
      if (connectionState !== 'idle') {
        console.log('Sistema já está inicializando ou conectado');
        return;
      }

      resetState();
      setIsLoading(true);
      setConnectionState('connecting');
      onStart();
      
      // Mostra o avatar imediatamente
      setIsAvatarVisible(true);
      console.log('Avatar visível, iniciando conexões...');

      // 1. Solicitar permissão do microfone em background
      try {
        console.log('Solicitando permissão do microfone...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('Permissão do microfone concedida');
      } catch (error) {
        console.error('Erro ao solicitar microfone:', error);
        throw new Error('Por favor, permita o acesso ao microfone para continuar.');
      }
      
      // 2. Inicializa SimliClient e aguarda conexão
      try {
        const client = initializeSimliClient();
        console.log('SimliClient inicializado');

        // Aguarda conexão inicial
        await new Promise<void>((resolve, reject) => {
          let isResolved = false;
          const iceTimeout = setTimeout(() => {
            if (!isResolved) {
              console.log('Timeout na espera da conexão ICE, continuando...');
              isResolved = true;
              resolve();
            }
          }, 8000); // Timeout ICE conforme documentação

          const handleIceState = (state: string) => {
            console.log('Estado ICE:', state);
            if ((state === 'connected' || state === 'completed') && !isResolved) {
              clearTimeout(iceTimeout);
              isResolved = true;
              resolve();
            }
          };

          const handleConnected = () => {
            console.log('SimliClient conectado');
            if (!isResolved) {
              clearTimeout(iceTimeout);
              isResolved = true;
              resolve();
            }
          };

          const handleError = (error: any) => {
            console.error('Erro no SimliClient:', error);
            if (!isResolved) {
              clearTimeout(iceTimeout);
              isResolved = true;
              reject(new Error('Erro na conexão com o avatar'));
            }
          };

          client.on('track', (track: MediaStreamTrack) => {
            console.log(`Track ${track.kind} recebido`);
          });

          client.on('connected', handleConnected);
          client.on('error', handleError);
          client.on('iceConnectionStateChange', handleIceState);

          // Inicia a sessão após configurar os eventos
          client.start();
        });

      } catch (error) {
        console.error('Erro ao inicializar SimliClient:', error);
        throw new Error('Falha ao conectar com o avatar');
      }

      // 3. Inicia conversa
      await startConversation();
      setConnectionState('connected');
      setIsListening(true);
      setIsLoading(false);
      console.log('Sistema totalmente inicializado');

    } catch (error: any) {
      console.error('Erro fatal ao iniciar sistema:', error);
      setError(error.message || 'Falha ao iniciar. Por favor, tente novamente.');
      resetState();
    }
  }, [onStart, startConversation, initializeSimliClient, cleanupConnections, resetState, connectionState]);

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
        style={{ minHeight: isAvatarVisible ? '280px' : '0' }}
      >
        <VideoBox video={videoRef} audio={audioRef} />
      </div>
      <div className="absolute bottom-2 left-2">
        {!isAvatarVisible ? (
          <button
            onClick={handleStart}
            disabled={isLoading}
            className={cn(
              "w-[40px] h-[40px] disabled:bg-[#343434] disabled:text-white disabled:hover:rounded-[100px] bg-simliblue text-white rounded-[100px] transition-all duration-300 hover:text-black hover:bg-white hover:rounded-sm",
              "flex justify-center items-center"
            )}
          >
            {isLoading ? (
              <IconSparkleLoader className="h-[16px] animate-loader" />
            ) : (
              <span className="font-abc-repro-mono font-bold">▶</span>
            )}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className={cn(
              "group text-white w-[40px] h-[40px] bg-red hover:rounded-sm hover:bg-white rounded-[100px] transition-all duration-300 flex items-center justify-center"
            )}
          >
            <span className="font-abc-repro-mono group-hover:text-black font-bold transition-all duration-300">
              ■
            </span>
          </button>
        )}
      </div>
      {error && (
        <div className="absolute bottom-2 left-14 bg-black bg-opacity-50 rounded px-2 py-1">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}
      <SpeechRecognition
        onTranscript={handleTranscript}
        isListening={isListening}
      />
    </>
  );
};

export default AvatarInteraction;