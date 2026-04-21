// processor/messageFilter.js
// Filtros de mensajes: identifica al moderador y decide si un mensaje merece respuesta.
const config = require('../config');

/**
 * True si el mensaje es del propio moderador (MODERATOR_NAME).
 * Esos mensajes no se procesan ni se responden.
 */
function isMessageFromModerator(msg) {
  const name = config.bot.moderatorName;
  if (!name) return false;
  const n = name.toLowerCase();
  const user = (msg.user && String(msg.user).trim().toLowerCase()) || '';
  const display = (msg.displayName && String(msg.displayName).trim().toLowerCase()) || '';
  return user === n || display === n;
}

/**
 * True si el mensaje menciona o etiqueta al moderador (MODERATOR_NAME).
 * Cuando te etiquetan, se responde siempre.
 */
function messageMentionsModerator(text) {
  const name = config.bot.moderatorName;
  if (!name) return false;
  const lower = text.toLowerCase().trim();
  const nameLower = name.toLowerCase();
  if (lower.includes(nameLower)) return true;
  const atName = '@' + nameLower.replace(/\s/g, '');
  return lower.includes(atName);
}

/**
 * Determina si un mensaje merece una respuesta del bot.
 * Si mencionan al moderador siempre se responde (hasta 150 caracteres).
 */
function shouldRespond(msg) {
  const text = msg.text.toLowerCase().trim();

  if (messageMentionsModerator(msg.text) && text.length <= 150) {
    return true;
  }

  if (text.length < 5 || text.length > 150) {
    return false;
  }

  if (/^[\s\W]+$/.test(text.replace(/[a-z0-9]/gi, ''))) {
    return false;
  }

  const hasQuestionMark = text.includes('?');

  const specificGreetings = ['hola', 'hi', 'hello', 'buenas noches', 'buenos días', 'buenas tardes'];
  const hasGreeting = specificGreetings.some(greeting => {
    const regex = new RegExp(`^${greeting}[\\s!.,]*$`, 'i');
    return regex.test(text);
  });

  const hasDirectMention = /@\w+|streamer|dj|minh|@minh/i.test(text);

  const musicQuestions = ['qué canción', 'qué música', 'qué tema', 'pon', 'ponme', 'play'];
  const hasMusicQuestion = musicQuestions.some(q => text.includes(q));

  return hasQuestionMark || hasGreeting || (hasDirectMention && text.length > 10) || hasMusicQuestion;
}

module.exports = { isMessageFromModerator, messageMentionsModerator, shouldRespond };
