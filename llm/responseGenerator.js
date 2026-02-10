// llm/responseGenerator.js

// Cache para evitar mostrar el mismo error muchas veces
let responseErrorShown = false;
let availableModel = null;

// Rate limiting: tiempo mínimo entre peticiones (ms)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 segundos entre peticiones

// Contador de errores 500 consecutivos
let consecutive500Errors = 0;
const MAX_500_ERRORS = 3; // Después de 3 errores 500, esperar más tiempo

// Modelo configurado desde .env
const CONFIGURED_MODEL = process.env.OLLAMA_MODEL?.trim() || null;

/**
 * Obtiene la lista de modelos disponibles en Ollama
 */
async function getAvailableModels() {
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
      return models;
    }
    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Verifica si un modelo específico está disponible
 */
async function isModelAvailable(modelName) {
  const models = await getAvailableModels();
  return models.includes(modelName);
}

/**
 * Encuentra un modelo disponible
 * Prioridad: 1. Modelo configurado en .env, 2. Detección automática
 */
async function findAvailableModel() {
  if (availableModel) return availableModel;
  
  // Si hay un modelo configurado en .env, usarlo
  if (CONFIGURED_MODEL) {
    const isAvailable = await isModelAvailable(CONFIGURED_MODEL);
    if (isAvailable) {
      availableModel = CONFIGURED_MODEL;
      return CONFIGURED_MODEL;
    } else {
      console.warn(`⚠️ Modelo configurado "${CONFIGURED_MODEL}" no está disponible`);
      const models = await getAvailableModels();
      console.warn(`💡 Modelos disponibles: ${models.join(', ') || 'Ninguno'}`);
      console.warn(`💡 Usando detección automática...`);
    }
  }
  
  // Detección automática como fallback
  const models = await getAvailableModels();
  if (models.length === 0) return null;
  
  // Prioridad: llama3 > llama3.2 > llama2 > cualquier otro
  const preferred = models.find(m => m.includes('llama3')) || 
                   models.find(m => m.includes('llama')) ||
                   models[0];
  
  availableModel = preferred;
  return preferred;
}

/**
 * Verifica si Ollama está disponible
 */
async function checkOllamaAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // Timeout de 3 segundos
    
    const res = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return res.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Espera un tiempo antes de hacer la siguiente petición (rate limiting)
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  // Si hay muchos errores 500, esperar más tiempo
  const waitTime = consecutive500Errors >= MAX_500_ERRORS 
    ? MIN_REQUEST_INTERVAL * (consecutive500Errors + 1) 
    : MIN_REQUEST_INTERVAL;
  
  if (timeSinceLastRequest < waitTime) {
    const wait = waitTime - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  
  lastRequestTime = Date.now();
}

/**
 * Intenta hacer una petición con retry para errores 500
 */
