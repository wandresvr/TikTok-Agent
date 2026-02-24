// index.js
// Cargar variables de entorno desde .env
const dotenvResult = require('dotenv').config();

// Verificar si se cargó el archivo .env
if (dotenvResult.error) {
  console.warn('⚠️ No se pudo cargar el archivo .env:', dotenvResult.error.message);
  console.log('💡 Asegúrate de que existe el archivo .env en la raíz del proyecto\n');
} else if (dotenvResult.parsed) {
  console.log('✅ Archivo .env cargado correctamente\n');
}

if (process.env.ENABLE_AUTO_SEND === 'false') {
  console.log('🔇 Envío automático de mensajes deshabilitado (ENABLE_AUTO_SEND=false)\n');
}

const { SignConfig } = require('tiktok-live-connector');
const { startListener } = require('./listener/tiktokListener');
const { handleMessage, setTikTokConnection } = require('./processor/router');
const { startNotifier } = require('./responder/notifier');
const { generateResponse, saveResponseToCsvIfEnabled } = require('./llm/responseGenerator');

// Verificar disponibilidad de Ollama al inicio
async function checkOllamaOnStart() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const res = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const data = await res.json();
      const models = data.models?.map(m => m.name) || [];
      
      if (models.length > 0) {
        console.log(`✅ Ollama está disponible en http://localhost:11434`);
        console.log(`📦 Modelos disponibles: ${models.join(', ')}`);
        
        // Mostrar modelo configurado
        const configuredModel = process.env.OLLAMA_MODEL?.trim();
        if (configuredModel) {
          const isAvailable = models.includes(configuredModel);
          if (isAvailable) {
            console.log(`🎯 Modelo configurado: ${configuredModel} ✅`);
            
            // Advertir sobre modelos grandes si no hay suficiente RAM
            const largeModels = ['llama3', 'llama3.2', 'mistral', 'codellama'];
            if (largeModels.some(m => configuredModel.includes(m) && !configuredModel.includes(':1b') && !configuredModel.includes(':3b'))) {
              console.warn(`⚠️ Este modelo puede requerir mucha RAM (>4GB)`);
              console.warn(`💡 Si tienes problemas, usa un modelo más pequeño: llama3.2:1b`);
            }
          } else {
            console.warn(`⚠️ Modelo configurado "${configuredModel}" no está disponible`);
            console.warn(`💡 Se usará detección automática`);
          }
        } else {
          console.log(`🎯 Modelo: Detección automática (configura OLLAMA_MODEL en .env para especificar)`);
          console.log(`💡 Si tienes poca RAM, configura un modelo pequeño: OLLAMA_MODEL=llama3.2:1b`);
        }
      } else {
        console.warn('⚠️ Ollama está disponible pero no hay modelos instalados');
        console.warn('💡 Instala un modelo pequeño (recomendado si tienes <8GB RAM): ollama pull llama3.2:1b');
        console.warn('💡 O un modelo grande: ollama pull llama3');
      }
      return true;
    }
  } catch (error) {
    console.warn('⚠️ Ollama no está disponible en http://localhost:11434');
    console.warn('💡 Para usar respuestas automáticas, inicia Ollama: ollama serve');
    console.warn('📝 El bot seguirá funcionando pero sin respuestas del LLM\n');
    return false;
  }
  return false;
}

// Configuración de TikTok
// Para enviar mensajes, necesitas sessionId y ttTargetIdc de tu cuenta de TikTok
// Puedes obtenerlos desde las cookies de tu navegador cuando estés logueado en TikTok
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'saximt';
const TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID || null;
const TIKTOK_TT_TARGET_IDC = process.env.TIKTOK_TT_TARGET_IDC || null;

console.log('\n' + '='.repeat(60));
console.log('🚀 INICIANDO TIKTOK LIVE AGENT');
console.log('='.repeat(60));
console.log(`📱 Usuario objetivo: @${TIKTOK_USERNAME}`);
console.log(`🌐 URL del live: https://www.tiktok.com/@${TIKTOK_USERNAME}/live`);
if (process.env.USE_BROWSER_SENDER === 'true' || process.env.USE_BROWSER_SENDER === '1') {
  console.log(`📱 Envío de mensajes: screen scraping (navegador). Perfil: ${process.env.BROWSER_USER_DATA_DIR || './browser-profile'}`);
  console.log(`   💡 Primera vez: se abrirá el navegador; inicia sesión en TikTok y luego los mensajes se enviarán desde ahí.`);
}

// API Key de Euler Stream (requerida para enviar mensajes)
// Según la documentación oficial: https://www.eulerstream.com/docs/api-key-usage/nodejs
// La API key debe configurarse usando SignConfig ANTES de crear la conexión
const EULER_API_KEY = process.env.EULER_API_KEY?.trim() || null;

// Debug: Verificar si se está leyendo la API key
console.log(`🔍 [DEBUG] EULER_API_KEY leída: ${EULER_API_KEY ? `${EULER_API_KEY.substring(0, 20)}... (${EULER_API_KEY.length} caracteres)` : 'null/undefined'}`);

