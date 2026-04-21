// llm/responseQueue.js
// Cola de respuestas: limita el ritmo de envíos al chat de TikTok.
const { generateResponse } = require('./generator');
const { formatResponseWithMention, saveResponseToCsvIfEnabled } = require('../utils/format');

// --- Estado privado del módulo ---
let _queue = [];
let _processing = false;
let _lastResponseTime = 0;

const MAX_QUEUE_SIZE = 5;
const RESPONSE_COOLDOWN = 5000; // ms entre respuestas enviadas

/**
 * Procesa la cola de respuestas en orden, respetando el cooldown.
 */
async function processQueue() {
  if (_processing || _queue.length === 0) return;
  _processing = true;

  while (_queue.length > 0) {
    const { msg, topSongs, tiktokConnection, allowSend = true } = _queue.shift();

    const now = Date.now();
    const elapsed = now - _lastResponseTime;
    if (elapsed < RESPONSE_COOLDOWN) {
      await new Promise(resolve => setTimeout(resolve, RESPONSE_COOLDOWN - elapsed));
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
            _lastResponseTime = Date.now();
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

  _processing = false;
}

/**
 * Encola un mensaje para que se genere y envíe una respuesta.
 * @param {object} msg - { userId, user, text, displayName }
 * @param {string[]} topSongs - Top canciones actuales
 * @param {object} tiktokConnection - Conexión con método sendMessage
 * @param {boolean} allowSend - false = generar pero no enviar al chat
 */
function queueResponse(msg, topSongs, tiktokConnection, allowSend = true) {
  if (_queue.length >= MAX_QUEUE_SIZE) {
    console.log(`⚠️ Cola de respuestas llena, ignorando mensaje: "${msg.text.substring(0, 30)}..."`);
    return;
  }
  _queue.push({ msg, topSongs, tiktokConnection, allowSend });
  processQueue();
}

module.exports = { queueResponse };
