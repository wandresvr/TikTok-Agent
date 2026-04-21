// llm/classifier.js
// Clasifica mensajes de chat con el LLM (request / vote / normal / spam).
const config = require('../config');
const { findAvailableModel, waitForRateLimit, reportError500, resetErrors } = require('./ollamaClient');
const { buildClassifierSystemPrompt, resolve } = require('../config/promptLoader');

let _errorShown = false;

/**
 * Clasifica un mensaje con el LLM.
 * Devuelve JSON string: { type: "request"|"vote"|"rating"|"normal"|"spam", song: null|"artista - canción" }
 */
async function analyze(text) {
  try {
    const model = await findAvailableModel();
    if (!model) {
      if (!_errorShown) {
        console.error('❌ No se encontraron modelos disponibles en Ollama');
        console.error('💡 Recomendado para este proyecto (rápido + JSON): ollama pull llama3.2:3b o ollama pull phi3');
        _errorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    await waitForRateLimit();

    const timeoutMs = config.ollama.timeoutMs;
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const res = await fetch(`${config.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timeoutMs > 0 ? controller.signal : undefined,
      body: JSON.stringify({
        model,
        format: 'json',
        stream: false,
        messages: [
          {
            role: 'system',
            content: buildClassifierSystemPrompt(),
          },
          {
            role: 'user',
            content: resolve('clasificador.usuario', { texto: text }),
          },
        ],
      }),
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 500) {
        reportError500();
        let errorBody = '';
        try { errorBody = await res.text(); } catch { /* ignorar */ }
        if (!_errorShown) {
          console.warn(`⚠️ Error 500 de Ollama (analyze)`);
          if (errorBody && (errorBody.includes('unable to allocate') || errorBody.includes('buffer') || errorBody.includes('memory'))) {
            console.error(`💡 El modelo "${model}" puede requerir más RAM. Prueba: ollama pull llama3.2:1b`);
          }
          _errorShown = true;
        }
      } else if (res.status === 404 && !_errorShown) {
        console.error(`❌ Modelo "${model}" no encontrado (404)`);
        console.error(`💡 Recomendado: ollama pull llama3.2:3b o ollama pull phi3`);
        _errorShown = true;
      } else if (!_errorShown) {
        console.error(`❌ Error en respuesta de Ollama (analyze): ${res.status} ${res.statusText}`);
        _errorShown = true;
      }
      return JSON.stringify({ type: 'normal', song: null });
    }

    resetErrors();
    _errorShown = false;
    const data = await res.json();
    return data.message?.content || JSON.stringify({ type: 'normal', song: null });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!_errorShown) {
        const timeoutMs = config.ollama.timeoutMs;
        console.error(`⏱️ Timeout: Ollama tardó demasiado en responder (analyze). OLLAMA_RESPONSE_TIMEOUT_MS=${timeoutMs || 'sin límite'}`);
        _errorShown = true;
      }
    } else if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      if (!_errorShown) {
        console.error(`❌ No se puede conectar a Ollama en ${config.ollama.baseUrl}. Verifica: ollama serve`);
        _errorShown = true;
      }
    } else if (!_errorShown) {
      console.error(`❌ Error analizando mensaje: ${error.message || error}`);
      _errorShown = true;
    }
    return JSON.stringify({ type: 'normal', song: null });
  }
}

module.exports = { analyze };
