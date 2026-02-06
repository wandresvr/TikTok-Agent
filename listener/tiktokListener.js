// listener/tiktokListener.js
const { WebcastPushConnection } = require('tiktok-live-connector');

function startListener(username, onMessage) {
  const tiktok = new WebcastPushConnection(username);
  let reconnectTimer = null;
  let isClosing = false;

  function connect() {
    if (isClosing) return;

    tiktok.connect()
      .then(() => {
        console.log('🎧 Conectado al live');
        // Limpiar timer de reconexión si existe
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      })
      .catch(err => {
        const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || 'Error desconocido';
        console.error('❌ Error conectando al live:', errorMsg);
        
        // Intentar reconectar después de 5 segundos (solo si no estamos cerrando)
        if (!isClosing) {
          console.log('🔄 Intentando reconectar en 5 segundos...');
          reconnectTimer = setTimeout(() => {
            console.log('🔄 Reintentando conexión...');
            connect();
          }, 5000);
        }
      });
  }

  // Iniciar conexión
  connect();

  tiktok.on('chat', data => {
    onMessage({
      userId: data.userId,
      user: data.uniqueId,
      text: data.comment
    });
  });

  // 🔑 MANEJO DE ERRORES DEL WS
  tiktok.on('error', err => {
    const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || 'Error desconocido';
    console.error('⚠️ TikTok WS error:', errorMsg);
  });

  tiktok.on('disconnected', () => {
    console.warn('🔌 Desconectado del live');
    
    // Intentar reconectar automáticamente (solo si no estamos cerrando)
    if (!isClosing) {
      console.log('🔄 Intentando reconectar en 3 segundos...');
      reconnectTimer = setTimeout(() => {
        console.log('🔄 Reintentando conexión...');
        connect();
      }, 3000);
    }
  });

  // Retornar función para cerrar la conexión
  return {
    close: () => {
      isClosing = true;
      console.log('🔌 Cerrando conexión de TikTok...');
      
      // Limpiar timer de reconexión
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      
      try {
        tiktok.disconnect();
      } catch (err) {
        // Ignorar errores al desconectar
      }
    }
  };
}

module.exports = { startListener };
