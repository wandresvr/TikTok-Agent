// listener/tiktokListener.js
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

function startListener(username, onMessage, options = {}) {
  // Debug: Verificar opciones recibidas
  console.log(`🔍 [DEBUG] Opciones recibidas en startListener:`);
  console.log(`   sessionId: ${options.sessionId ? `${options.sessionId.substring(0, 10)}...` : 'no configurado'}`);
  console.log(`   ttTargetIdc: ${options.ttTargetIdc || 'no configurado'}`);
  console.log(`   Nota: signApiKey se configura globalmente con SignConfig (no en options)`);
  
  const tiktok = new TikTokLiveConnection(username, options);
  let reconnectTimer = null;
  let isClosing = false;
  let connectionOptions = options; // Guardar opciones para verificar autenticación

  function connect() {
    if (isClosing) return;

    console.log(`🔗 Conectando al live de @${username}...`);

    tiktok.connect()
      .then((state) => {
        console.log('\n' + '='.repeat(60));
        console.log('✅ CONECTADO AL LIVE');
        console.log('='.repeat(60));
        console.log(`👤 Usuario: @${username}`);
        console.log(`🆔 Room ID: ${state.roomId}`);
        
        // Mostrar información del room si está disponible
        if (state.roomInfo) {
          const roomInfo = state.roomInfo;
          if (roomInfo.owner) {
            const ownerId = roomInfo.owner.unique_id || roomInfo.owner.uniqueId || username;
            console.log(`📺 Streamer: @${ownerId}`);
            if (roomInfo.owner.nickname) {
              console.log(`   Nombre: ${roomInfo.owner.nickname}`);
            }
          }
          if (roomInfo.title) {
            console.log(`📝 Título: ${roomInfo.title}`);
          }
          const viewerCount = roomInfo.viewer_count || roomInfo.viewerCount || roomInfo.user_count || roomInfo.userCount;
          if (viewerCount !== undefined && viewerCount !== null) {
            console.log(`👀 Espectadores: ${viewerCount.toLocaleString()}`);
          }
          const streamUrl = roomInfo.stream_url?.hls_pull_url || roomInfo.streamUrl?.hlsPullUrl;
          if (streamUrl) {
            console.log(`🔗 Stream URL disponible`);
          }
        } else {
          console.log(`ℹ️ Información del room no disponible`);
        }
        
        console.log('='.repeat(60) + '\n');
        
        // Limpiar timer de reconexión si existe
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      })
      .catch(err => {
        const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || 'Error desconocido';
        console.error('\n' + '='.repeat(60));
        console.error('❌ ERROR AL CONECTAR');
        console.error('='.repeat(60));
        console.error(`👤 Usuario: @${username}`);
        console.error(`❌ Error: ${errorMsg}`);
        
        // Verificar si el error indica que el usuario no está en vivo
        const errorLower = errorMsg.toLowerCase();
        if (errorLower.includes('not live') || errorLower.includes('no live') || 
            errorLower.includes('offline') || errorLower.includes('no está en vivo')) {
          console.error('💡 El usuario no está transmitiendo en vivo actualmente');
          console.error(`🌐 Verifica: https://www.tiktok.com/@${username}/live`);
        }
        
        console.error('='.repeat(60) + '\n');
        
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

  // Escuchar eventos de chat
  tiktok.on(WebcastEvent.CHAT, data => {
    onMessage({
      userId: data.user?.userId || data.userId,
      user: data.user?.uniqueId || data.uniqueId,
      text: data.comment
    });
  });

  // 🔑 MANEJO DE ERRORES
  tiktok.on('error', err => {
    const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || 'Error desconocido';
    console.error('⚠️ TikTok error:', errorMsg);
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

  // Retornar objeto con funciones para cerrar y enviar mensajes
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
    },
    sendMessage: async (message) => {
      try {
        if (!tiktok.isConnected) {
          console.warn('⚠️ No conectado, no se puede enviar mensaje');
          return false;
        }
        // Verificar si tiene autenticación
        if (!connectionOptions.sessionId || !connectionOptions.ttTargetIdc) {
          console.warn('⚠️ No hay credenciales configuradas, no se puede enviar mensaje');
          return false;
        }
        await tiktok.sendMessage(message);
        return true;
      } catch (err) {
        const errorMsg = err?.message || err?.toString() || 'Error desconocido';
        console.error(`❌ Error enviando mensaje: ${errorMsg}`);
        
        // Detectar error de premium/Euler Stream
        if (errorMsg.includes('Premium Feature') || errorMsg.includes('eulerstream.com') || errorMsg.includes('401')) {
          console.error('\n' + '='.repeat(60));
          console.error('💳 ENVIAR MENSAJES REQUIERE PLAN PREMIUM');
          console.error('='.repeat(60));
          console.error('📝 Para enviar mensajes en TikTok Live necesitas:');
          console.error('   1. Una API key de Euler Stream');
          console.error('   2. Un plan premium de Euler Stream');
          console.error('');
          console.error('🔗 Obtén tu API key en: https://www.eulerstream.com/pricing');
          console.error('💡 Configura EULER_API_KEY en tu archivo .env');
          console.error('='.repeat(60) + '\n');
          return false;
        }
        
        // Si el error indica falta de autenticación
        if (errorMsg.toLowerCase().includes('auth') || errorMsg.toLowerCase().includes('session')) {
          console.error('💡 Verifica que las credenciales en .env sean correctas');
        }
        return false;
      }
    },
    connection: tiktok
  };
}

module.exports = { startListener };
