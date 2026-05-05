// llm/ollamaClient.js
// Capa HTTP de Ollama: discovery de modelos, rate limiting, health check.
const config = require('../config');

// --- Estado privado del módulo (singleton por caché de Node) ---
let _availableModel = null;
let _configuredModelUnavailableWarned = false;
let _lastRequestTime = 0;
let _consecutive500Errors = 0;

const MIN_REQUEST_INTERVAL = 2000; // ms entre peticiones
const MAX_500_ERRORS = 3;

// --- Mutex para serializar todas las llamadas a Ollama ---
// Ollama procesa un request a la vez; llamadas concurrentes causan timeouts.
let _ollamaQueue = Promise.resolve();

async function withOllamaLock(fn) {
  let release;
  const prev = _ollamaQueue;
  _ollamaQueue = new Promise(r => release = r);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// --- Gestión de errores 500 (usada por classifier y generator) ---
function reportError500() { _consecutive500Errors++; }
function resetErrors() { _consecutive500Errors = 0; }

/**
 * Obtiene la lista de nombres de modelos instalados en Ollama.
 */
async function getAvailableModels() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return data.models?.map(m => m.name) || [];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Verifica si Ollama está accesible (GET /api/tags, timeout 3 s).
 */
async function checkAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Encuentra el mejor modelo disponible.
 * Prioridad: 1) OLLAMA_MODEL configurado, 2) detección automática por preferencia.
 */
async function findAvailableModel() {
  if (_availableModel) return _availableModel;

  const configured = config.ollama.model;
  if (configured) {
    const models = await getAvailableModels();
    if (models.includes(configured)) {
      _availableModel = configured;
      return configured;
    }
    if (!_configuredModelUnavailableWarned) {
      _configuredModelUnavailableWarned = true;
      console.warn(`⚠️ Modelo configurado "${configured}" no está disponible`);
      if (models.length === 0) {
        console.warn(`💡 Modelos disponibles: Ninguno. ¿Ollama está corriendo? Prueba: ollama serve && ollama pull phi3:mini`);
      } else {
        console.warn(`💡 Modelos disponibles: ${models.join(', ')}`);
      }
      console.warn(`💡 Usando detección automática...`);
    }
  }

  const models = await getAvailableModels();
  if (models.length === 0) return null;

  const preferred =
    models.find(m => m.includes('llama3.2')) ||
    models.find(m => m.includes('phi3') || m === 'phi') ||
    models.find(m => m.includes('mistral')) ||
    models.find(m => m.includes('qwen2')) ||
    models.find(m => m.includes('llama3')) ||
    models.find(m => m.includes('gemma')) ||
    models.find(m => m.includes('llama')) ||
    models[0];

  _availableModel = preferred;
  return preferred;
}

/**
 * Aplica rate limiting antes de cada petición a Ollama.
 * Si hay muchos errores 500 consecutivos, aumenta el tiempo de espera.
 */
async function waitForRateLimit() {
  const now = Date.now();
  const waitTime = _consecutive500Errors >= MAX_500_ERRORS
    ? MIN_REQUEST_INTERVAL * (_consecutive500Errors + 1)
    : MIN_REQUEST_INTERVAL;

  const elapsed = now - _lastRequestTime;
  if (elapsed < waitTime) {
    await new Promise(resolve => setTimeout(resolve, waitTime - elapsed));
  }
  _lastRequestTime = Date.now();
}

/**
 * Verifica Ollama al arranque: imprime modelos disponibles y advertencias de RAM.
 * Llamar antes de iniciar el listener.
 */
async function checkOllamaOnStart() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const models = data.models?.map(m => m.name) || [];

      if (models.length > 0) {
        console.log(`✅ Ollama está disponible en ${config.ollama.baseUrl}`);
        console.log(`📦 Modelos disponibles: ${models.join(', ')}`);

        const configuredModel = config.ollama.model;
        if (configuredModel) {
          if (models.includes(configuredModel)) {
            console.log(`🎯 Modelo configurado: ${configuredModel} ✅`);
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
  } catch {
    console.warn(`⚠️ Ollama no está disponible en ${config.ollama.baseUrl}`);
    console.warn('💡 Para usar respuestas automáticas, inicia Ollama: ollama serve');
    console.warn('📝 El bot seguirá funcionando pero sin respuestas del LLM\n');
  }
  return false;
}

module.exports = {
  getAvailableModels,
  checkAvailable,
  findAvailableModel,
  waitForRateLimit,
  withOllamaLock,
  reportError500,
  resetErrors,
  checkOllamaOnStart,
};
