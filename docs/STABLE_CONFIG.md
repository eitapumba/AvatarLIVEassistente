# Configuração Estável do Avatar

Este documento descreve a configuração estável do sistema de avatar, incluindo os pontos críticos que não devem ser alterados sem testes extensivos.

## Ordem de Inicialização

1. Inicialização do SimliClient:
```typescript
client.Initialize({
  apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY || '',
  faceID: simli_faceid,
  handleSilence: false,
  maxSessionLength: 300,
  maxIdleTime: 150,
  videoRef: videoRef,
  audioRef: audioRef
});

client.on('connected', handleConnected);
client.on('error', handleError);
client.start();
```

2. Aguardar Conexão ICE:
```typescript
await new Promise<void>((resolve, reject) => {
  let isResolved = false;
  const iceTimeout = setTimeout(() => {
    if (!isResolved) {
      console.log('Timeout na espera da conexão ICE, continuando...');
      isResolved = true;
      resolve();
    }
  }, 8000);

  const handleIceState = (state: string) => {
    if ((state === 'connected' || state === 'completed') && !isResolved) {
      clearTimeout(iceTimeout);
      isResolved = true;
      resolve();
    }
  };

  client.on('iceConnectionStateChange', handleIceState);
});
```

3. Iniciar WebSocket:
```typescript
await startConversation();
setConnectionState('connected');
setIsListening(true);
```

## Timeouts Críticos

- SimliClient: 15 segundos
- Conexão ICE: 8 segundos
- WebSocket: 5 segundos

## Eventos Importantes

```typescript
// SimliClient
client.on('connected', handleConnected);
client.on('error', handleError);
client.on('iceConnectionStateChange', handleIceState);
client.on('disconnected', handleDisconnect);

// WebSocket
socket.onopen = () => {...};
socket.onmessage = async (event) => {...};
socket.onerror = (error) => {...};
socket.onclose = (event) => {...};
```

## Processo de Limpeza

```typescript
const handleStop = () => {
  setIsListening(false); // Primeiro desativa o microfone
  setTimeout(() => {
    resetState(); // Depois limpa o resto
  }, 100);
};

const resetState = () => {
  setIsLoading(false);
  setError('');
  setIsAvatarVisible(false);
  setIsListening(false);
  setConnectionState('idle');
  connectionAttempts.current = 0;
  cleanupConnections();
};
```

## Notas Importantes

1. Não alterar a ordem de inicialização
2. Manter os timeouts conforme especificado
3. Não remover nenhum dos eventos principais
4. Sempre desativar o microfone antes de resetar o estado
5. Manter o delay de 100ms entre desativar o microfone e resetar o estado

## Problemas Conhecidos

1. A conexão ICE pode demorar para estabelecer, mas o sistema continua funcionando após o timeout
2. Ocasionalmente pode haver um delay na inicialização do avatar
3. O microfone precisa ser desativado antes de qualquer reset para evitar problemas 