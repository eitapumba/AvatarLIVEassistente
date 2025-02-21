import React, { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionProps {
  onTranscript: (text: string) => void;
  isListening: boolean;
}

const SpeechRecognition: React.FC<SpeechRecognitionProps> = ({ onTranscript, isListening }) => {
  const recognitionRef = useRef<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Verifica se o navegador suporta a Web Speech API
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Seu navegador não suporta reconhecimento de voz. Por favor, use o Chrome.');
      return;
    }

    try {
      // Cria uma instância do reconhecimento de voz
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();

      // Configura o reconhecimento
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'pt-BR';

      // Manipula os resultados
      recognitionRef.current.onresult = (event: any) => {
        console.log('Reconhecimento de voz: resultado recebido');
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');

        if (event.results[event.results.length - 1].isFinal) {
          console.log('Transcrição final:', transcript);
          onTranscript(transcript);
        }
      };

      // Manipula erros
      recognitionRef.current.onerror = (event: any) => {
        console.error('Erro no reconhecimento de voz:', event.error);
        setError(`Erro no reconhecimento de voz: ${event.error}`);
      };

      // Manipula o início do reconhecimento
      recognitionRef.current.onstart = () => {
        console.log('Reconhecimento de voz iniciado');
      };

      // Manipula o fim do reconhecimento
      recognitionRef.current.onend = () => {
        console.log('Reconhecimento de voz finalizado');
        if (isListening) {
          console.log('Reiniciando reconhecimento de voz...');
          try {
            recognitionRef.current.start();
          } catch (error) {
            console.error('Erro ao reiniciar reconhecimento:', error);
          }
        }
      };

      // Solicita permissão do microfone
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          console.log('Permissão do microfone concedida');
        })
        .catch((error) => {
          console.error('Erro ao solicitar microfone:', error);
          setError('Por favor, permita o acesso ao microfone para usar o reconhecimento de voz.');
        });

    } catch (error) {
      console.error('Erro ao inicializar reconhecimento de voz:', error);
      setError('Erro ao inicializar o reconhecimento de voz.');
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (error) {
          console.error('Erro ao parar reconhecimento:', error);
        }
      }
    };
  }, [isListening, onTranscript]);

  useEffect(() => {
    if (!recognitionRef.current) return;

    try {
      if (isListening) {
        console.log('Iniciando reconhecimento de voz...');
        recognitionRef.current.start();
      } else {
        console.log('Parando reconhecimento de voz...');
        recognitionRef.current.stop();
      }
    } catch (error) {
      console.error('Erro ao controlar reconhecimento:', error);
    }
  }, [isListening]);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return null;
};

export default SpeechRecognition; 