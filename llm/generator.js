// llm/generator.js
// Genera respuestas de chat usando el LLM de Ollama.
const config = require('../config');
const { checkAvailable, findAvailableModel, waitForRateLimit, getAvailableModels, reportError500, resetErrors } = require('./ollamaClient');
const { buildGeneratorSystemPrompt, buildRagContext, resolve } = require('../config/promptLoader');

let _errorShown = false;

/**
 * Hace la petición HTTP a Ollama con retry en errores 500.
 * @param {string} model - Nombre del modelo
 * @param {string} userMessage - Mensaje del usuario
 * @param {{ topSongs?: string[] }} context - Contexto del live
 * @param {number} maxRetries
 * @returns {Promise<string|null>}
 */
async function makeRequestWithRetry(model, userMessage, context, maxRetries = 2) {
  console.log(`🔄 [makeRequestWithRetry] Iniciando petición con modelo: ${model}, maxRetries: ${maxRetries}`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`⏳ [makeRequestWithRetry] Intento ${attempt + 1}/${maxRetries + 1} - Esperando rate limit...`);
      await waitForRateLimit();

      console.log(`📡 [makeRequestWithRetry] Enviando petición a Ollama...`);
      const timeoutMs = config.ollama.timeoutMs;
      const controller = new AbortController();
      const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

      const temperature = config.ollama.temperature;
      const moderatorName = config.bot.moderatorName;

      const canciones = context.topSongs?.length
        ? resolve('generador.usuario_canciones_pedidas', { lista: context.topSongs.join(', ') })
        : '';
      const repertorio = context.ragResult ? buildRagContext(context.ragResult) : '';

      const res = await fetch(`${config.ollama.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timeoutMs > 0 ? controller.signal : undefined,
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature },
          messages: [
            {
              role: 'system',
              content: buildGeneratorSystemPrompt(moderatorName),
            },
            {
              role: 'user',
              content: resolve('generador.usuario_plantilla', {
                mensaje: userMessage,
                canciones_pedidas: canciones,
                contexto_repertorio: repertorio,
              }),
            },
          ],
        }),
      });

      if (timeoutId) clearTimeout(timeoutId);
      console.log(`📥 [makeRequestWithRetry] Respuesta recibida: ${res.status} ${res.statusText}`);

      if (res.ok) {
        resetErrors();
        _errorShown = false;
        const data = await res.json();
        const raw = (data.message && data.message.content != null) ? String(data.message.content).trim() : '';
        if (!raw) {
          const preview = JSON.stringify(data).substring(0, 400);
          console.warn(`⚠️ [makeRequestWithRetry] Respuesta OK pero sin contenido. Respuesta de Ollama: ${preview}${JSON.stringify(data).length > 400 ? '...' : ''}`);
          return null;
        }
        let content = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
            content = parsed.message.trim();
          }
        } catch { /* No era JSON, usar raw */ }
        console.log(`✅ [makeRequestWithRetry] Respuesta: "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);
        return content;
      }

      if (res.status === 500) {
        reportError500();
        if (attempt < maxRetries) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.warn(`⚠️ Error 500 de Ollama, reintentando en ${backoffTime}ms... (intento ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }
        console.error(`❌ Error 500 de Ollama después de ${maxRetries + 1} intentos`);
        console.error(`💡 Ollama puede estar sobrecargado. Espera unos segundos antes de la siguiente petición.`);
        return null;
      }

      if (res.status === 404) {
        console.error(`❌ Modelo "${model}" no encontrado (404)`);
        const availableModels = await getAvailableModels();
        console.error(`💡 Modelos disponibles: ${availableModels.join(', ') || 'Ninguno'}`);
        console.error(`💡 Recomendado: ollama pull llama3.2:3b o ollama pull phi3`);
      } else {
        console.error(`❌ Error en respuesta de Ollama: ${res.status} ${res.statusText}`);
        try {
          const errorBody = await res.text();
          console.error(`💡 Detalles del error: ${errorBody.substring(0, 200)}`);
        } catch { /* ignorar */ }
      }
      return null;
    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        if (!_errorShown) {
          const timeoutMs = config.ollama.timeoutMs;
          console.error(`⏱️ Timeout: Ollama tardó demasiado en responder${timeoutMs > 0 ? ` (>${timeoutMs / 1000}s)` : ''}. Puedes aumentar OLLAMA_RESPONSE_TIMEOUT_MS o poner 0 para sin límite.`);
          _errorShown = true;
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * Genera una respuesta de chat usando el LLM.
 * @param {string} userMessage
 * @param {{ topSongs?: string[] }} context
 * @returns {Promise<string|null>}
 */
async function generateResponse(userMessage, context = {}) {
  try {
    console.log(`🔍 [generateResponse] Iniciando generación de respuesta...`);

    const ollamaAvailable = await checkAvailable();
    if (!ollamaAvailable) {
      if (!_errorShown) {
        console.error(`⚠️ Ollama no está disponible en ${config.ollama.baseUrl}`);
        console.error('💡 Asegúrate de que Ollama esté corriendo: ollama serve');
        _errorShown = true;
      }
      return null;
    }
    console.log(`✅ [generateResponse] Ollama está disponible`);

    const model = await findAvailableModel();
    if (!model) {
      if (!_errorShown) {
        console.error('❌ No se encontraron modelos disponibles en Ollama');
        console.error('💡 Recomendado para respuestas en vivo: ollama pull llama3.2:3b o ollama pull phi3');
        _errorShown = true;
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
      if (!_errorShown) {
        console.error(`❌ No se puede conectar a Ollama en ${config.ollama.baseUrl}`);
        console.error('💡 Verifica que Ollama esté corriendo: ollama serve');
        _errorShown = true;
      }
    } else if (!_errorShown) {
      console.error(`❌ Error generando respuesta: ${error.message || error}`);
      _errorShown = true;
    }
    return null;
  }
}

module.exports = { generateResponse };
