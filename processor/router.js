// processor/router.js
const config = require('../config');
const { looksLikeRequest } = require('./rules');
const { normalizeSong } = require('./normalizer');
const { addRequest, getTop } = require('../state/liveState');
const { analyze } = require('../llm/classifier');
const { generateResponse } = require('../llm/generator');
const { queueResponse } = require('../llm/responseQueue');
const { shouldRespond, messageMentionsModerator, isMessageFromModerator } = require('./messageFilter');
const { formatResponseWithMention, saveResponseToCsvIfEnabled } = require('../utils/format');
const { matchSong } = require('../rag');
const { searchSongInfo } = require('../search/songSearch');
const { resolve } = require('../config/promptLoader');

const { showOtherComments, enableAutoSend, enableSendSongResponses } = config.bot;

// Referencia a la conexión de TikTok para enviar mensajes
let tiktokConnection = null;

function setTikTokConnection(connection) {
  tiktokConnection = connection;
}

/**
 * Registra la solicitud de canción, genera una respuesta y la envía al chat.
 * Usado tanto por la rama de reglas rápidas como por la rama LLM.
 */
async function handleSongRequest(song, msg) {
  // RAG: validar contra catálogo de canciones conocidas
  let ragResult = { found: false, canonical: song, score: 0, song: null };
  if (config.rag.enabled) {
    ragResult = matchSong(song);
    if (ragResult.found) {
      console.log(`🔍 RAG: "${song}" → "${ragResult.canonical}" (score: ${ragResult.score.toFixed(2)})`);
    } else {
      console.log(`🔍 RAG: "${song}" no encontrada en el catálogo (score: ${ragResult.score.toFixed(2)})`);
    }
  }

  const canonicalSong = ragResult.canonical;
  addRequest(canonicalSong, msg.userId);
  const topSongs = getTop(3).map(([s]) => s);
  console.log(`🎵 Canción detectada: "${canonicalSong}"`);
  console.log(`📊 Top: ${topSongs.join(', ') || 'Ninguna'}`);

  if (!enableSendSongResponses) return;

  try {
    console.log(`🤖 Generando respuesta para solicitud de canción...`);
    const response = await generateResponse(`Solicitud recibida: ${canonicalSong}`, { ragResult });
    if (!response) {
      console.log(`⚠️ No se generó respuesta del LLM`);
      return;
    }

    const textToSend = formatResponseWithMention(response, msg.user, msg.displayName);
    let sent = false;
    if (enableAutoSend && tiktokConnection && tiktokConnection.sendMessage) {
      console.log(`📤 Enviando mensaje: "${textToSend.substring(0, 60)}..."`);
      sent = await tiktokConnection.sendMessage(textToSend);
      if (sent) console.log(`✅ Mensaje enviado exitosamente`);
      else console.log(`❌ No se pudo enviar el mensaje`);
    } else {
      console.log(`💬 Respuesta (no enviada): "${response}"`);
      if (!tiktokConnection || !tiktokConnection.sendMessage) {
        console.log(`⚠️ No se puede enviar al chat: conexión no disponible o sin autenticación`);
      }
    }
    saveResponseToCsvIfEnabled(msg.user, `Solicitud recibida: ${canonicalSong}`, textToSend, sent);
  } catch (e) {
    console.error(`❌ Error generando/enviando respuesta:`, e.message);
  }
}

/**
 * Busca info de una canción en internet y genera una respuesta curiosa.
 * Funciona independientemente de ENABLE_RAG.
 */
async function handleSongCuriosity(song, originalText, msg) {
  let userMessage;

  if (song) {
    console.log(`🔎 Buscando info sobre: "${song}"`);
    try {
      const info = await searchSongInfo(song);
      if (info) {
        console.log(`📚 Info encontrada (${info.length} chars)`);
        userMessage = resolve('curiosidad.con_info', { song, info });
      } else {
        console.log(`📚 Sin resultados web para: "${song}"`);
        userMessage = resolve('curiosidad.sin_info', { song });
      }
    } catch (e) {
      console.warn(`⚠️ Error buscando info: ${e.message}`);
      userMessage = resolve('curiosidad.sin_info', { song });
    }
  } else {
    userMessage = resolve('curiosidad.sin_cancion', { pregunta: originalText });
  }

  try {
    console.log(`🤖 Generando respuesta de curiosidad...`);
    const response = await generateResponse(userMessage, {});
    if (!response) { console.log(`⚠️ No se generó respuesta del LLM`); return; }

    const textToSend = formatResponseWithMention(response, msg.user, msg.displayName);
    let sent = false;
    if (enableAutoSend && tiktokConnection && tiktokConnection.sendMessage) {
      console.log(`📤 Enviando curiosidad: "${textToSend.substring(0, 60)}..."`);
      sent = await tiktokConnection.sendMessage(textToSend);
      if (sent) console.log(`✅ Curiosidad enviada`);
      else console.log(`❌ No se pudo enviar`);
    } else {
      console.log(`💬 Curiosidad (no enviada): "${response}"`);
    }
    saveResponseToCsvIfEnabled(msg.user, originalText, textToSend, sent);
  } catch (e) {
    console.error(`❌ Error en handleSongCuriosity:`, e.message);
  }
}

async function handleMessage(msg) {
  if (isMessageFromModerator(msg)) return;

  if (showOtherComments) {
    console.log(`\n💬 [${msg.user}] ${msg.text}`);
  }

  // Reglas rápidas primero
  if (looksLikeRequest(msg.text)) {
    const song = normalizeSong(msg.text);
    if (song.length > 3) {
      await handleSongRequest(song, msg);
      return;
    }
  }

  // LLM solo si hace falta
  if (msg.text.length > 10) {
    try {
      const resultStr = await analyze(msg.text);
      let result;
      try {
        result = JSON.parse(resultStr);
      } catch {
        result = { type: 'normal' };
      }

      if (result.type === 'request' && result.song) {
        await handleSongRequest(result.song.toLowerCase(), msg);
      } else if (result.type === 'curiosity') {
        await handleSongCuriosity(result.song || null, msg.text, msg);
      } else if (shouldRespond(msg) && tiktokConnection) {
        console.log(`💭 Mensaje agregado a cola de respuestas: "${msg.text.substring(0, 40)}..."`);
        queueResponse(msg, [], tiktokConnection, enableAutoSend);
      } else if (msg.text.length > 30) {
        console.log(`ℹ️ Mensaje procesado (no requiere respuesta)`);
      }
    } catch {
      // nunca romper el flujo
    }
  }

  // Mensajes cortos (≤10 chars): si te etiquetan o nombran (MODERATOR_NAME), responder siempre
  if (msg.text.length <= 10 && messageMentionsModerator(msg.text) && tiktokConnection) {
    console.log(`💭 Te etiquetaron/nombraron (mensaje corto), agregado a cola: "${msg.text.substring(0, 40)}..."`);
    queueResponse(msg, [], tiktokConnection, enableAutoSend);
  }
}

module.exports = { handleMessage, setTikTokConnection };