async function makeRequestWithRetry(model, userMessage, context, maxRetries = 2) {
  console.log(`🔄 [makeRequestWithRetry] Iniciando petición con modelo: ${model}, maxRetries: ${maxRetries}`);
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`⏳ [makeRequestWithRetry] Intento ${attempt + 1}/${maxRetries + 1} - Esperando rate limit...`);
      await waitForRateLimit();
      
      console.log(`📡 [makeRequestWithRetry] Enviando petición a Ollama...`);
      const timeoutMs = parseInt(process.env.OLLAMA_RESPONSE_TIMEOUT_MS || '0', 10) || 0;
      const controller = new AbortController();
      const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timeoutMs > 0 ? controller.signal : undefined,
        body: JSON.stringify({
          model: model,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `Eres un asistente amigable y divertido en un live de TikTok musical.
Responde de forma breve, natural y en español.
Mantén las respuestas cortas (máximo 2-3 líneas).
Sé amigable, usa emojis ocasionalmente, pero no abuses de ellos.
Si alguien pregunta por canciones, menciona las más pedidas si las hay.
Si el mensaje es un saludo, responde amigablemente.
Si es una pregunta, responde de forma útil pero concisa.`
            },
            {
              role: 'user',
              content: `Mensaje del usuario: "${userMessage}"
${context.topSongs ? `Canciones más pedidas: ${context.topSongs.join(', ')}` : ''}

Genera una respuesta natural y breve para este mensaje.`
            }
          ]
        })
      });

      if (timeoutId) clearTimeout(timeoutId);

      console.log(`📥 [makeRequestWithRetry] Respuesta recibida: ${res.status} ${res.statusText}`);

      if (res.ok) {
        // Resetear contador de errores 500 si la petición fue exitosa
        consecutive500Errors = 0;
        responseErrorShown = false;
        const data = await res.json();
        console.log(`✅ [makeRequestWithRetry] Datos recibidos:`, JSON.stringify(data).substring(0, 300));
        const content = data.message?.content?.trim();
        if (!content) {
          console.warn(`⚠️ [makeRequestWithRetry] Respuesta OK pero sin contenido. Data:`, JSON.stringify(data).substring(0, 200));
        } else {
          console.log(`✅ [makeRequestWithRetry] Contenido extraído: "${content.substring(0, 100)}..."`);
        }
        return content || null;
      }

      // Manejar errores 500 con retry
      if (res.status === 500) {
        consecutive500Errors++;
        if (attempt < maxRetries) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
          console.warn(`⚠️ Error 500 de Ollama, reintentando en ${backoffTime}ms... (intento ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        } else {
          console.error(`❌ Error 500 de Ollama después de ${maxRetries + 1} intentos`);
          console.error(`💡 Ollama puede estar sobrecargado. Espera unos segundos antes de la siguiente petición.`);
          return null;
        }
      }

      // Otros errores HTTP
      if (res.status === 404) {
        console.error(`❌ Modelo "${model}" no encontrado (404)`);
        const availableModels = await getAvailableModels();
        console.error(`💡 Modelos disponibles: ${availableModels.join(', ') || 'Ninguno'}`);
        console.error(`💡 Instala un modelo: ollama pull llama3`);
      } else if (res.status === 500) {
        // Error 500 puede ser por falta de memoria
        console.error(`❌ Error 500 de Ollama (sin retry disponible en este punto)`);
        try {
          const errorBody = await res.text();
          if (errorBody.includes('unable to allocate') || errorBody.includes('buffer')) {
            console.error(`\n💥 PROBLEMA DE MEMORIA DETECTADO`);
            console.error(`💡 El modelo "${model}" requiere más memoria RAM de la disponible`);
            console.error(`💡 Soluciones:`);
            console.error(`   1. Usa un modelo más pequeño: ollama pull llama3.2:1b`);
            console.error(`   2. Cierra otras aplicaciones para liberar RAM`);
            console.error(`   3. Configura OLLAMA_MODEL en .env con un modelo más pequeño`);
            console.error(`   4. Modelos pequeños recomendados: llama3.2:1b, phi, tinyllama\n`);
          } else {
            console.error(`💡 Detalles del error: ${errorBody.substring(0, 300)}`);
          }
        } catch (e) {
          // Ignorar si no se puede leer el cuerpo
        }
      } else if (res.status !== 404 && res.status !== 500) {
        console.error(`❌ Error en respuesta de Ollama: ${res.status} ${res.statusText}`);
        // Intentar leer el cuerpo del error para más información
        try {
          const errorBody = await res.text();
          console.error(`💡 Detalles del error: ${errorBody.substring(0, 200)}`);
        } catch (e) {
          // Ignorar si no se puede leer el cuerpo
        }
      }
      return null;
    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt < maxRetries) {
          const backoffTime = 2000;
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }
        if (!responseErrorShown) {
          const timeoutMs = parseInt(process.env.OLLAMA_RESPONSE_TIMEOUT_MS || '0', 10) || 0;
          console.error(`⏱️ Timeout: Ollama tardó demasiado en responder${timeoutMs > 0 ? ` (>${timeoutMs / 1000}s)` : ''}. Puedes aumentar OLLAMA_RESPONSE_TIMEOUT_MS o poner 0 para sin límite.`);
          responseErrorShown = true;
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * Genera una respuesta usando el LLM basándose en el mensaje recibido
 * y el contexto del live (como las canciones más pedidas)
 */
async function generateResponse(userMessage, context = {}) {
  try {
    console.log(`🔍 [generateResponse] Iniciando generación de respuesta...`);
    
    // Verificar si Ollama está disponible
    const ollamaAvailable = await checkOllamaAvailable();
    if (!ollamaAvailable) {
      if (!responseErrorShown) {
        console.error('⚠️ Ollama no está disponible en http://localhost:11434');
        console.error('💡 Asegúrate de que Ollama esté corriendo: ollama serve');
        responseErrorShown = true;
      }
      return null;
    }
    console.log(`✅ [generateResponse] Ollama está disponible`);

    // Encontrar modelo disponible
    const model = await findAvailableModel();
    if (!model) {
      if (!responseErrorShown) {
        console.error('❌ No se encontraron modelos disponibles en Ollama');
        console.error('💡 Instala un modelo: ollama pull llama3');
        responseErrorShown = true;
      }
      return null;
    }
    console.log(`✅ [generateResponse] Modelo encontrado: ${model}`);

    const result = await makeRequestWithRetry(model, userMessage, context);
    if (result) {
      console.log(`✅ [generateResponse] Respuesta generada exitosamente`);
    } else {
      console.log(`⚠️ [generateResponse] No se pudo generar respuesta (makeRequestWithRetry retornó null)`);
    }
    return result;
  } catch (error) {
    console.error(`❌ [generateResponse] Excepción capturada:`, error.message || error);
    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      if (!responseErrorShown) {
        console.error('❌ No se puede conectar a Ollama en http://localhost:11434');
        console.error('💡 Verifica que Ollama esté corriendo: ollama serve');
        responseErrorShown = true;
      }
    } else if (!responseErrorShown) {
      console.error(`❌ Error generando respuesta: ${error.message || error}`);
      responseErrorShown = true;
    }
    return null;
  }
}

// Cola de mensajes pendientes de respuesta
let responseQueue = [];
let isProcessingQueue = false;
const MAX_QUEUE_SIZE = 5; // Máximo de mensajes en cola
const RESPONSE_COOLDOWN = 5000; // 5 segundos entre respuestas
let lastResponseTime = 0;

/**
 * Procesa la cola de respuestas
 */
async function processResponseQueue() {
  if (isProcessingQueue || responseQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (responseQueue.length > 0) {
    const { msg, topSongs, tiktokConnection } = responseQueue.shift();
    
    // Verificar cooldown
    const now = Date.now();
    const timeSinceLastResponse = now - lastResponseTime;
    if (timeSinceLastResponse < RESPONSE_COOLDOWN) {
      const waitTime = RESPONSE_COOLDOWN - timeSinceLastResponse;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    try {
      console.log(`💭 Procesando respuesta para: "${msg.text.substring(0, 50)}..."`);
      const response = await generateResponse(msg.text, { topSongs });
      if (response && tiktokConnection && tiktokConnection.sendMessage) {
        console.log(`📤 Enviando respuesta: "${response}"`);
        const sent = await tiktokConnection.sendMessage(response);
        if (sent) {
          console.log(`✅ Respuesta enviada exitosamente`);
          lastResponseTime = Date.now();
        } else {
          console.log(`❌ No se pudo enviar la respuesta`);
        }
      } else {
        console.log(`⚠️ No se generó respuesta del LLM`);
      }
    } catch (e) {
      console.error(`❌ Error procesando respuesta:`, e.message);
    }
  }
  
  isProcessingQueue = false;
}

/**
 * Agrega un mensaje a la cola de respuestas
 */
function queueResponse(msg, topSongs, tiktokConnection) {
  // Limitar el tamaño de la cola
  if (responseQueue.length >= MAX_QUEUE_SIZE) {
    console.log(`⚠️ Cola de respuestas llena, ignorando mensaje: "${msg.text.substring(0, 30)}..."`);
    return;
  }
  
  responseQueue.push({ msg, topSongs, tiktokConnection });
  processResponseQueue();
}

/**
 * Determina si un mensaje merece una respuesta
 * Ahora más selectivo para evitar responder a todo
 */
function shouldRespond(msg) {
  const text = msg.text.toLowerCase().trim();
  
  // No responder a mensajes muy cortos o muy largos
  if (text.length < 5 || text.length > 150) {
    return false;
  }

  // No responder a mensajes que son solo emojis o símbolos
  if (/^[\s\W]+$/.test(text.replace(/[a-z0-9]/gi, ''))) {
    return false;
  }

  // Responder solo a preguntas directas (con ?)
  const hasQuestionMark = text.includes('?');
  
  // Responder a saludos específicos (más restrictivo)
  const specificGreetings = ['hola', 'hi', 'hello', 'buenas noches', 'buenos días', 'buenas tardes'];
  const hasGreeting = specificGreetings.some(greeting => {
    const regex = new RegExp(`^${greeting}[\\s!.,]*$`, 'i');
    return regex.test(text);
  });
  
  // Responder a menciones directas al streamer/DJ
  const hasDirectMention = /@\w+|streamer|dj|minh|@minh/i.test(text);
  
  // Responder a preguntas específicas sobre canciones/música
  const musicQuestions = ['qué canción', 'qué música', 'qué tema', 'pon', 'ponme', 'play'];
  const hasMusicQuestion = musicQuestions.some(q => text.includes(q));
  
  // Solo responder si cumple criterios específicos
  return hasQuestionMark || hasGreeting || (hasDirectMention && text.length > 10) || hasMusicQuestion;
}

module.exports = { generateResponse, shouldRespond, queueResponse };