// Configurar SignConfig globalmente según la documentación oficial
if (EULER_API_KEY) {
  SignConfig.apiKey = EULER_API_KEY;
  console.log('🔑 Euler Stream API Key: Configurada ✅ (usando SignConfig)');
  console.log(`   API Key: ${EULER_API_KEY.substring(0, 15)}...${EULER_API_KEY.substring(EULER_API_KEY.length - 5)}`);
  console.log(`   Longitud: ${EULER_API_KEY.length} caracteres`);
  console.log(`   Método: SignConfig.apiKey (recomendado por documentación oficial)`);
} else {
  console.log('⚠️ Euler Stream API Key: No configurada');
  console.log('💡 Para enviar mensajes necesitas una API key de Euler Stream');
  console.log('🔗 Obtén tu API key en: https://www.eulerstream.com/pricing');
  console.log('💡 Verifica que EULER_API_KEY esté en tu archivo .env');
  console.log('📝 Nota: Puedes usar el tier gratuito/community si está disponible');
}

// Opciones de conexión
const connectionOptions = {
  fetchRoomInfoOnConnect: true  // Obtener información del room al conectar
  // signApiKey ya no es necesario aquí porque se configura globalmente con SignConfig
};

if (TIKTOK_SESSION_ID && TIKTOK_TT_TARGET_IDC) {
  connectionOptions.sessionId = TIKTOK_SESSION_ID;
  connectionOptions.ttTargetIdc = TIKTOK_TT_TARGET_IDC;
  console.log('🔐 Autenticación TikTok: Configurada ✅');
  console.log(`   Session ID: ${TIKTOK_SESSION_ID.substring(0, 10)}...`);
  console.log(`   Target IDC: ${TIKTOK_TT_TARGET_IDC}`);
  
  if (EULER_API_KEY) {
    console.log('💬 Estado: Puede ENVIAR mensajes (requiere plan premium)');
  } else {
    console.log('💬 Estado: Solo LECTURA (falta EULER_API_KEY para enviar mensajes)');
  }
} else {
  console.log('⚠️ Autenticación TikTok: No configurada');
  console.log('💡 Para enviar mensajes, configura TIKTOK_SESSION_ID y TIKTOK_TT_TARGET_IDC en .env');
  console.log('📖 Estado: Solo LECTURA (no puede enviar mensajes)');
}
console.log('='.repeat(60) + '\n');

// Verificar Ollama antes de iniciar
checkOllamaOnStart().then(() => {
  // Continuar con el inicio después de verificar Ollama
});

// Guardar referencias para poder cerrarlas
const tiktokConnection = startListener(TIKTOK_USERNAME, async msg => {
  try {
    await handleMessage(msg);
  } catch (e) {
    console.error('Error procesando mensaje', e.message);
  }
}, connectionOptions);

// Pasar la conexión al router para que pueda enviar mensajes
setTikTokConnection(tiktokConnection);

const notifier = startNotifier();

// Respuesta periódica de Ollama cada N minutos (mantiene actividad en el live)
const periodicIntervalMs = parseInt(process.env.OLLAMA_PERIODIC_INTERVAL_MS || '120000', 10) || 0;
let periodicIntervalId = null;
// Rotamos el tipo de mensaje cada vez para que no siempre diga lo mismo
const PERIODIC_PROMPT_HINTS = [
  'Esta vez la frase debe INVITAR A PEDIR CANCIONES (que manden su tema).',
  'Esta vez la frase debe ANIMAR A DAR TAP TAP en la pantalla.',
  'Esta vez la frase debe PEDIR SEGUIR AL HOST o dar like.',
  'Esta vez la frase debe ser un SALUDO BREVE y alegre al chat.'
];
const PERIODIC_TWISTS = [
  'Redacta de una forma distinta a la última vez.',
  'Usa otras palabras y emojis, sin repetir frases típicas.',
  'Inventa una variación nueva, no la frase obvia.',
  'Tono más festivo y breve.',
  'Otra forma de decirlo, creativa.'
];
let periodicRunCount = 0;
if (periodicIntervalMs > 0) {
  const enableAutoSend = process.env.ENABLE_AUTO_SEND !== 'false';
  periodicIntervalId = setInterval(async () => {
    if (!tiktokConnection) return;
    const hint = PERIODIC_PROMPT_HINTS[periodicRunCount % PERIODIC_PROMPT_HINTS.length];
    const twist = PERIODIC_TWISTS[Math.floor(Math.random() * PERIODIC_TWISTS.length)];
    periodicRunCount += 1;
    const periodicPrompt = `Genera una frase corta y alegre para el live. ${hint} ${twist} Escribe solo la frase como si la dijeras en el chat, con emojis, máximo 70 caracteres.`;
    try {
      const response = await generateResponse(periodicPrompt, {});
      if (response) {
        let sent = false;
        if (enableAutoSend && tiktokConnection.sendMessage) {
          sent = await tiktokConnection.sendMessage(response);
          if (sent) console.log(`⏱️ [Periódico cada ${periodicIntervalMs / 60000} min] Enviado: "${response.substring(0, 50)}..."`);
        } else {
          console.log(`⏱️ [Periódico] Respuesta (no enviada): "${response.substring(0, 50)}..."`);
        }
        saveResponseToCsvIfEnabled('(periódico)', periodicPrompt, response, sent);
      }
    } catch (e) {
      console.warn('⏱️ [Periódico] Error:', e.message);
    }
  }, periodicIntervalMs);
  console.log(`⏱️ Ollama responderá cada ${periodicIntervalMs / 60000} min (OLLAMA_PERIODIC_INTERVAL_MS=${periodicIntervalMs})`);
}

// Función para cerrar todas las conexiones
async function cleanup() {
  console.log('\n🛑 Cerrando conexiones...');
  if (periodicIntervalId) clearInterval(periodicIntervalId);
  if (tiktokConnection && typeof tiktokConnection.close === 'function') {
    await tiktokConnection.close();
  }
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
