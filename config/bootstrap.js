// config/bootstrap.js
// Pre-flight: imprime el banner de inicio, configura SignConfig de Euler y
// construye las connectionOptions de TikTok.
// Debe ejecutarse después de cargar dotenv y antes de arrancar el listener.
const { SignConfig } = require('tiktok-live-connector');
const config = require('./index');

/**
 * Imprime el banner de inicio, configura Euler SignConfig y devuelve las
 * opciones de conexión listas para pasar a startListener.
 * @returns {{ connectionOptions: object }}
 */
function bootstrap() {
  const { username, sessionId, ttTargetIdc } = config.tiktok;
  const { eulerApiKey, useBrowser, browserDataDir } = config.sender;

  if (!config.bot.enableAutoSend) {
    console.log('🔇 Envío automático de mensajes deshabilitado (ENABLE_AUTO_SEND=false)\n');
  }

  console.log('\n' + '='.repeat(60));
  console.log('🚀 INICIANDO TIKTOK LIVE AGENT');
  console.log('='.repeat(60));
  console.log(`📱 Usuario objetivo: @${username}`);
  console.log(`🌐 URL del live: https://www.tiktok.com/@${username}/live`);

  if (useBrowser) {
    console.log(`📱 Envío de mensajes: screen scraping (navegador). Perfil: ${browserDataDir}`);
    console.log(`   💡 Primera vez: se abrirá el navegador; inicia sesión en TikTok y luego los mensajes se enviarán desde ahí.`);
  }

  // Euler Stream API Key
  console.log(`🔍 [DEBUG] EULER_API_KEY leída: ${eulerApiKey ? `${eulerApiKey.substring(0, 20)}... (${eulerApiKey.length} caracteres)` : 'null/undefined'}`);
  if (eulerApiKey) {
    SignConfig.apiKey = eulerApiKey;
    console.log('🔑 Euler Stream API Key: Configurada ✅ (usando SignConfig)');
    console.log(`   API Key: ${eulerApiKey.substring(0, 15)}...${eulerApiKey.substring(eulerApiKey.length - 5)}`);
    console.log(`   Longitud: ${eulerApiKey.length} caracteres`);
    console.log(`   Método: SignConfig.apiKey (recomendado por documentación oficial)`);
  } else {
    console.log('⚠️ Euler Stream API Key: No configurada');
    console.log('💡 Para enviar mensajes necesitas una API key de Euler Stream');
    console.log('🔗 Obtén tu API key en: https://www.eulerstream.com/pricing');
    console.log('💡 Verifica que EULER_API_KEY esté en tu archivo .env');
    console.log('📝 Nota: Puedes usar el tier gratuito/community si está disponible');
  }

  // Autenticación TikTok
  const connectionOptions = { fetchRoomInfoOnConnect: true };
  if (sessionId && ttTargetIdc) {
    connectionOptions.sessionId = sessionId;
    connectionOptions.ttTargetIdc = ttTargetIdc;
    console.log('🔐 Autenticación TikTok: Configurada ✅');
    console.log(`   Session ID: ${sessionId.substring(0, 10)}...`);
    console.log(`   Target IDC: ${ttTargetIdc}`);
    console.log(eulerApiKey
      ? '💬 Estado: Puede ENVIAR mensajes (requiere plan premium)'
      : '💬 Estado: Solo LECTURA (falta EULER_API_KEY para enviar mensajes)');
  } else {
    console.log('⚠️ Autenticación TikTok: No configurada');
    console.log('💡 Para enviar mensajes, configura TIKTOK_SESSION_ID y TIKTOK_TT_TARGET_IDC en .env');
    console.log('📖 Estado: Solo LECTURA (no puede enviar mensajes)');
  }
  console.log('='.repeat(60) + '\n');

  return { connectionOptions };
}

module.exports = { bootstrap };
