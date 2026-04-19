// llm/responseGenerator.js
const fs = require('fs');
const path = require('path');

// Cache para evitar mostrar el mismo error muchas veces
let responseErrorShown = false;
let analyzeErrorShown = false;
let configuredModelUnavailableWarned = false;
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
      if (!configuredModelUnavailableWarned) {
        configuredModelUnavailableWarned = true;
        const models = await getAvailableModels();
        console.warn(`⚠️ Modelo configurado "${CONFIGURED_MODEL}" no está disponible`);
        if (models.length === 0) {
          console.warn(`💡 Modelos disponibles: Ninguno. ¿Ollama está corriendo? Prueba: ollama serve && ollama pull phi3:mini`);
        } else {
          console.warn(`💡 Modelos disponibles: ${models.join(', ')}`);
        }
        console.warn(`💡 Usando detección automática...`);
      }
    }
  }
  
  // Detección automática como fallback
  const models = await getAvailableModels();
  if (models.length === 0) return null;
  
  // Prioridad según uso: respuestas cortas en español → modelos rápidos y conversacionales
  const preferred =
    models.find(m => m.includes('llama3.2')) ||
    models.find(m => m.includes('phi3') || m === 'phi') ||
    models.find(m => m.includes('mistral')) ||
    models.find(m => m.includes('qwen2')) ||
    models.find(m => m.includes('llama3')) ||
    models.find(m => m.includes('gemma')) ||
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
 * Clasifica un mensaje con el LLM (tipo + canción si aplica).
 * Devuelve JSON string: { type: "request"|"vote"|"rating"|"normal"|"spam", song: null|"artista - canción" }
 */
