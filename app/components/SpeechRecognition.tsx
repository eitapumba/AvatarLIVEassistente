import React, { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionProps {
  onTranscript: (text: string) => void;
  isListening: boolean;
}

const SpeechRecognition: React.FC<SpeechRecognitionProps> = ({ onTranscript, isListening }) => {
  const recognitionRef = useRef<any>(null);
  const [error, setError] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState(false);

  useEffect(() => {
    const checkMicrophoneSupport = async () => {
      try {
        // Verifica se o navegador suporta a Web Speech API
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          console.error('Navegador não suporta reconhecimento de voz');
          setError('Seu navegador não suporta reconhecimento de voz. Por favor, use o Chrome.');
          return false;
        }

        // Verifica permissão do microfone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Permissão do microfone concedida');
        stream.getTracks().forEach(track => track.stop()); // Libera o microfone
        setHasMicrophonePermission(true);
        return true;
      } catch (error) {
        console.error('Erro ao verificar microfone:', error);
        setError('Por favor, permita o acesso ao microfone para usar o reconhecimento de voz.');
        setHasMicrophonePermission(false);
        return false;
      }
    };

    const initializeRecognition = async () => {
      if (!isListening) {
        console.log('Reconhecimento não iniciado pois isListening é false');
        return;
      }

      try {
        // Verifica se o navegador suporta a Web Speech API
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          console.error('Navegador não suporta reconhecimento de voz');
          setError('Seu navegador não suporta reconhecimento de voz. Por favor, use o Chrome.');
          return;
        }

        console.log('Inicializando reconhecimento de voz...');
        const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        recognitionRef.current = new SpeechRecognition();

        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = 'pt-BR';
        recognitionRef.current.maxAlternatives = 1;

        recognitionRef.current.onstart = () => {
          console.log('Reconhecimento de voz iniciado');
          setIsInitialized(true);
          setHasMicrophonePermission(true);
        };

        recognitionRef.current.onend = () => {
          console.log('Reconhecimento de voz finalizado');
          if (isListening && hasMicrophonePermission) {
            console.log('Reiniciando reconhecimento de voz...');
            try {
              setTimeout(() => {
                if (recognitionRef.current && isListening) {
                  recognitionRef.current.start();
                }
              }, 300);
            } catch (error) {
              console.error('Erro ao reiniciar reconhecimento:', error);
            }
          } else {
            setIsInitialized(false);
          }
        };

        recognitionRef.current.onresult = (event: any) => {
          try {
            const transcript = Array.from(event.results)
              .map((result: any) => result[0].transcript)
              .join(' ');

            if (event.results[event.results.length - 1].isFinal) {
              console.log('Transcrição final:', transcript);
              if (transcript.trim()) {
                onTranscript(transcript);
              }
            }
          } catch (error) {
            console.error('Erro ao processar resultado:', error);
          }
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error('Erro no reconhecimento de voz:', event.error);
          if (event.error === 'not-allowed') {
            setHasMicrophonePermission(false);
            setError('Por favor, permita o acesso ao microfone para usar o reconhecimento de voz.');
          } else if (event.error === 'no-speech') {
            if (isListening && hasMicrophonePermission) {
              try {
                setTimeout(() => {
                  if (recognitionRef.current && isListening) {
                    recognitionRef.current.start();
                  }
                }, 500);
              } catch (error) {
                console.error('Erro ao reiniciar após no-speech:', error);
              }
            }
          } else {
            setTimeout(() => {
              if (isListening && hasMicrophonePermission) {
                try {
                  if (recognitionRef.current) {
                    recognitionRef.current.start();
                  }
                } catch (error) {
                  console.error('Erro ao reiniciar após erro:', error);
                  setError(`Erro no reconhecimento de voz: ${event.error}`);
                }
              }
            }, 1000);
          }
        };

        console.log('Iniciando reconhecimento de voz...');
        recognitionRef.current.start();

      } catch (error) {
        console.error('Erro ao inicializar reconhecimento de voz:', error);
        setError('Erro ao inicializar o reconhecimento de voz.');
      }
    };

    if (isListening && !isInitialized) {
      console.log('Tentando inicializar reconhecimento de voz...');
      initializeRecognition();
    } else if (!isListening && isInitialized) {
      console.log('Parando reconhecimento de voz...');
      try {
        recognitionRef.current?.stop();
        setIsInitialized(false);
      } catch (error) {
        console.error('Erro ao parar reconhecimento:', error);
      }
    }

    return () => {
      if (recognitionRef.current) {
        console.log('Limpando reconhecimento de voz...');
        try {
          recognitionRef.current.stop();
          setIsInitialized(false);
        } catch (error) {
          console.error('Erro ao limpar reconhecimento:', error);
        }
      }
    };
  }, [isListening, onTranscript]);

  if (error) {
    return <div className="text-red-500 text-sm">{error}</div>;
  }

  return null;
};

export default SpeechRecognition; 