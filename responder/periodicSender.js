// responder/periodicSender.js
// Bot periódico: genera y envía mensajes al chat cada N minutos para mantener actividad en el live.
const config = require('../config');
const { generateResponse } = require('../llm/generator');
const { saveResponseToCsvIfEnabled } = require('../utils/format');

const PERIODIC_PROMPT_HINTS = [
  'Esta vez la frase debe INVITAR A PEDIR CANCIONES (que manden su tema).',
  'Esta vez la frase debe ANIMAR A DAR TAP TAP en la pantalla.',
  'Esta vez la frase debe PEDIR SEGUIR AL HOST o dar like.',
  'Esta vez la frase debe ser un SALUDO BREVE y alegre al chat.',
  'Esta vez INVITA a pedir canciones indicando que las escriban en formato artista - canción. Mantén el tono animado y entusiasta.',
];

const PERIODIC_TWISTS = [
  'Redacta de una forma distinta a la última vez.',
  'Usa otras palabras y emojis, sin repetir frases típicas.',
  'Inventa una variación nueva, no la frase obvia.',
  'Tono más festivo y breve.',
  'Otra forma de decirlo, creativa.',
];

/**
 * Inicia el bot periódico. Llama a sendMessage(text) cada OLLAMA_PERIODIC_INTERVAL_MS ms.
 * @param {(text: string) => Promise<boolean>} sendMessage - Función para enviar mensajes al chat
 * @returns {{ stop: () => void }}
 */
function startPeriodicSender(sendMessage) {
  const { periodicIntervalMs } = config.ollama;
  if (!periodicIntervalMs || periodicIntervalMs <= 0) {
    return { stop: () => {} };
  }

  const { enableAutoSend } = config.bot;
  let count = 0;

  const id = setInterval(async () => {
    const hint = PERIODIC_PROMPT_HINTS[count % PERIODIC_PROMPT_HINTS.length];
    const twist = PERIODIC_TWISTS[Math.floor(Math.random() * PERIODIC_TWISTS.length)];
    count++;

    const prompt = `Genera una frase corta y alegre para el live. ${hint} ${twist} Escribe solo la frase como si la dijeras en el chat, con emojis, máximo 70 caracteres.`;

    try {
      const response = await generateResponse(prompt, {});
      if (!response) return;

      let sent = false;
      if (enableAutoSend && typeof sendMessage === 'function') {
        sent = await sendMessage(response);
        if (sent) console.log(`⏱️ [Periódico cada ${periodicIntervalMs / 60000} min] Enviado: "${response.substring(0, 50)}..."`);
      } else {
        console.log(`⏱️ [Periódico] Respuesta (no enviada): "${response.substring(0, 50)}..."`);
      }
      saveResponseToCsvIfEnabled('(periódico)', prompt, response, sent);
    } catch (e) {
      console.warn('⏱️ [Periódico] Error:', e.message);
    }
  }, periodicIntervalMs);

  console.log(`⏱️ Ollama responderá cada ${periodicIntervalMs / 60000} min (OLLAMA_PERIODIC_INTERVAL_MS=${periodicIntervalMs})`);

  return { stop: () => clearInterval(id) };
}

module.exports = { startPeriodicSender };