async function analyze(text) {
  try {
    const model = await findAvailableModel();
    if (!model) {
      if (!analyzeErrorShown) {
        console.error('❌ No se encontraron modelos disponibles en Ollama');
        console.error('💡 Recomendado para este proyecto (rápido + JSON): ollama pull llama3.2:3b o ollama pull phi3');
        analyzeErrorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    await waitForRateLimit();

    const timeoutMs = parseInt(process.env.OLLAMA_RESPONSE_TIMEOUT_MS || '120000', 10) || 0;
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timeoutMs > 0 ? controller.signal : undefined,
      body: JSON.stringify({
        model: model,
        format: 'json',
        stream: false,
        messages: [
          {
            role: 'system',
            content: `
Eres un moderador experto de lives musicales. Clasifica mensajes de chat.

Devuelve EXCLUSIVAMENTE JSON válido con este formato:
{ "type": "request|vote|rating|normal|spam", "song": null | "artista - canción" }

Si el mensaje pide una canción, type debe ser "request" y song debe ser "artista - canción". Si no, type es uno de los otros y song es null.`
          },
          {
            role: 'user',
            content: `Clasifica este mensaje. Devuelve solo el JSON (sin explicaciones).

Mensaje: "${text}"`
          }
        ]
      })
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 500) {
        consecutive500Errors++;
        let errorBody = '';
        try { errorBody = await res.text(); } catch (e) {}
        if (!analyzeErrorShown) {
          console.warn(`⚠️ Error 500 de Ollama (analyze)`);
          if (errorBody && (errorBody.includes('unable to allocate') || errorBody.includes('buffer') || errorBody.includes('memory'))) {
            console.error(`💡 El modelo "${model}" puede requerir más RAM. Prueba: ollama pull llama3.2:1b`);
          }
          analyzeErrorShown = true;
        }
      } else if (res.status === 404 && !analyzeErrorShown) {
        console.error(`❌ Modelo "${model}" no encontrado (404)`);
        console.error(`💡 Recomendado: ollama pull llama3.2:3b o ollama pull phi3`);
        analyzeErrorShown = true;
      } else if (res.status !== 404 && res.status !== 500 && !analyzeErrorShown) {
        console.error(`❌ Error en respuesta de Ollama (analyze): ${res.status} ${res.statusText}`);
        analyzeErrorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    consecutive500Errors = 0;
    analyzeErrorShown = false;
    const data = await res.json();
    return data.message?.content || JSON.stringify({ type: 'normal', song: null });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!analyzeErrorShown) {
        const timeoutMs = parseInt(process.env.OLLAMA_RESPONSE_TIMEOUT_MS || '120000', 10) || 0;
        console.error(`⏱️ Timeout: Ollama tardó demasiado en responder (analyze). OLLAMA_RESPONSE_TIMEOUT_MS=${timeoutMs || 'sin límite'}`);
        analyzeErrorShown = true;
      }
    } else if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      if (!analyzeErrorShown) {
        console.error('❌ No se puede conectar a Ollama en http://localhost:11434. Verifica: ollama serve');
        analyzeErrorShown = true;
      }
    } else if (!analyzeErrorShown) {
      console.error(`❌ Error analizando mensaje: ${error.message || error}`);
      analyzeErrorShown = true;
    }
    return JSON.stringify({ type: 'normal', song: null });
  }
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

      const temperature = parseFloat(process.env.OLLAMA_RESPONSE_TEMPERATURE || '0.85', 10) || 0.85;
      const moderatorName = process.env.MODERATOR_NAME?.trim();
      const moderatorLine = moderatorName
        ? `Tu nombre como moderador es "${moderatorName}". Cuando te etiqueten (@${moderatorName.replace(/\s/g, '')}) o te nombren, responde SIEMPRE según el contexto del mensaje (saludo, pregunta, petición, etc.).\n\n`
        : '';
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timeoutMs > 0 ? controller.signal : undefined,
        body: JSON.stringify({
          model: model,
          stream: false,
          options: { temperature },
          messages: [
            {
              role: 'system',
              content: `Eres el moderador de un live musical: animado, alegre y cercano. Tu tono es energético y cálido, nunca frío ni cortante. Hablas en tercera persona o "nosotros" (somos el equipo del live).
${moderatorLine}REGLA DE ORO: Escribe SIEMPRE la frase tal como se diría en el chat. NUNCA repitas instrucciones literales (ej: no digas "pedir que pidan canciones"). Inventa la frase natural y con onda.

VARÍA SIEMPRE: cada respuesta debe sonar DISTINTA. No repitas las mismas frases (evita siempre "mandá tu tema y dale tap tap", "seguinos y dale like", "¡Hola! ¿Qué te apetece?"). Usa otras palabras, otros emojis, otro orden, sinónimos. Sé creativo.

Según el mensaje:
1) "Solicitud recibida: artista - canción": Un dato curioso breve sobre esa canción. Varía (año, récord, anécdota, país).
2) Saludo del público o cuando te nombran: Saludo/respuesta alegre y breve, según el contexto.
3) Pregunta: Respuesta útil y concisa.
4) Mensaje para el live: La idea te la dan en el mensaje; redacta esa idea de una forma NUEVA, no uses frases hechas.

Formato: responde ÚNICAMENTE un JSON: {"message": "tu frase aquí"}
Máximo 80 caracteres en "message". Usa emojis. Sé animado y variado.`
            },
            {
              role: 'user',
              content: `Mensaje del usuario: "${userMessage}"
${context.topSongs ? `Canciones más pedidas: ${context.topSongs.join(', ')}` : ''}

Escribe la respuesta (solo el JSON con "message"). Frase natural para el chat, animada y alegre.`
            }
          ]
        })
      });

      if (timeoutId) clearTimeout(timeoutId);

      console.log(`📥 [makeRequestWithRetry] Respuesta recibida: ${res.status} ${res.statusText}`);

      if (res.ok) {
        consecutive500Errors = 0;
        responseErrorShown = false;
        const data = await res.json();
        const raw = (data.message && (data.message.content != null)) ? String(data.message.content).trim() : '';
        if (!raw) {
          const preview = JSON.stringify(data).substring(0, 400);
          console.warn(`⚠️ [makeRequestWithRetry] Respuesta OK pero sin contenido. Respuesta de Ollama: ${preview}${JSON.stringify(data).length > 400 ? '...' : ''}`);
          return null;
        }
        // Si el modelo devolvió JSON con campo "message", usar solo ese texto para el chat
        let content = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
            content = parsed.message.trim();
          }
        } catch (_) {
          // No era JSON, usar raw como texto
        }
        console.log(`✅ [makeRequestWithRetry] Respuesta: "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);
        return content;
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
        console.error(`💡 Recomendado: ollama pull llama3.2:3b o ollama pull phi3`);
      } else if (res.status === 500) {
        // Error 500 puede ser por falta de memoria
        console.error(`❌ Error 500 de Ollama (sin retry disponible en este punto)`);
        try {
          const errorBody = await res.text();
          if (errorBody.includes('unable to allocate') || errorBody.includes('buffer')) {
            console.error(`\n💥 PROBLEMA DE MEMORIA DETECTADO`);
            console.error(`💡 El modelo "${model}" requiere más memoria RAM de la disponible`);
            console.error(`💡 Soluciones:`);
            console.error(`   1. Usa un modelo más pequeño: ollama pull llama3.2:1b o ollama pull phi3:mini`);
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
        console.error('💡 Recomendado para respuestas en vivo: ollama pull llama3.2:3b o ollama pull phi3');
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
    const { msg, topSongs, tiktokConnection, allowSend = true } = responseQueue.shift();
    
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
      if (response) {
        const textToSend = formatResponseWithMention(response, msg.user, msg.displayName);
        let sent = false;
        if (allowSend && tiktokConnection && tiktokConnection.sendMessage) {
          console.log(`📤 Enviando respuesta: "${textToSend.substring(0, 60)}..."`);
          sent = await tiktokConnection.sendMessage(textToSend);
          if (sent) {
            console.log(`✅ Respuesta enviada exitosamente`);
            lastResponseTime = Date.now();
          } else {
            console.log(`❌ No se pudo enviar la respuesta`);
          }
        } else {
          console.log(`💬 Respuesta (no enviada): "${response}"`);
        }
        saveResponseToCsvIfEnabled(msg.user, msg.text, textToSend, sent);
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
 * Agrega un mensaje a la cola de respuestas.
 * allowSend: si false, Ollama genera la respuesta pero no se envía al chat (ENABLE_AUTO_SEND=false).
 */
function queueResponse(msg, topSongs, tiktokConnection, allowSend = true) {
  // Limitar el tamaño de la cola
  if (responseQueue.length >= MAX_QUEUE_SIZE) {
    console.log(`⚠️ Cola de respuestas llena, ignorando mensaje: "${msg.text.substring(0, 30)}..."`);
    return;
  }
  
  responseQueue.push({ msg, topSongs, tiktokConnection, allowSend });
  processResponseQueue();
}

/**
 * True si el mensaje es del propio moderador (cuenta definida en MODERATOR_NAME).
 * Esos mensajes no se deben procesar ni responder.
 */
function isMessageFromModerator(msg) {
  const name = process.env.MODERATOR_NAME?.trim();
  if (!name) return false;
  const n = name.toLowerCase();
  const user = (msg.user && String(msg.user).trim().toLowerCase()) || '';
  const display = (msg.displayName && String(msg.displayName).trim().toLowerCase()) || '';
  return user === n || display === n;
}

/**
 * True si el mensaje menciona o etiqueta al moderador (MODERATOR_NAME en .env).
 * Cuando te etiquetan, se responde siempre.
 */
function messageMentionsModerator(text) {
  const name = process.env.MODERATOR_NAME?.trim();
  if (!name) return false;
  const lower = text.toLowerCase().trim();
  const nameLower = name.toLowerCase();
  if (lower.includes(nameLower)) return true;
  const atName = '@' + nameLower.replace(/\s/g, '');
  return lower.includes(atName);
}

/**
 * Determina si un mensaje merece una respuesta
 * Si te etiquetan o nombran (MODERATOR_NAME), siempre se responde.
 */
function shouldRespond(msg) {
  const text = msg.text.toLowerCase().trim();

  // Si mencionan al moderador: responder siempre (máx 150 caracteres)
  if (messageMentionsModerator(msg.text) && text.length <= 150) {
    return true;
  }

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

  return hasQuestionMark || hasGreeting || (hasDirectMention && text.length > 10) || hasMusicQuestion;
}

/**
 * Escapa un valor para CSV (separador ;, comillas y saltos de línea).
 */
function escapeCsvValue(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[";\n\r]/.test(s) ? `"${s}"` : s;
}

/**
 * Si ENABLE_MENTION_RESPONSE no es 'false' y hay destinatario, devuelve "@destinatario respuesta".
 * Si hay displayName se usa para la mención (@DisplayName); si no, se usa username (handle).
 */
function formatResponseWithMention(response, username, displayName) {
  if (!response) return response;
  if (process.env.ENABLE_MENTION_RESPONSE === 'false') return response;
  const mention = (displayName && typeof displayName === 'string' && displayName.trim())
    ? displayName.trim()
    : (username && typeof username === 'string' && username.trim())
      ? username.trim()
      : '';
  if (!mention) return response;
  return `@${mention} ${response}`;
}

/**
 * Si SAVE_RESPONSES_CSV=true, append una fila al CSV en RESPONSES_CSV_PATH.
 * user: nombre del usuario, userMessage: mensaje que disparó la respuesta, response: texto del bot, sent: si se envió al chat.
 */
function saveResponseToCsvIfEnabled(user, userMessage, response, sent) {
  if (process.env.SAVE_RESPONSES_CSV !== 'true') return;
  const csvPath = process.env.RESPONSES_CSV_PATH?.trim();
  if (!csvPath) return;
  try {
    const fullPath = path.resolve(csvPath);
    const header = 'fecha;usuario;mensaje_usuario;respuesta_bot;enviado';
    const needsHeader = !fs.existsSync(fullPath);
    const row = [
      new Date().toISOString(),
      escapeCsvValue(user),
      escapeCsvValue(userMessage),
      escapeCsvValue(response),
      ''  // enviado: siempre vacío
    ].join(';');
    const line = (needsHeader ? header + '\n' : '') + row + '\n';
    fs.appendFileSync(fullPath, line, 'utf8');
  } catch (e) {
    console.error('❌ Error guardando respuesta en CSV:', e.message);
  }
}

module.exports = { analyze, generateResponse, shouldRespond, queueResponse, saveResponseToCsvIfEnabled, formatResponseWithMention, messageMentionsModerator, isMessageFromModerator };
