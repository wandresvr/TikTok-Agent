// processor/router.js
const { looksLikeRequest } = require('./rules');
const { normalizeSong } = require('./normalizer');
const { analyze } = require('../llm/ollamaClient');
const { addRequest, getTop } = require('../state/liveState');
const { generateResponse, shouldRespond, queueResponse, saveResponseToCsvIfEnabled } = require('../llm/responseGenerator');

// Referencia a la conexión de TikTok para enviar mensajes
let tiktokConnection = null;

function setTikTokConnection(connection) {
  tiktokConnection = connection;
}

const showOtherComments = process.env.SHOW_OTHER_COMMENTS === 'true';
// Envío automático de mensajes al chat (respuestas a solicitudes y a usuarios). true = enviar, false = solo escuchar/registrar.
const enableAutoSend = process.env.ENABLE_AUTO_SEND !== 'false';
// Enviar al chat las respuestas cuando se detecta una canción (true = enviar "Solicitud recibida: ...", false = solo registrar).
const enableSendSongResponses = process.env.ENABLE_SEND_SONG_RESPONSES !== 'false';

async function handleMessage(msg) {
  // Mostrar mensaje recibido solo si está habilitado
  if (showOtherComments) {
    console.log(`\n💬 [${msg.user}] ${msg.text}`);
  }
  
  // reglas rápidas primero
  if (looksLikeRequest(msg.text)) {
    const song = normalizeSong(msg.text);
    if (song.length > 3) {
      console.log(`🎵 Canción detectada: "${song}"`);
      addRequest(song, msg.userId);
      const topSongs = getTop(3).map(([song]) => song);
      console.log(`📊 Top canciones: ${topSongs.length > 0 ? topSongs.join(', ') : 'Ninguna'}`);
      
      if (enableSendSongResponses) {
        try {
          console.log(`🤖 Generando respuesta para solicitud de canción...`);
          const response = await generateResponse(
            `Solicitud recibida: ${song}`,
            { topSongs }
          );
          if (response) {
            if (enableAutoSend && tiktokConnection && tiktokConnection.sendMessage) {
              console.log(`📤 Enviando mensaje: "${response}"`);
              const sent = await tiktokConnection.sendMessage(response);
              if (sent) console.log(`✅ Mensaje enviado exitosamente`);
              else console.log(`❌ No se pudo enviar el mensaje`);
            } else {
              console.log(`💬 Respuesta (no enviada): "${response}"`);
            }
            saveResponseToCsvIfEnabled(msg.user, `Solicitud recibida: ${song}`, response, enableAutoSend && tiktokConnection && !!tiktokConnection.sendMessage);
          } else {
            console.log(`⚠️ No se generó respuesta del LLM`);
          }
        } catch (e) {
          console.error(`❌ Error generando/enviando respuesta:`, e.message);
        }
        if (!tiktokConnection || !tiktokConnection.sendMessage) {
          console.log(`⚠️ No se puede enviar al chat: conexión no disponible o sin autenticación`);
        }
      }
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
      } catch (e) {
        // Si no es JSON válido, ignorar
        result = { type: 'normal' };
      }

      if (result.type === 'request' && result.song) {
        console.log(`🎵 Canción detectada (LLM): "${result.song}"`);
        addRequest(result.song.toLowerCase(), msg.userId);
        const topSongs = getTop(3).map(([song]) => song);
        console.log(`📊 Top canciones: ${topSongs.length > 0 ? topSongs.join(', ') : 'Ninguna'}`);
        
        if (enableSendSongResponses) {
          try {
            console.log(`🤖 Generando respuesta para solicitud de canción...`);
            const response = await generateResponse(
              `Solicitud recibida: ${result.song}`,
              { topSongs }
            );
            if (response) {
              if (enableAutoSend && tiktokConnection && tiktokConnection.sendMessage) {
                console.log(`📤 Enviando mensaje: "${response}"`);
                const sent = await tiktokConnection.sendMessage(response);
                if (sent) console.log(`✅ Mensaje enviado exitosamente`);
                else console.log(`❌ No se pudo enviar el mensaje`);
              } else {
                console.log(`💬 Respuesta (no enviada): "${response}"`);
              }
              saveResponseToCsvIfEnabled(msg.user, `Solicitud recibida: ${result.song}`, response, enableAutoSend && tiktokConnection && !!tiktokConnection.sendMessage);
            } else {
              console.log(`⚠️ No se generó respuesta del LLM`);
            }
          } catch (e) {
            console.error(`❌ Error generando/enviando respuesta:`, e.message);
          }
          if (!tiktokConnection || !tiktokConnection.sendMessage) {
            console.log(`⚠️ No se puede enviar al chat: conexión no disponible o sin autenticación`);
          }
        }
      } else if (shouldRespond(msg) && tiktokConnection) {
        // Cola de respuestas: Ollama siempre genera; enviamos al chat solo si ENABLE_AUTO_SEND
        const topSongs = getTop(3).map(([song]) => song);
        console.log(`💭 Mensaje agregado a cola de respuestas: "${msg.text.substring(0, 40)}..."`);
        queueResponse(msg, topSongs, tiktokConnection, enableAutoSend);
      } else {
        // Solo mostrar log si el mensaje es largo o parece importante
        if (msg.text.length > 30) {
          console.log(`ℹ️ Mensaje procesado (no requiere respuesta)`);
        }
      }
    } catch (e) {
      // nunca romper el flujo
    }
  }
}

module.exports = { handleMessage, setTikTokConnection };
