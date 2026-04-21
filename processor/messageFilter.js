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
 * Quita tildes/diacríticos para comparaciones tolerantes.
 * "México" → "Mexico", "qué" → "que"
 * @param {string} str
 * @returns {string}
 */
function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Determina si un mensaje merece una respuesta del bot.
 * Si mencionan al moderador siempre se responde (hasta 150 caracteres).
 */
function shouldRespond(msg) {
  const text = msg.text.toLowerCase().trim();
  // Versión sin tildes para comparar keywords (tolerante a "como" vs "cómo")
  const norm = stripAccents(text);

  // Mención directa al moderador → responder siempre
  if (messageMentionsModerator(msg.text) && text.length <= 150) {
    return true;
  }

  // Descartar mensajes demasiado cortos o largos
  if (text.length < 5 || text.length > 150) {
    return false;
  }

  // Descartar si no hay ninguna letra (emojis puros, símbolos, números solos)
  // \p{L} matchea cualquier letra Unicode, incluidas letras con tilde
  if (!/\p{L}/u.test(text)) {
    return false;
  }

  // Saludo al inicio del mensaje (no necesita ser solo el saludo)
  const greetingPrefixes = ['hola', 'hi', 'hello', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'que tal'];
  const hasGreeting = greetingPrefixes.some(g => norm.startsWith(g));

  // Pregunta con contexto mínimo (>= 10 chars para evitar responder a cualquier "?" suelto)
  const hasQuestion = text.includes('?') && text.length >= 10;

  // Preguntas típicas de live musical — comparadas sin tildes para mayor tolerancia
  const liveQuestions = [
    'que tema',
    'como se llama',
    'de quien es',
    'que artista',
    'que cancion',
    'que musica',
    'cuando termina',
    'desde donde',
    'hasta que hora',
    'van a poner',
    'van a tocar',
  ];
  const hasLiveQuestion = liveQuestions.some(q => norm.includes(q));

  return hasGreeting || hasQuestion || hasLiveQuestion;
}

module.exports = { isMessageFromModerator, messageMentionsModerator, shouldRespond };
