// llm/ollamaClient.js

// Cache para evitar mostrar el mismo error muchas veces
let errorShown = false;
let availableModel = null;

// Rate limiting: tiempo mínimo entre peticiones (ms)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 segundos entre peticiones

// Contador de errores 500 consecutivos
let consecutive500Errors = 0;
const MAX_500_ERRORS = 3;

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
 * Espera un tiempo antes de hacer la siguiente petición (rate limiting)
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  const waitTime = consecutive500Errors >= MAX_500_ERRORS 
    ? MIN_REQUEST_INTERVAL * (consecutive500Errors + 1) 
    : MIN_REQUEST_INTERVAL;
  
  if (timeSinceLastRequest < waitTime) {
    const wait = waitTime - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  
  lastRequestTime = Date.now();
}

async function analyze(text) {
  try {
    // Encontrar modelo disponible
    const model = await findAvailableModel();
    if (!model) {
      if (!errorShown) {
        console.error('❌ No se encontraron modelos disponibles en Ollama');
        console.error('💡 Instala un modelo: ollama pull llama3');
        errorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    // Rate limiting
    await waitForRateLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // Timeout de 12 segundos

    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        format: 'json',        // 🔥 ESTO ES LA CLAVE
        stream: false,
        messages: [
          {
            role: 'system',
            content: `
Eres un moderador experto de lives musicales.
Responde SOLO con JSON válido.
No expliques nada.
`
          },
          {
            role: 'user',
            content: `
Clasifica este mensaje.

Devuelve exactamente este formato:
{
  "type": "request|vote|rating|normal|spam",
  "song": null | "artista - canción"
}

Mensaje:
"${text}"
`
          }
        ]
      })
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 500) {
        consecutive500Errors++;
        // Siempre intentar leer y mostrar el cuerpo del error para diagnosticar
        let errorBody = '';
        try {
          errorBody = await res.text();
        } catch (e) {
          // Ignorar
        }
        if (!errorShown) {
          console.warn(`⚠️ Error 500 de Ollama (analyze)`);
          if (errorBody) {
            console.warn(`📋 Respuesta de Ollama: ${errorBody.substring(0, 500)}${errorBody.length > 500 ? '...' : ''}`);
          }
          if (errorBody && (errorBody.includes('unable to allocate') || errorBody.includes('buffer') || errorBody.includes('memory'))) {
            console.error(`💥 Posible problema de memoria`);
            console.error(`💡 El modelo "${model}" puede requerir más RAM. Prueba: ollama pull llama3.2:1b`);
          } else if (errorBody && (errorBody.includes('not found') || errorBody.includes('load'))) {
            console.error(`💡 El modelo puede no estar cargado. Prueba en otra terminal: ollama run ${model}`);
          }
          errorShown = true;
        }
      } else if (res.status === 404 && !errorShown) {
        console.error(`❌ Modelo "${model}" no encontrado (404)`);
        console.error(`💡 Modelos disponibles: ${(await getAvailableModels()).join(', ') || 'Ninguno'}`);
        console.error(`💡 Instala un modelo: ollama pull llama3`);
        errorShown = true;
      } else if (res.status !== 404 && res.status !== 500 && !errorShown) {
        console.error(`❌ Error en respuesta de Ollama (analyze): ${res.status} ${res.statusText}`);
        errorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    // Resetear contador de errores 500 si la petición fue exitosa
    consecutive500Errors = 0;
    errorShown = false;
    const data = await res.json();
    return data.message?.content || JSON.stringify({ type: 'normal', song: null });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!errorShown) {
        console.error('⏱️ Timeout: Ollama tardó demasiado en responder (>12s)');
        errorShown = true;
      }
    } else if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      if (!errorShown) {
        console.error('❌ No se puede conectar a Ollama en http://localhost:11434');
        console.error('💡 Verifica que Ollama esté corriendo: ollama serve');
        errorShown = true;
      }
    } else if (!errorShown) {
      console.error(`❌ Error analizando mensaje: ${error.message || error}`);
      errorShown = true;
    }
    // Retornar un JSON por defecto si falla
    return JSON.stringify({ type: 'normal', song: null });
  }
}

module.exports = { analyze };
