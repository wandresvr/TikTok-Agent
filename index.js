// index.js
const { startListener } = require('./listener/tiktokListener');
const { handleMessage } = require('./processor/router');
const { startNotifier } = require('./responder/notifier');

// Guardar referencias para poder cerrarlas
const tiktokConnection = startListener('saximt', async msg => {
  try {
    await handleMessage(msg);
  } catch (e) {
    console.error('Error procesando mensaje', e.message);
  }
});

const notifier = startNotifier();

// Función para cerrar todas las conexiones
function cleanup() {
  console.log('\n🛑 Cerrando conexiones...');
  tiktokConnection.close();
  notifier.stop();
  console.log('✅ Conexiones cerradas. Saliendo...');
  process.exit(0);
}

// Manejar señales de cierre (Ctrl+C, SIGTERM, etc.)
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (err) => {
  console.error('❌ Error no capturado:', err);
  cleanup();
});
