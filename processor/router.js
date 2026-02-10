// processor/router.js
const { looksLikeRequest } = require('./rules');
const { normalizeSong } = require('./normalizer');
const { analyze } = require('../llm/ollamaClient');
const { addRequest, getTop } = require('../state/liveState');
const { generateResponse, shouldRespond, queueResponse } = require('../llm/responseGenerator');

// Referencia a la conexión de TikTok para enviar mensajes
let tiktokConnection = null;

function setTikTokConnection(connection) {
  tiktokConnection = connection;
}

async function handleMessage(msg) {
  // Mostrar mensaje recibido
  console.log(`\n💬 [${msg.user}] ${msg.text}`);
  
  // reglas rápidas primero
  if (looksLikeRequest(msg.text)) {
    const song = normalizeSong(msg.text);
    if (song.length > 3) {
      console.log(`🎵 Canción detectada: "${song}"`);
      addRequest(song, msg.userId);
      const topSongs = getTop(3).map(([song]) => song);
      console.log(`📊 Top canciones: ${topSongs.length > 0 ? topSongs.join(', ') : 'Ninguna'}`);
      
      // Responder confirmando la solicitud
      if (tiktokConnection && tiktokConnection.sendMessage) {
        try {
          console.log(`🤖 Generando respuesta para solicitud de canción...`);
          const response = await generateResponse(
            `Solicitud recibida: ${song}`,
            { topSongs }
          );
          if (response) {
            console.log(`📤 Enviando mensaje: "${response}"`);
            const sent = await tiktokConnection.sendMessage(response);
            if (sent) {
              console.log(`✅ Mensaje enviado exitosamente`);
            } else {
              console.log(`❌ No se pudo enviar el mensaje`);
            }
          } else {
            console.log(`⚠️ No se generó respuesta del LLM`);
          }
        } catch (e) {
          // No romper el flujo si falla la respuesta
          console.error(`❌ Error generando/enviando respuesta:`, e.message);
        }
      } else {
        console.log(`⚠️ No se puede enviar mensaje: conexión no disponible o sin autenticación`);
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
        
        // Responder confirmando la solicitud
        if (tiktokConnection && tiktokConnection.sendMessage) {
          try {
            console.log(`🤖 Generando respuesta para solicitud de canción...`);
            const response = await generateResponse(
              `Solicitud recibida: ${result.song}`,
              { topSongs }
            );
            if (response) {
              console.log(`📤 Enviando mensaje: "${response}"`);
              const sent = await tiktokConnection.sendMessage(response);
              if (sent) {
                console.log(`✅ Mensaje enviado exitosamente`);
              } else {
                console.log(`❌ No se pudo enviar el mensaje`);
              }
            } else {
              console.log(`⚠️ No se generó respuesta del LLM`);
            }
          } catch (e) {
            console.error(`❌ Error generando/enviando respuesta:`, e.message);
          }
        } else {
          console.log(`⚠️ No se puede enviar mensaje: conexión no disponible o sin autenticación`);
        }
      } else if (shouldRespond(msg) && tiktokConnection && tiktokConnection.sendMessage) {
        // Agregar a la cola de respuestas en lugar de responder inmediatamente
        const topSongs = getTop(3).map(([song]) => song);
        console.log(`💭 Mensaje agregado a cola de respuestas: "${msg.text.substring(0, 40)}..."`);
        queueResponse(msg, topSongs, tiktokConnection);
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
