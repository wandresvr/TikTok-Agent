// processor/router.js
const { looksLikeRequest } = require('./rules');
const { normalizeSong } = require('./normalizer');
const { analyze } = require('../llm/ollamaClient');
const { addRequest } = require('../state/liveState');

async function handleMessage(msg) {
  // reglas rápidas primero
  if (looksLikeRequest(msg.text)) {
    const song = normalizeSong(msg.text);
    if (song.length > 3) {
      addRequest(song, msg.userId);
      return;
    }
  }

  // LLM solo si hace falta
  if (msg.text.length > 10) {
    try {
      const result = await analyze(msg.text);

      if (result.type === 'request' && result.song) {
        addRequest(result.song.toLowerCase(), msg.userId);
      }
    } catch (e) {
      // nunca romper el flujo
    }
  }
}

module.exports = { handleMessage };
