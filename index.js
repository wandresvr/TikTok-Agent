// index.js — orquestador puro. Wire-up de dependencias y arranque.
const dotenvResult = require('dotenv').config();
if (dotenvResult.error) {
  console.warn('⚠️ No se pudo cargar el archivo .env:', dotenvResult.error.message);
  console.log('💡 Asegúrate de que existe el archivo .env en la raíz del proyecto\n');
} else if (dotenvResult.parsed) {
  console.log('✅ Archivo .env cargado correctamente\n');
}

const config = require('./config');
const { bootstrap } = require('./config/bootstrap');
const { checkOllamaOnStart } = require('./llm/ollamaClient');

async function main() {
  // Actualizar catálogo de canciones desde YouTube antes de cargar el matcher RAG
  if (config.rag.enabled && config.rag.playlistUrl) {
    const { updateSongsFromPlaylist } = require('./rag/playlistUpdater');
    await updateSongsFromPlaylist(config.rag.playlistUrl);
  }

  // Cargar módulos que dependen de songs.json (ahora ya actualizado)
  const { startListener } = require('./listener/tiktokListener');
  const { handleMessage, setTikTokConnection } = require('./processor/router');
  const { startNotifier } = require('./responder/notifier');
  const { startPeriodicSender } = require('./responder/periodicSender');

  const { connectionOptions } = bootstrap();

  checkOllamaOnStart().then(() => {});

  const connection = startListener(config.tiktok.username, async msg => {
    try {
      await handleMessage(msg);
    } catch (e) {
      console.error('Error procesando mensaje', e.message);
    }
  }, connectionOptions);

  setTikTokConnection(connection);

  const notifier = startNotifier();
  const periodic = startPeriodicSender(msg => connection.sendMessage(msg));

  async function cleanup() {
    console.log('\n🛑 Cerrando conexiones...');
    periodic.stop();
    notifier.stop();
    if (typeof connection.close === 'function') await connection.close();
    console.log('✅ Conexiones cerradas. Saliendo...');
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
    cleanup();
  });
}

main().catch(err => {
  console.error('❌ Error fatal al iniciar:', err);
  process.exit(1);
});
