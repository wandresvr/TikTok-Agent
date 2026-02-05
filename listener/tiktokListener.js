// listener/tiktokListener.js
const { WebcastPushConnection } = require('tiktok-live-connector');

function startListener(username, onMessage) {
  const tiktok = new WebcastPushConnection(username);

  tiktok.connect()
    .then(() => {
      console.log('🎧 Conectado al live');
    })
    .catch(err => {
      console.error('❌ Error conectando al live:', err.message);
    });

  tiktok.on('chat', data => {
    onMessage({
      userId: data.userId,
      user: data.uniqueId,
      text: data.comment
    });
  });

  // 🔑 MANEJO DE ERRORES DEL WS
  tiktok.on('error', err => {
    console.error('⚠️ TikTok WS error:', err.message);
  });

  tiktok.on('disconnected', () => {
    console.warn('🔌 Desconectado del live');
  });
}

module.exports = { startListener };
