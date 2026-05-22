// utils/format.js
// Helpers de formato de respuestas y persistencia CSV.
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Red de seguridad: trunca a maxLen Unicode code points para no superar el límite del chat.
// El prompt ya instruye al LLM a mantenerse bajo 110 chars; esta función solo actúa en casos extremos.
function truncateTo(str, maxLen) {
  const chars = [...str]; // itera por code point, no por UTF-16 unit
  if (chars.length <= maxLen) return str;
  let cut = maxLen;
  while (cut > 0 && chars[cut - 1] !== ' ') cut--;
  if (cut === 0) cut = maxLen;
  return chars.slice(0, cut).join('').trimEnd();
}

/**
 * Escapa un valor para CSV (separador ;, comillas y saltos de línea).
 */
function escapeCsvValue(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[";\n\r]/.test(s) ? `"${s}"` : s;
}

/**
 * Si ENABLE_MENTION_RESPONSE está habilitado y hay destinatario,
 * devuelve "@destinatario respuesta". Prefiere displayName sobre username.
 */
function formatResponseWithMention(response, username, displayName) {
  if (!response) return response;
  if (!config.bot.enableMentionResponse) return truncateTo(response, 180);
  const mention = (displayName && typeof displayName === 'string' && displayName.trim())
    ? displayName.trim()
    : (username && typeof username === 'string' && username.trim())
      ? username.trim()
      : '';
  if (!mention) return truncateTo(response, 180);
  return truncateTo(`@${mention} ${response}`, 180);
}

/**
 * Si SAVE_RESPONSES_CSV=true, agrega una fila al CSV en RESPONSES_CSV_PATH.
 */
function saveResponseToCsvIfEnabled(user, userMessage, response, sent) {
  if (!config.bot.saveResponsesCsv) return;
  const csvPath = config.bot.responsesCsvPath;
  if (!csvPath) return;
  try {
    const fullPath = path.resolve(csvPath);
    const header = 'fecha;usuario;mensaje_usuario;respuesta_bot;enviado';
    const needsHeader = !fs.existsSync(fullPath);
    const row = [
      new Date().toISOString(),
      escapeCsvValue(user),
      escapeCsvValue(userMessage),
      escapeCsvValue(response),
      '', // enviado: siempre vacío
    ].join(';');
    const line = (needsHeader ? header + '\n' : '') + row + '\n';
    fs.appendFileSync(fullPath, line, 'utf8');
  } catch (e) {
    console.error('❌ Error guardando respuesta en CSV:', e.message);
  }
}

module.exports = { escapeCsvValue, formatResponseWithMention, saveResponseToCsvIfEnabled };
